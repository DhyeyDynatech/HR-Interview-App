/**
 * Minimal Azure Voice Live API client for testing.
 *
 * Lifecycle:
 *   const client = new VoiceLiveClient({ onTranscript, onStatus, onError });
 *   await client.start();   // fetches /api/voice-test/session, opens WS, starts mic
 *   client.stop();          // closes WS, stops mic, releases audio context
 *
 * The class is deliberately self-contained so it can be lifted into
 * src/components/call/index.tsx later, replacing the RetellWebClient usage.
 */

export type TranscriptEntry = {
  role: "user" | "assistant";
  content: string;
  partial?: boolean;
};

export type VoiceLiveStatus =
  | "idle"
  | "connecting"
  | "listening"
  | "user_speaking"
  | "assistant_speaking"
  | "stopping"
  | "error";

export type VoiceLiveCallbacks = {
  onTranscript?: (transcript: TranscriptEntry[]) => void;
  onStatus?: (status: VoiceLiveStatus) => void;
  onError?: (message: string) => void;
  onUsage?: (usage: VoiceLiveUsage) => void;
  /** Fired when the agent invokes the `end_interview` tool. */
  onEndCall?: (reason: string) => void;
  /** Fired when the agent invokes the `report_refusal` tool. The caller is
   * responsible for counting these and deciding when to end the interview. */
  onRefusalReported?: (reason: string) => void;
  /** Fired for each recorded audio chunk as it becomes available during the
   * call (roughly every RECORDING_TIMESLICE_MS). `seq` is a 0-based, strictly
   * increasing index the caller uses to order chunks server-side. The caller
   * uploads these incrementally (append-blob) so most of the recording is
   * already persisted if the tab closes mid-interview — the end-of-call
   * full-blob upload is only a fallback. Best-effort: the caller may drop a
   * chunk on failure without affecting the call. */
  onRecordingChunk?: (chunk: Blob, seq: number) => void;
  /** Optional path to a session-issuing API route. If omitted, callers must
   * pass a preloadedSession to start(). */
  sessionUrl?: string;
};

export type VoiceLiveUsage = {
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  input_audio_tokens: number;
  output_audio_tokens: number;
};

export type SessionResponse = {
  wsUrl: string;
  sessionConfig: Record<string, unknown>;
  /** Hard wall-clock cap for the whole interview, in milliseconds. When set,
   * the client arms a one-shot timer at start() that force-ends the interview
   * when it elapses — independent of the browser tab's foreground state. This
   * is the backstop for the time limit: the React countdown in the call page
   * relies on a repeating setInterval that browsers throttle/freeze in
   * background tabs, so it can miss the cap entirely. A single far-future
   * setTimeout is far more reliable across tab states. */
  maxDurationMs?: number;
};

const INPUT_SAMPLE_RATE = 24000;
const OUTPUT_SAMPLE_RATE = 24000;

// The MediaRecorder containers/codecs we attempt, in priority order. Mirrors
// the list in VoiceLiveClient.initRecording — keep the two in sync. Opus webm
// is the target; mp4 is the Safari fallback. A browser that supports none of
// these cannot record the interview audio.
const RECORDING_MIME_CANDIDATES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4;codecs=mp4a.40.2",
  "audio/mp4",
];

/**
 * True if the current browser can record the interview audio. Recording needs
 * the MediaRecorder API plus at least one supported container/codec from
 * RECORDING_MIME_CANDIDATES. Chrome/Edge/Firefox pass; older Safari/iOS and
 * many in-app webviews fail. Callers use this to block the interview from
 * starting (so a candidate isn't recorded-lessly interviewed) and to show a
 * "use Chrome or Edge" notice.
 */
export function isRecordingSupported(): boolean {
  if (typeof MediaRecorder === "undefined") return false;

  return RECORDING_MIME_CANDIDATES.some((m) => {
    try {
      return MediaRecorder.isTypeSupported(m);
    } catch {
      return false;
    }
  });
}

export class VoiceLiveClient {
  private ws: WebSocket | null = null;
  private audioCtx: AudioContext | null = null;
  private workletNode: AudioWorkletNode | null = null;
  private mediaStream: MediaStream | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;

  private transcript: TranscriptEntry[] = [];
  private pendingAssistantText = "";
  private playheadTime = 0;
  private playbackNodes: AudioBufferSourceNode[] = [];
  // Jitter buffer for agent audio playback. Each response.audio.delta chunk is
  // scheduled back-to-back off playheadTime; if a chunk arrives later than the
  // previous one finished playing, the queue drains to silence and the agent's
  // voice audibly pauses mid-sentence, then resumes on the next chunk. A larger
  // lead cushion absorbs normal WebSocket jitter and short server generation
  // stalls so the sentence plays continuously.
  //   - PLAYBACK_LEAD_MS: cushion in front of `now` for the FIRST chunk of a
  //     turn (a bigger initial pre-buffer is what smooths the whole utterance).
  //   - PLAYBACK_MIN_LEAD_MS: minimum cushion for subsequent chunks.
  // Trade-off: larger values add a little latency before the agent starts
  // talking; 200ms is imperceptible in conversation but hides most jitter.
  private static readonly PLAYBACK_LEAD_MS = 200;
  private static readonly PLAYBACK_MIN_LEAD_MS = 120;
  // True until the first audio chunk of the current agent turn is scheduled, so
  // that chunk gets the larger PLAYBACK_LEAD_MS pre-buffer. Reset whenever the
  // playback queue is empty (start of a new utterance) in playAudioChunk.
  private isFirstChunkOfTurn = true;
  private hasGreeted = false;
  private currentStatus: VoiceLiveStatus = "idle";
  // Accumulates function-call argument deltas. Voice Live streams function
  // calls the same way it streams text — argument JSON arrives in chunks
  // via response.function_call_arguments.delta, terminated by .done.
  private pendingFunctionCalls: Map<string, { name: string; args: string }> =
    new Map();
  // When end_interview is invoked but the agent never said a closing message,
  // we force one via response.create and defer onEndCall until that response
  // finishes. This field stores the end reason while we wait.
  private pendingEndReason: string | null = null;
  // When forceEnd sends response.cancel, the server replies with a
  // response.done for the cancelled response. We need to ignore exactly one
  // response.done so we don't fire onEndCall before the forced goodbye runs.
  private ignoreNextResponseDone = false;
  // Per-response flags reset on each response.done. Used to detect tool-only
  // responses (agent called a tool but never spoke) which otherwise stall the
  // conversation — without a follow-up response.create, server_vad never
  // re-arms and the candidate is left waiting in silence.
  private currentResponseHadAudio = false;
  private currentResponseHadToolCall = false;
  // When true, mic input is suppressed: the MediaStreamTrack is disabled
  // (so the worklet sees silent samples) AND we skip forwarding chunks to
  // the WebSocket. We mute while the agent is speaking so server_vad can't
  // false-trigger on coughs/breath/keyboard noise mid-question — that was
  // causing the agent to cut off mid-sentence and then resume. The
  // candidate cannot interrupt the agent while muted; they can speak as
  // soon as the agent finishes (response.done re-enables the mic).
  private micEnabled = true;
  // Mono recording graph — both the candidate mic and the agent PCM are
  // summed into a single channel. This way someone reviewing the recording
  // hears BOTH voices in BOTH ears (vs. stereo separation which only puts
  // one voice in each ear). The MediaStream from the destination node is
  // encoded by a MediaRecorder into webm/opus and uploaded to Azure Blob
  // when the session ends. Lazily nulled if the browser lacks MediaRecorder.
  private recordingMixer: GainNode | null = null;
  private recordingDestination: MediaStreamAudioDestinationNode | null = null;
  private mediaRecorder: MediaRecorder | null = null;
  private recordingMime = "audio/webm;codecs=opus";
  private recordingChunks: Blob[] = [];
  // 0-based sequence number for chunks handed to onRecordingChunk. Lets the
  // caller/server order appended chunks deterministically. Reset in start().
  private recordingChunkSeq = 0;
  // How often the MediaRecorder emits a chunk. Also the incremental-upload
  // cadence: on a tab-close/crash the caller has uploaded everything up to the
  // last emitted chunk, so at most this much trailing audio is lost.
  private static readonly RECORDING_TIMESLICE_MS = 15_000;
  // Resolved when the MediaRecorder fully stops and the last ondataavailable
  // has fired. Promise is created in start() and consumed by getRecordingBlob.
  private recordingDonePromise: Promise<Blob | null> | null = null;
  private recordingDoneResolve: ((b: Blob | null) => void) | null = null;
  private usage: VoiceLiveUsage = {
    input_tokens: 0,
    output_tokens: 0,
    total_tokens: 0,
    input_audio_tokens: 0,
    output_audio_tokens: 0,
  };
  // Silence watchdog. Voice Live's server_vad only handles turn detection —
  // it does nothing when the candidate simply stops responding. Without this
  // timer the agent goes mute forever after asking a question. We arm it
  // whenever the mic re-enables (candidate's turn) and disarm it on any
  // sign of life (speech_started, agent starts speaking, session ending).
  // After SILENCE_MAX_CHECKINS prompts with no answer we forceEnd the call.
  private silenceTimer: ReturnType<typeof setTimeout> | null = null;
  private silenceCheckInsRemaining = VoiceLiveClient.SILENCE_MAX_CHECKINS;
  private static readonly SILENCE_TIMEOUT_MS = 12_000;
  private static readonly SILENCE_MAX_CHECKINS = 2;

  // Hard wall-clock cap. Armed in start() from session.maxDurationMs and
  // cleared in stop(). A one-shot setTimeout is used deliberately: unlike the
  // React page's repeating 10ms setInterval (which browsers throttle to a
  // crawl or freeze entirely in a backgrounded tab), a single far-future
  // timeout fires reliably enough to guarantee the interview can't run
  // unbounded. On fire it calls forceEnd("time_expired"), which delivers a
  // spoken goodbye and then ends — the same graceful path as the agent's own
  // end_interview tool.
  private maxDurationTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private callbacks: VoiceLiveCallbacks = {}) {}

  async start(preloadedSession?: SessionResponse): Promise<void> {
    if (this.ws) {
      throw new Error("VoiceLiveClient is already running. Call stop() first.");
    }

    this.setStatus("connecting");
    this.transcript = [];
    this.emitTranscript();
    this.silenceCheckInsRemaining = VoiceLiveClient.SILENCE_MAX_CHECKINS;
    this.clearSilenceTimer();

    // 1. Get session config — must be passed in by the caller. The real app
    // flow gets this from /api/register-call. A `sessionUrl` override is
    // still supported for callers that want to fetch from a custom endpoint.
    let session: SessionResponse;
    if (preloadedSession) {
      session = preloadedSession;
    } else if (this.callbacks.sessionUrl) {
      try {
        const res = await fetch(this.callbacks.sessionUrl, {
          method: "GET",
          cache: "no-store",
        });
        if (!res.ok) {
          throw new Error(`Session endpoint returned ${res.status}`);
        }
        session = (await res.json()) as SessionResponse;
      } catch (err) {
        this.fail(`Failed to get session: ${(err as Error).message}`);

        return;
      }
    } else {
      this.fail(
        "VoiceLiveClient.start() requires either a preloaded session or callbacks.sessionUrl",
      );

      return;
    }

    // 2. Set up the audio context + microphone capture worklet
    try {
      this.audioCtx = new AudioContext({ sampleRate: OUTPUT_SAMPLE_RATE });
      // Chrome's autoplay policy may suspend a freshly created AudioContext
      // until a user gesture. start() is called from a click handler, so
      // resume() should succeed and prevent silent playback.
      if (this.audioCtx.state === "suspended") {
        await this.audioCtx.resume().catch(() => {});
      }
      await this.audioCtx.audioWorklet.addModule(
        "/audio-worklets/pcm-recorder.js",
      );

      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          sampleRate: INPUT_SAMPLE_RATE,
        },
      });

      this.sourceNode = this.audioCtx.createMediaStreamSource(this.mediaStream);
      this.workletNode = new AudioWorkletNode(this.audioCtx, "pcm-recorder", {
        processorOptions: { targetSampleRate: INPUT_SAMPLE_RATE },
      });
      this.sourceNode.connect(this.workletNode);
      // Do NOT connect worklet to destination — we don't want to hear ourselves

      // Set up the stereo recording graph. Candidate mic to channel 0 (left),
      // agent PCM gets connected to channel 1 (right) inside playAudioChunk.
      // If MediaRecorder isn't supported we silently skip recording — the
      // interview still works, just without an audio file.
      this.initRecording();
    } catch (err) {
      this.fail(`Microphone setup failed: ${(err as Error).message}`);

      return;
    }

    // 3. Open the WebSocket to Voice Live
    this.ws = new WebSocket(session.wsUrl);
    this.ws.binaryType = "arraybuffer";

    this.ws.onopen = () => {
      // Send the session config — this is where the system prompt, voice, model live
      this.send({
        type: "session.update",
        session: session.sessionConfig,
      });
    };

    this.ws.onmessage = (event) => {
      this.handleServerEvent(event.data);
    };

    this.ws.onerror = () => {
      this.fail("WebSocket error");
    };

    this.ws.onclose = (event) => {
      if (event.code !== 1000) {
        this.fail(
          `WebSocket closed unexpectedly: ${event.code} ${event.reason}`,
        );
      }
    };

    // 4. Wire the worklet to stream mic audio over the socket
    this.workletNode!.port.onmessage = (e: MessageEvent<ArrayBuffer>) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        return;
      }
      // Skip forwarding while muted (agent is mid-utterance). Defense in
      // depth — the MediaStreamTrack is also disabled, so frames here
      // would be silent anyway, but skipping the send avoids waste.
      if (!this.micEnabled) {
        return;
      }
      const base64 = this.arrayBufferToBase64(e.data);
      this.send({
        type: "input_audio_buffer.append",
        audio: base64,
      });
    };

    // 5. Arm the hard wall-clock cap (if the caller passed one). This is the
    // tab-throttle-proof backstop for the interview time limit.
    if (session.maxDurationMs && session.maxDurationMs > 0) {
      this.maxDurationTimer = setTimeout(() => {
        this.maxDurationTimer = null;
        // forceEnd is a no-op if we're already ending; otherwise it speaks a
        // short goodbye and fires onEndCall so the page tears down + saves.
        this.forceEnd("time_expired");
      }, session.maxDurationMs);
    }
  }

  private setMicEnabled(enabled: boolean): void {
    if (this.micEnabled === enabled) return;
    this.micEnabled = enabled;
    this.mediaStream?.getAudioTracks().forEach((track) => {
      track.enabled = enabled;
    });
  }

  private startSilenceTimer(): void {
    this.clearSilenceTimer();
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    if (this.pendingEndReason) return;
    this.silenceTimer = setTimeout(() => {
      this.silenceTimer = null;
      this.handleSilenceTimeout();
    }, VoiceLiveClient.SILENCE_TIMEOUT_MS);
  }

  private clearSilenceTimer(): void {
    if (this.silenceTimer) {
      clearTimeout(this.silenceTimer);
      this.silenceTimer = null;
    }
  }

  private handleSilenceTimeout(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    if (this.pendingEndReason) return;
    // Only act when we're actually waiting for the candidate. If we're mid
    // assistant turn (status changed since the timer was set) the next
    // response.done will re-arm the watchdog.
    if (this.currentStatus !== "listening") return;

    if (this.silenceCheckInsRemaining <= 0) {
      this.forceEnd("candidate_unresponsive");

      return;
    }

    this.silenceCheckInsRemaining -= 1;
    this.send({
      type: "response.create",
      response: {
        modalities: ["audio", "text"],
        instructions:
          "The candidate has been silent for several seconds. In ONE short sentence, gently check whether they're still there or need a moment, then re-ask the most recent question you asked — verbatim or near-verbatim. Do NOT advance to the next question. Do NOT call any tools.",
      },
    });
  }

  private initRecording(): void {
    if (!this.audioCtx || !this.sourceNode) return;
    if (typeof MediaRecorder === "undefined") return;

    // Pick the best supported container/codec. Opus webm is the target —
    // small (~32 kbps stereo) and natively playable in <audio>. Fall back
    // to plain webm or mp4 if the browser ships without Opus. The candidate
    // list is shared with isRecordingSupported() so the pre-flight gate and
    // the actual recorder agree on what counts as "supported".
    const chosen = RECORDING_MIME_CANDIDATES.find((m) => {
      try {
        return MediaRecorder.isTypeSupported(m);
      } catch {
        return false;
      }
    });
    if (!chosen) return;
    this.recordingMime = chosen;

    try {
      // Single-channel mixer. Multiple sources connected to one node are
      // summed automatically by the Web Audio API, so this is all we need
      // to combine candidate + agent into one mono signal.
      this.recordingMixer = this.audioCtx.createGain();
      this.recordingDestination = this.audioCtx.createMediaStreamDestination();
      // Force the output stream to mono — otherwise Chrome may produce a
      // stereo track with both channels carrying the same content (wasteful).
      this.recordingDestination.channelCount = 1;
      this.recordingDestination.channelCountMode = "explicit";
      this.recordingMixer.connect(this.recordingDestination);

      // Candidate mic → mixer. When setMicEnabled(false) toggles the track
      // off, this connection emits silence — fine, the agent's audio is
      // simultaneously summed in and is what gets recorded during their turn.
      this.sourceNode.connect(this.recordingMixer);

      this.recordingChunks = [];
      this.mediaRecorder = new MediaRecorder(this.recordingDestination.stream, {
        mimeType: chosen,
        audioBitsPerSecond: 64000,
      });
      this.recordingDonePromise = new Promise<Blob | null>((resolve) => {
        this.recordingDoneResolve = resolve;
      });
      this.mediaRecorder.ondataavailable = (e) => {
        if (!e.data || e.data.size === 0) return;
        // Buffer for the end-of-call full-blob fallback (getRecordingBlob).
        this.recordingChunks.push(e.data);
        // Also hand the chunk to the caller for incremental append-upload, so
        // most of the recording is already persisted if the tab dies. This is
        // additive: the same bytes also live in recordingChunks for the
        // fallback path. webm/opus chunks concatenate into a valid playable
        // file (first chunk carries the header), which is why appending works.
        try {
          this.callbacks.onRecordingChunk?.(e.data, this.recordingChunkSeq);
        } catch {
          /* caller-side upload error must never break recording */
        }
        this.recordingChunkSeq += 1;
      };
      this.mediaRecorder.onstop = () => {
        const blob = this.recordingChunks.length
          ? new Blob(this.recordingChunks, { type: this.recordingMime })
          : null;
        this.recordingChunks = [];
        this.recordingDoneResolve?.(blob);
        this.recordingDoneResolve = null;
      };
      // Emit a chunk every RECORDING_TIMESLICE_MS. This drives both the
      // partial-safety buffer and the incremental append-upload cadence.
      this.recordingChunkSeq = 0;
      this.mediaRecorder.start(VoiceLiveClient.RECORDING_TIMESLICE_MS);
    } catch (err) {
      // Recording setup failed — null everything so the rest of the client
      // works as before. We don't fail the call for a missing recording.
      this.recordingMixer = null;
      this.recordingDestination = null;
      this.mediaRecorder = null;
      this.recordingDonePromise = null;
      this.recordingDoneResolve = null;
      // eslint-disable-next-line no-console
      console.warn("Voice Live recording disabled:", err);
    }
  }

  /**
   * Stops the MediaRecorder (if running) and resolves with the final blob.
   * Safe to call multiple times. Returns null if recording was unsupported
   * or never started. Caller is expected to upload the blob before calling
   * stop(), since stop() closes the AudioContext and tears the graph down.
   */
  async getRecordingBlob(): Promise<Blob | null> {
    if (!this.mediaRecorder) return null;
    try {
      if (this.mediaRecorder.state === "recording") {
        this.mediaRecorder.requestData();
        this.mediaRecorder.stop();
      }
    } catch {
      /* already stopped */
    }
    const blob = this.recordingDonePromise
      ? await this.recordingDonePromise.catch(() => null)
      : null;

    return blob;
  }

  stop(): void {
    this.setStatus("stopping");
    this.hasGreeted = false;
    this.pendingFunctionCalls.clear();
    this.pendingEndReason = null;
    this.ignoreNextResponseDone = false;
    this.currentResponseHadAudio = false;
    this.currentResponseHadToolCall = false;
    this.micEnabled = true;
    this.clearSilenceTimer();
    this.silenceCheckInsRemaining = VoiceLiveClient.SILENCE_MAX_CHECKINS;
    if (this.maxDurationTimer) {
      clearTimeout(this.maxDurationTimer);
      this.maxDurationTimer = null;
    }

    // Stop streaming audio
    this.playbackNodes.forEach((node) => {
      try {
        node.stop();
      } catch {
        /* already stopped */
      }
    });
    this.playbackNodes = [];

    // Trigger the MediaRecorder to flush+finalize. We deliberately do NOT
    // null mediaRecorder / recordingDonePromise / recordingChunks here —
    // ondataavailable and onstop fire asynchronously, and onstop is the
    // one that assembles the final blob and resolves the promise. The
    // promise stays alive so getRecordingBlob() can await it from the
    // save-call flow that runs after stop() returns.
    if (this.mediaRecorder) {
      try {
        if (this.mediaRecorder.state === "recording") {
          this.mediaRecorder.requestData();
          this.mediaRecorder.stop();
        }
      } catch {
        /* already stopped */
      }
    }
    // The mixer and destination must be disconnected before audioCtx
    // closes (otherwise audioCtx.close() can throw). The MediaRecorder
    // doesn't need the destination after stop() is called — it operates
    // on chunks that already arrived.
    if (this.recordingMixer) {
      try {
        this.recordingMixer.disconnect();
      } catch {
        /* already disconnected */
      }
      this.recordingMixer = null;
    }
    this.recordingDestination = null;

    if (this.workletNode) {
      this.workletNode.port.onmessage = null;
      this.workletNode.disconnect();
      this.workletNode = null;
    }
    if (this.sourceNode) {
      this.sourceNode.disconnect();
      this.sourceNode = null;
    }
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((t) => t.stop());
      this.mediaStream = null;
    }
    if (this.audioCtx) {
      this.audioCtx.close().catch(() => {});
      this.audioCtx = null;
    }
    if (this.ws) {
      try {
        this.ws.close(1000, "client_stop");
      } catch {
        /* already closing */
      }
      this.ws = null;
    }

    this.setStatus("idle");
  }

  getTranscript(): TranscriptEntry[] {
    return [...this.transcript];
  }

  getUsage(): VoiceLiveUsage {
    return { ...this.usage };
  }

  /**
   * True if audio recording was successfully set up and is active. False when
   * the browser lacked MediaRecorder/a codec, or initRecording() threw (it
   * nulls mediaRecorder on failure). Lets the caller distinguish "recording
   * failed to start" from "recording captured but upload failed" so the
   * recruiter-facing recording_status can be accurate.
   */
  recordingActive(): boolean {
    return this.mediaRecorder !== null;
  }

  /**
   * True if there is assistant audio still queued or playing.
   * Used by the caller to wait for the closing thank-you message to finish
   * before closing the WebSocket on an agent-driven end.
   */
  isPlayingAudio(): boolean {
    if (!this.audioCtx) return false;

    return this.playheadTime > this.audioCtx.currentTime + 0.05;
  }

  /**
   * End the interview from outside the agent — used as a safety net when
   * the caller decides the conversation should stop (e.g. the candidate
   * has refused 3 questions and the agent failed to recognise the threshold).
   *
   * Mirrors the same flow as the `end_interview` tool path: if the agent
   * is mid-sentence we let that audio play through, otherwise we force a
   * brief closing message and only fire onEndCall once it's been delivered.
   */
  forceEnd(reason: string): void {
    // Already ending — don't double-trigger.
    if (this.pendingEndReason) return;
    this.clearSilenceTimer();
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this.callbacks.onEndCall?.(reason);

      return;
    }

    this.pendingEndReason = reason;

    // Cancel any in-flight server response (e.g., the agent is about to ask
    // the next question or call another tool). Safe no-op if there's no
    // active response. Without this, the closing message we request below
    // could be queued behind a long question we don't want anymore.
    // The server will emit response.done for the cancelled response — we
    // must ignore exactly that one event so onEndCall doesn't fire before
    // the goodbye is delivered.
    this.ignoreNextResponseDone = true;
    this.send({ type: "response.cancel" });

    // Always request a fresh goodbye. If audio is already playing (typically
    // the agent's brief acknowledgment like "That's fair, let's move on"),
    // the goodbye audio chunks will queue behind it via the playheadTime
    // scheduling in playAudioChunk — so the candidate hears the ack first
    // and then the goodbye, never a silent cut-off.
    this.send({
      type: "response.create",
      response: {
        modalities: ["audio", "text"],
        instructions:
          "The interview is ending now. Speak a single short, warm closing message — thank the candidate for their time and wish them well. Do NOT ask any more questions. Do NOT call any tools. Just say the goodbye.",
      },
    });
    // onEndCall fires from the response.done branch once the goodbye is
    // delivered, then call/index.tsx drains the audio queue before tearing
    // the session down.
  }

  // ─────────────────────────────────────────────────────────────────────────

  private handleServerEvent(data: string | ArrayBuffer): void {
    if (typeof data !== "string") {
      // Voice Live only sends JSON text frames; ignore binary
      return;
    }
    let msg: any;
    try {
      msg = JSON.parse(data);
    } catch {
      return;
    }

    switch (msg.type) {
      case "session.created":
      case "session.updated":
        this.setStatus("listening");
        // Trigger the assistant to speak first (the interviewer opens the conversation).
        // Only fire once — subsequent session.updated events shouldn't re-greet.
        if (!this.hasGreeted) {
          this.hasGreeted = true;
          this.send({
            type: "response.create",
            response: { modalities: ["audio", "text"] },
          });
        }
        break;

      case "input_audio_buffer.speech_started":
        // Only flush playback if the assistant was actually speaking —
        // otherwise spurious VAD triggers (background noise, throat clear)
        // would needlessly reset our playback pipeline.
        if (this.currentStatus === "assistant_speaking") {
          this.flushPlayback();
        }
        this.clearSilenceTimer();
        this.setStatus("user_speaking");
        break;

      case "input_audio_buffer.speech_stopped":
        this.setStatus("listening");
        break;

      case "conversation.item.input_audio_transcription.completed":
        if (msg.transcript) {
          this.transcript.push({ role: "user", content: msg.transcript });
          this.emitTranscript();
          // Candidate gave a real (transcribed) reply — fresh start for the
          // silence budget. Otherwise a single moment of silence later in a
          // long, engaged interview could still end the call prematurely.
          this.silenceCheckInsRemaining = VoiceLiveClient.SILENCE_MAX_CHECKINS;
        }
        break;

      case "response.audio.delta":
        this.setStatus("assistant_speaking");
        // Suppress mic input the moment the agent starts speaking so
        // server_vad can't false-trigger on ambient noise and chop the
        // agent's audio mid-sentence.
        this.setMicEnabled(false);
        // Agent's turn — the candidate isn't expected to speak right now,
        // so disarm the silence watchdog until response.done re-arms it.
        this.clearSilenceTimer();
        this.currentResponseHadAudio = true;
        if (msg.delta) {
          this.playAudioChunk(this.base64ToArrayBuffer(msg.delta));
        }
        break;

      case "response.audio_transcript.delta":
        if (msg.delta) {
          this.pendingAssistantText += msg.delta;
          this.emitTranscriptWithPartial();
        }
        break;

      case "response.audio_transcript.done":
        if (this.pendingAssistantText) {
          this.transcript.push({
            role: "assistant",
            content: this.pendingAssistantText,
          });
          this.pendingAssistantText = "";
          this.emitTranscript();
        }
        break;

      case "conversation.item.created": {
        // The agent has decided to invoke a function. Voice Live creates a
        // conversation.item with type="function_call" containing the function
        // name + call_id, then streams the arguments via subsequent events.
        const item = msg.item;
        if (item?.type === "function_call" && item?.call_id) {
          this.pendingFunctionCalls.set(item.call_id, {
            name: String(item.name || ""),
            args: "",
          });
        }
        break;
      }

      case "response.function_call_arguments.delta": {
        const callKey = msg.call_id || msg.item_id;
        if (callKey) {
          const existing = this.pendingFunctionCalls.get(callKey) || {
            name: "",
            args: "",
          };
          existing.args += msg.delta || "";
          this.pendingFunctionCalls.set(callKey, existing);
        }
        break;
      }

      case "response.function_call_arguments.done": {
        const callKey = msg.call_id || msg.item_id;
        const accumulated = callKey
          ? this.pendingFunctionCalls.get(callKey)
          : undefined;
        const argsString = msg.arguments || accumulated?.args || "{}";
        const fnName = msg.name || accumulated?.name || "";

        let args: any = {};
        try {
          args = JSON.parse(argsString);
        } catch {
          /* ignore — agent emitted invalid JSON */
        }

        this.currentResponseHadToolCall = true;

        if (fnName === "report_refusal") {
          const reason = args.reason || "refusal";
          this.callbacks.onRefusalReported?.(reason);
          // The Realtime API expects a function_call_output for every tool
          // invocation, otherwise the conversation history is malformed and
          // the agent can stall on later turns.
          if (callKey) {
            this.send({
              type: "conversation.item.create",
              item: {
                type: "function_call_output",
                call_id: callKey,
                output: JSON.stringify({ ok: true }),
              },
            });
            this.pendingFunctionCalls.delete(callKey);
          }
          break;
        }

        if (fnName === "end_interview") {
          const reason = args.reason || "agent_decided";
          // If the agent already spoke a closing message before invoking
          // the tool, audio will still be in the playback queue. The caller
          // (call/index.tsx onEndCall) polls isPlayingAudio() and waits for
          // the queue to drain before firing setIsEnded(true).
          //
          // If the agent skipped the closing message (no queued audio),
          // proactively force one before ending so the candidate isn't
          // dropped abruptly.
          if (this.isPlayingAudio()) {
            this.callbacks.onEndCall?.(reason);
          } else {
            this.pendingEndReason = reason;
            this.send({
              type: "response.create",
              response: {
                modalities: ["audio", "text"],
                instructions:
                  "The interview is ending. Speak a single warm closing message to the candidate, thanking them by name and wishing them well. Keep it short (one or two sentences). Do NOT ask any more questions. Do NOT call any tools — just say the goodbye.",
              },
            });
            // onEndCall will fire from the response.done branch once the
            // closing message has been delivered.
          }
        }

        if (callKey) this.pendingFunctionCalls.delete(callKey);
        break;
      }

      case "response.done": {
        const hadAudio = this.currentResponseHadAudio;
        const hadToolCall = this.currentResponseHadToolCall;
        this.currentResponseHadAudio = false;
        this.currentResponseHadToolCall = false;

        // forceEnd sends response.cancel right before response.create. The
        // cancel produces its own response.done — skip it once so we don't
        // end the call before the new goodbye even starts.
        if (this.ignoreNextResponseDone) {
          this.ignoreNextResponseDone = false;
          break;
        }

        let willEnd = false;
        let awaitingFollowupResponse = false;

        if (this.pendingEndReason) {
          // A forced closing message just finished — fire the end callback.
          // The caller's onEndCall handler polls isPlayingAudio() so it'll
          // still wait for the final audio bytes to drain before teardown.
          const reason = this.pendingEndReason;
          this.pendingEndReason = null;
          this.callbacks.onEndCall?.(reason);
          willEnd = true;
        } else if (hadToolCall && !hadAudio) {
          // Agent called a tool (e.g. report_refusal) but said nothing.
          // server_vad won't auto-create a follow-up because no user audio
          // arrived in between, so the conversation stalls in silence.
          // Prompt the agent to continue with a brief acknowledgment and
          // the next question.
          this.send({
            type: "response.create",
            response: {
              modalities: ["audio", "text"],
              instructions:
                "Briefly acknowledge the candidate's previous answer in one short sentence, then ask the next question from your list. Do NOT repeat the question they just answered. Do NOT call any tools in this response.",
            },
          });
          awaitingFollowupResponse = true;
        }

        // Re-enable the mic AFTER the audio playback queue actually drains.
        // The server's response.done fires when audio chunks finish
        // streaming, but those chunks may still be queued in our
        // AudioContext for another second or two. If we re-enable the mic
        // while the agent's own voice is still leaving the speakers, the
        // mic picks it up and server_vad fires on the agent's audio —
        // recreating the very cutoff we're trying to prevent.
        //
        // Also arm the silence watchdog at the same moment — the candidate
        // is now expected to speak, and if they don't we'll check in.
        // Skipped when we're ending, OR when we just sent our own
        // response.create above (the next response.done will run this
        // block again with hadAudio=true and arm the timer then).
        if (!willEnd && !awaitingFollowupResponse) {
          const tryUnmute = () => {
            if (this.isPlayingAudio()) {
              setTimeout(tryUnmute, 100);

              return;
            }
            this.setMicEnabled(true);
            this.startSilenceTimer();
          };
          tryUnmute();
        }

        if (msg.response?.usage) {
          const u = msg.response.usage;
          this.usage = {
            input_tokens: this.usage.input_tokens + (u.input_tokens || 0),
            output_tokens: this.usage.output_tokens + (u.output_tokens || 0),
            total_tokens: this.usage.total_tokens + (u.total_tokens || 0),
            input_audio_tokens:
              this.usage.input_audio_tokens +
              (u.input_token_details?.audio_tokens || 0),
            output_audio_tokens:
              this.usage.output_audio_tokens +
              (u.output_token_details?.audio_tokens || 0),
          };
          this.callbacks.onUsage?.(this.usage);
        }
        this.setStatus("listening");
        break;
      }

      case "error":
        this.fail(msg.error?.message || "Unknown Voice Live error");
        break;

      default:
        // Many events we don't care about for a smoke test — silently ignore
        break;
    }
  }

  private playAudioChunk(pcm: ArrayBuffer): void {
    if (!this.audioCtx) {
      return;
    }
    const int16 = new Int16Array(pcm);
    const float32 = new Float32Array(int16.length);
    for (let i = 0; i < int16.length; i++) {
      float32[i] = int16[i] / (int16[i] < 0 ? 0x8000 : 0x7fff);
    }

    const buffer = this.audioCtx.createBuffer(
      1,
      float32.length,
      OUTPUT_SAMPLE_RATE,
    );
    buffer.copyToChannel(float32, 0);

    const src = this.audioCtx.createBufferSource();
    src.buffer = buffer;
    src.connect(this.audioCtx.destination);
    // Also route into the recording mixer. Web Audio sums all sources
    // connected to the same node, so candidate mic + agent audio combine
    // into one mono channel — both voices audible in both ears on playback.
    if (this.recordingMixer) {
      try {
        src.connect(this.recordingMixer);
      } catch {
        /* mixer torn down — recording already ended */
      }
    }

    const now = this.audioCtx.currentTime;
    // If the queue has already drained (playhead is at/behind `now`), this is
    // effectively the start of a fresh utterance — give it the larger lead so a
    // slow-arriving next chunk doesn't underrun. Subsequent chunks that are
    // still queued only need the smaller minimum cushion.
    const queueDrained = this.playheadTime <= now + 0.001;
    if (queueDrained) this.isFirstChunkOfTurn = true;

    const leadMs = this.isFirstChunkOfTurn
      ? VoiceLiveClient.PLAYBACK_LEAD_MS
      : VoiceLiveClient.PLAYBACK_MIN_LEAD_MS;
    const minStart = now + leadMs / 1000;
    const startAt = Math.max(this.playheadTime, minStart);
    src.start(startAt);
    this.playheadTime = startAt + buffer.duration;
    this.isFirstChunkOfTurn = false;
    this.playbackNodes.push(src);

    src.onended = () => {
      this.playbackNodes = this.playbackNodes.filter((n) => n !== src);
    };
  }

  private flushPlayback(): void {
    this.playbackNodes.forEach((node) => {
      try {
        node.stop();
      } catch {
        /* already stopped */
      }
    });
    this.playbackNodes = [];
    this.playheadTime = this.audioCtx?.currentTime ?? 0;
    // Next chunk begins a fresh utterance — give it the full pre-buffer.
    this.isFirstChunkOfTurn = true;
  }

  private send(payload: object): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(payload));
    }
  }

  private setStatus(status: VoiceLiveStatus): void {
    this.currentStatus = status;
    this.callbacks.onStatus?.(status);
  }

  private emitTranscript(): void {
    this.callbacks.onTranscript?.([...this.transcript]);
  }

  private emitTranscriptWithPartial(): void {
    const partial: TranscriptEntry = {
      role: "assistant",
      content: this.pendingAssistantText,
      partial: true,
    };
    this.callbacks.onTranscript?.([...this.transcript, partial]);
  }

  private fail(message: string): void {
    this.setStatus("error");
    this.callbacks.onError?.(message);
    this.stop();
  }

  private arrayBufferToBase64(buf: ArrayBuffer): string {
    const bytes = new Uint8Array(buf);
    let binary = "";
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode.apply(
        null,
        Array.from(bytes.subarray(i, i + chunk)),
      );
    }

    return btoa(binary);
  }

  private base64ToArrayBuffer(base64: string): ArrayBuffer {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }

    return bytes.buffer;
  }
}
