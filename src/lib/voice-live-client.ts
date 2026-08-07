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
  /** Hard wall-clock cap for the whole interview INCLUDING the wrap-up buffer,
   * in milliseconds. When set, the client arms a one-shot timer at start() that
   * force-ends the interview when it elapses — independent of the browser tab's
   * foreground state. This is the backstop for the time limit: the React
   * countdown in the call page relies on a repeating setInterval that browsers
   * throttle/freeze in background tabs, so it can miss the cap entirely. A
   * single far-future setTimeout is far more reliable across tab states. */
  maxDurationMs?: number;
  /** When the nominal interview time (excluding the wrap-up buffer) elapses, in
   * milliseconds from start(). Arms a second one-shot timer that calls
   * beginWrapUp() — the tab-throttle-proof backstop for the React countdown
   * that normally triggers wrap-up. Without it, a candidate sitting in a
   * background tab would keep being asked new questions past the limit and
   * then get cut off by maxDurationMs with no wrap-up phase at all. */
  wrapUpAfterMs?: number;
  /** Playback jitter-buffer cushion for the FIRST audio chunk of an agent turn,
   * in ms. Larger = more resilient to slow-arriving audio, but adds that much
   * delay before the agent starts speaking (paid once per turn). */
  playbackLeadMs?: number;
  /** Minimum cushion for subsequent chunks within a turn, in ms. This is the
   * value that determines how large an inter-chunk arrival gap can be before
   * the agent's voice audibly cuts out mid-sentence. */
  playbackMinLeadMs?: number;
};

const INPUT_SAMPLE_RATE = 24000;
const OUTPUT_SAMPLE_RATE = 24000;

/**
 * Appended to the agent's standing instructions when the interview clock runs
 * out (see VoiceLiveClient.beginWrapUp). The interview does not end here — the
 * candidate keeps a buffer window to finish the answer they're already giving.
 * The agent's only remaining job is to let them finish and then close warmly.
 */
export const WRAP_UP_INSTRUCTIONS = `# WRAP-UP PHASE ACTIVE (overrides all pacing rules above)

The interview time limit has now been reached. These rules override any earlier
instruction about covering every question:

- You MUST NOT ask any new question. This includes main questions from your
  list AND follow-up questions. It does not matter how many questions remain
  uncovered — leaving them unasked is the correct outcome now.
- If the candidate is still answering, let them finish completely. Do not rush
  them, do not interrupt, and do not cut them off.
- When the candidate finishes their answer, acknowledge it in ONE short phrase,
  then speak a warm closing message thanking them by name and wishing them well.
- ONLY AFTER that closing message has been fully spoken, call the
  \`end_interview\` tool with reason "time_expired".
- If the candidate asks a question or tries to continue the conversation,
  politely tell them the time is up, then close as described above.
- Never announce a countdown, a buffer, or a number of minutes remaining. The
  candidate already sees a timer on screen.`;

/**
 * Per-response instruction override used during wrap-up. Session-level
 * instructions alone proved too weak here: the standing prompt insists the
 * agent must cover every question, so a server-VAD-generated response weighed
 * that against the appended wrap-up rules and asked a new question anyway.
 * The per-response `instructions` field binds the individual turn, which is
 * what actually stops it.
 */
export const WRAP_UP_RESPONSE_INSTRUCTIONS =
  "This is the FINAL thing you will say in this interview. Speak exactly TWO short sentences and then stop: (1) a brief acknowledgment of the candidate's last answer, (2) a warm goodbye thanking them by name. " +
  "Do NOT ask a question of any kind. Do NOT add extra well-wishes, advice, next steps, or a second goodbye. Do NOT call any tools. " +
  "Two sentences, then silence.";

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
  // Trade-off: larger values add latency before the agent starts talking, paid
  // once per turn. 500ms sits inside the 200-500ms gap range of natural
  // conversational turn-taking, so it reads as normal, and it absorbs delays
  // that a smaller cushion turns into an audible mid-sentence cut.
  //
  // MIN_LEAD raised 300 -> 600ms after measuring real sessions: routine
  // inter-chunk arrival gaps clustered at 311/435/447/527ms, i.e. straddling
  // the old 300ms floor, so ordinary jitter was intermittently clipping the
  // agent mid-sentence. 600ms clears that cluster. It costs at most an extra
  // 300ms, and only when the queue has nearly drained — in normal flow chunks
  // schedule off playheadTime and this floor never applies.
  //
  // Deliberately NOT sized to absorb the multi-second Azure generation stalls
  // seen on shared-capacity deployments (5-16s). Covering those would mean a
  // 5s+ cushion before every reply, which reads as a frozen call — far worse
  // than an occasional stutter. Those are a capacity problem, not a jitter one.
  // Defaults. Both are overridable per-session via SessionResponse so they can
  // be tuned from server env vars without a rebuild — this client runs in the
  // browser and can't read process.env itself.
  private static readonly DEFAULT_PLAYBACK_LEAD_MS = 500;
  private static readonly DEFAULT_PLAYBACK_MIN_LEAD_MS = 600;
  private playbackLeadMs: number = VoiceLiveClient.DEFAULT_PLAYBACK_LEAD_MS;
  private playbackMinLeadMs: number =
    VoiceLiveClient.DEFAULT_PLAYBACK_MIN_LEAD_MS;
  // True until the first audio chunk of the current agent turn is scheduled, so
  // that chunk gets the larger PLAYBACK_LEAD_MS pre-buffer. Reset whenever the
  // playback queue is empty (start of a new utterance) in playAudioChunk.
  private isFirstChunkOfTurn = true;
  private hasGreeted = false;
  private currentStatus: VoiceLiveStatus = "idle";
  // Diagnostics for distinguishing a transport-level stall (TCP/WebSocket
  // head-of-line blocking — audio pauses then resumes with the socket still
  // open) from a service-level failure (Azure closes/errors the socket, or
  // throttles on rate_limits). Logged via console so a real interview session
  // can be inspected in the browser devtools without any UI wiring. Not user
  // facing — purely for diagnosing the "AI stops speaking then resumes" report.
  private lastAudioDeltaAt: number | null = null;
  // Per-agent-turn playback counters, reset at each turn boundary
  // (response.done). Used by the underrun diagnostics in playAudioChunk and
  // the per-turn summary — together they answer "did the agent's voice
  // actually cut out during this turn, and was it starvation or scheduling?".
  private turnChunkCount = 0;
  private turnUnderrunCount = 0;
  // Wall-clock ms when the first audio chunk of the current turn arrived, so
  // the summary can report how long the whole utterance took to stream.
  private turnFirstChunkAt: number | null = null;
  // Largest inter-chunk arrival gap seen during the current turn (ms).
  private turnMaxArrivalGapMs = 0;
  // Gaps shorter than this are normal inter-chunk spacing; only log the ones
  // large enough to be audible as a stutter.
  private static readonly AUDIO_GAP_WARN_MS = 300;
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
  // Pending tryUnmute poll (see response.done). Tracked so a new turn can
  // cancel a stale in-flight unmute instead of letting several race each
  // other — overlapping pollers from earlier turns were able to flip the mic
  // at the wrong moment, desyncing micEnabled from the track's real state and
  // leaving the candidate permanently unheard mid-interview.
  private unmuteTimer: ReturnType<typeof setTimeout> | null = null;
  // Safety MARGIN added on top of the audio actually still queued, bounding how
  // long tryUnmute waits for the playback queue to drain before unmuting
  // anyway. Without a bound, a playhead that keeps being pushed forward (agent
  // speaks again, or a stalled/never-draining queue) means the poll never
  // resolves and the mic is never re-enabled at all.
  //
  // This is NOT the total wait — the deadline is (pending audio + this). It was
  // previously used as a flat total, which force-unmuted mid-sentence on any
  // utterance longer than 3 seconds.
  private static readonly UNMUTE_MAX_WAIT_MS = 3000;
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

  // Fires at the nominal time limit (before the buffer) to enter the wrap-up
  // phase. Same rationale as maxDurationTimer: a single one-shot timeout is far
  // more reliable in a backgrounded tab than the page's repeating interval.
  private wrapUpTimer: ReturnType<typeof setTimeout> | null = null;

  // Wrap-up phase. Entered when the nominal interview time limit is reached
  // (see beginWrapUp). From that moment the agent is forbidden from asking any
  // new question — it may only let the candidate finish the answer already in
  // flight, then say goodbye and call end_interview. The candidate gets a
  // visible buffer countdown (owned by the caller) so a question asked in the
  // last seconds of the interview still gets a real chance to be answered
  // instead of being cut off mid-sentence by the old hard stop.
  private isWrappingUp = false;
  // True once we've driven the wrap-up closing turn (acknowledge + goodbye).
  // Ensures we do that exactly once, no matter how many speech_stopped events
  // arrive (the candidate may pause and resume before we get there).
  private wrapUpCloseRequested = false;
  // True between response.created and response.done. Used to avoid sending a
  // response.cancel when no response is active — that draws a "Cancellation
  // failed: no active response found" error from Azure.
  private responseInFlight = false;
  // The `instructions` string from the session config, kept so beginWrapUp can
  // append the wrap-up rules to it rather than replacing the whole prompt
  // (which would drop the never-answer / English-only / refusal rules).
  private baseInstructions: string | null = null;
  // The session's turn_detection block, kept so beginWrapUp can re-send it with
  // create_response disabled without losing the tuned threshold /
  // silence_duration_ms / prefix_padding_ms values.
  private baseTurnDetection: Record<string, unknown> = {};

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
    this.clearUnmuteTimer();
    // Start MUTED. The agent speaks first (the opening greeting + first
    // question), and until that finishes there is nothing for the candidate to
    // answer. Leaving the mic live through the greeting let server VAD
    // false-trigger on room noise — or on the agent's own voice bleeding back
    // through the speakers — which cut the greeting off mid-sentence. The mic
    // is opened by the same response.done path that handles every later turn,
    // once the agent's audio has actually finished playing.
    this.micEnabled = false;
    this.isWrappingUp = false;
    this.wrapUpCloseRequested = false;
    this.responseInFlight = false;
    this.baseInstructions = null;

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

      // Apply the muted-at-start state to the freshly captured track. A new
      // MediaStreamTrack is enabled by default, so setting this.micEnabled
      // above is not enough on its own — without this the track stays live
      // through the greeting and VAD can still trigger on it.
      this.setMicEnabled(false);

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

    // Remember the standing prompt so beginWrapUp can append the wrap-up rules
    // to it instead of replacing the whole thing.
    const cfgInstructions = session.sessionConfig?.instructions;
    this.baseInstructions =
      typeof cfgInstructions === "string" ? cfgInstructions : null;
    // Playback cushion overrides. Guarded against nonsense values (0, negative,
    // NaN) so a bad env var can't disable buffering entirely.
    if (
      typeof session.playbackLeadMs === "number" &&
      session.playbackLeadMs > 0
    ) {
      this.playbackLeadMs = session.playbackLeadMs;
    }
    if (
      typeof session.playbackMinLeadMs === "number" &&
      session.playbackMinLeadMs > 0
    ) {
      this.playbackMinLeadMs = session.playbackMinLeadMs;
    }

    const cfgTurnDetection = session.sessionConfig?.turn_detection;
    this.baseTurnDetection =
      cfgTurnDetection && typeof cfgTurnDetection === "object"
        ? (cfgTurnDetection as Record<string, unknown>)
        : {};

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
      // The WebSocket error event carries no detail (per spec) — the close
      // event that immediately follows has the actual code/reason. Log here
      // only to mark that onerror did fire, for diagnosing whether a cutout
      // was a genuine socket failure vs. a transport stall (socket stays
      // open, nothing fires here — see the gap warning in playAudioChunk).
      // eslint-disable-next-line no-console
      console.warn("[VoiceLive] WebSocket onerror fired");
      this.fail("WebSocket error");
    };

    this.ws.onclose = (event) => {
      // Log every close, including the clean 1000 case, so a real session's
      // devtools console shows definitively whether the socket ever closed
      // during the call — if a reported cutout has no onclose/onerror log
      // anywhere near it, the audio pause happened with the socket still
      // open, which points at a transport-level stall (TCP/WebSocket head-
      // of-line blocking) rather than Azure ending the session.
      // eslint-disable-next-line no-console
      console.info(
        `[VoiceLive] WebSocket closed: code=${event.code} reason="${event.reason}" wasClean=${event.wasClean}`,
      );
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

    // 5. Arm the wrap-up trigger (nominal time limit) and the hard wall-clock
    // cap (end of the buffer window). Both are tab-throttle-proof backstops for
    // the React countdowns in the call page, which run on a setInterval that
    // browsers freeze in a backgrounded tab.
    if (session.wrapUpAfterMs && session.wrapUpAfterMs > 0) {
      this.wrapUpTimer = setTimeout(() => {
        this.wrapUpTimer = null;
        // Idempotent — a no-op if the page's countdown already triggered it.
        this.beginWrapUp();
      }, session.wrapUpAfterMs);
    }

    if (session.maxDurationMs && session.maxDurationMs > 0) {
      this.maxDurationTimer = setTimeout(() => {
        this.maxDurationTimer = null;
        // forceEnd is a no-op if we're already ending; otherwise it speaks a
        // short goodbye and fires onEndCall so the page tears down + saves.
        this.forceEnd("time_expired");
      }, session.maxDurationMs);
    }
  }

  /**
   * Mute/unmute the candidate mic. Deliberately has NO "already in this state,
   * skip" early-return: `micEnabled` (which gates forwarding to the WebSocket)
   * and `track.enabled` (the actual capture) are two separate pieces of state,
   * and a guard that trusts the flag can never repair them once they drift
   * apart. That drift was a real, unrecoverable bug — the track stayed live (so
   * the candidate was still audible in the saved recording) while micEnabled
   * was stuck false, so every frame was dropped before reaching Voice Live. The
   * agent heard pure silence, asked "are you still there?" twice, and ended the
   * interview on the unresponsive-candidate path while the candidate was
   * talking the whole time. Always writing both keeps them convergent: any
   * desync self-corrects on the next mute/unmute instead of persisting.
   */
  private setMicEnabled(enabled: boolean): void {
    const changed = this.micEnabled !== enabled;
    this.micEnabled = enabled;
    // Keep the on-screen turn indicator honest: "listening" (which the call
    // page renders as the green "Your Turn" badge) is emitted HERE, at the
    // moment the mic actually opens — not when the server says it finished
    // streaming. Those are different instants: response.done fires while up to
    // a couple of seconds of agent audio is still queued in our AudioContext,
    // and the unmute poll deliberately waits for that to drain. Emitting the
    // badge early told the candidate to speak while they were still muted, so
    // anything they said in that window was silently dropped.
    if (changed && enabled && this.currentStatus !== "stopping") {
      this.setStatus("listening");
    }
    this.mediaStream?.getAudioTracks().forEach((track) => {
      track.enabled = enabled;
    });
  }

  /** Cancel any in-flight tryUnmute poll (see response.done). */
  private clearUnmuteTimer(): void {
    if (this.unmuteTimer) {
      clearTimeout(this.unmuteTimer);
      this.unmuteTimer = null;
    }
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

    // During wrap-up there is nothing left to re-ask — the candidate has
    // finished (or abandoned) their last answer and the agent is forbidden from
    // asking anything new. Re-asking here would violate the wrap-up contract,
    // so close the interview gracefully instead of nagging.
    if (this.isWrappingUp) {
      this.forceEnd("time_expired");

      return;
    }

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
    this.isWrappingUp = false;
    this.wrapUpCloseRequested = false;
    this.responseInFlight = false;
    this.baseInstructions = null;
    this.clearSilenceTimer();
    this.clearUnmuteTimer();
    this.silenceCheckInsRemaining = VoiceLiveClient.SILENCE_MAX_CHECKINS;
    if (this.maxDurationTimer) {
      clearTimeout(this.maxDurationTimer);
      this.maxDurationTimer = null;
    }
    if (this.wrapUpTimer) {
      clearTimeout(this.wrapUpTimer);
      this.wrapUpTimer = null;
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
   * Enter the wrap-up phase: the nominal interview time is up, but we do NOT
   * tear the session down yet.
   *
   * The old behaviour ended the call the instant the clock hit the limit. If
   * the agent had asked a question at, say, 9m30s of a 10m interview, the
   * candidate got 30 seconds to answer and was then cut off mid-sentence —
   * their answer was lost from the transcript and the interview ended with no
   * goodbye. Instead we now:
   *
   *   1. Update the session instructions so the agent may no longer ask ANY
   *      new question (main or follow-up) — this is a persistent constraint,
   *      not a one-off nudge, so it survives across the remaining turns.
   *   2. Let the candidate finish the answer that is already in flight.
   *   3. Let the agent close naturally via `end_interview` once that answer is
   *      done — the normal graceful path.
   *
   * The caller arms a visible buffer countdown and calls forceEnd() if the
   * buffer expires before the agent closes on its own. This method deliberately
   * does NOT interrupt whatever is happening right now: if the agent is
   * mid-question or the candidate is mid-answer, that continues uninterrupted.
   *
   * Idempotent — safe to call from both the React countdown and any backstop.
   */
  beginWrapUp(): void {
    if (this.isWrappingUp) return;
    // Nothing to do if we're already ending or the socket is gone.
    if (this.pendingEndReason) return;
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    this.isWrappingUp = true;

    // Persistent instruction override, PLUS turn_detection.create_response =
    // false.
    //
    // That second part is what makes wrap-up deterministic. Server VAD normally
    // auto-creates a response the moment the candidate stops speaking. During
    // wrap-up we also create our own closing response — so both fire and the
    // candidate hears two overlapping turns: our goodbye AND a VAD-generated
    // next question (the standing prompt still says "cover EVERY question").
    // That produced the reported "says thank you, says all the best, then asks
    // another question" behaviour. Disabling create_response means VAD still
    // detects turn boundaries (so speech_stopped still fires and transcription
    // still works) but never speaks on its own — from here the agent only talks
    // when we explicitly ask it to.
    //
    // Instructions are appended, not replaced, so the other standing rules
    // (never answer the candidate, English only, refusal handling) stay in
    // force through the wrap-up turns.
    this.send({
      type: "session.update",
      session: {
        ...(this.baseInstructions
          ? {
              instructions: `${this.baseInstructions}\n\n${WRAP_UP_INSTRUCTIONS}`,
            }
          : {}),
        turn_detection: {
          ...this.baseTurnDetection,
          create_response: false,
        },
      },
    });

    // If the line is idle right now (agent finished, candidate not speaking),
    // prompt the close-out immediately so a wrap-up landing in a silent gap
    // doesn't sit waiting for a candidate turn that never comes.
    //
    // If the candidate is mid-answer we must NOT inject here — that would talk
    // over them. Their turn is allowed to finish; the response.done handler
    // then applies WRAP_UP_RESPONSE_INSTRUCTIONS to the agent's next response
    // (see the isWrappingUp branch there). Relying on session.update alone was
    // not enough: the standing prompt still contains "you MUST ask EVERY
    // question / partial coverage is a failure", and a server-VAD-generated
    // response weighs that against the appended rules and asks anyway. A
    // per-response `instructions` override is what actually binds the turn.
    if (this.currentStatus === "listening" && !this.isPlayingAudio()) {
      // Mark the closing turn as driven so response.done ends the session once
      // this goodbye finishes (and so speech_stopped doesn't drive a second one).
      this.wrapUpCloseRequested = true;
      this.send({
        type: "response.create",
        response: {
          modalities: ["audio", "text"],
          instructions: WRAP_UP_RESPONSE_INSTRUCTIONS,
        },
      });
    }
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
    // Drop any pending unmute — we're ending, and the closing message is about
    // to play; a late unmute would only let it hear itself.
    this.clearUnmuteTimer();
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this.callbacks.onEndCall?.(reason);

      return;
    }

    this.pendingEndReason = reason;

    // Cancel any in-flight server response (e.g., the agent is about to ask
    // the next question or call another tool). Without this, the closing
    // message we request below could be queued behind a long question we don't
    // want anymore.
    // Only send the cancel when a response is genuinely active: an
    // unconditional cancel draws a "Cancellation failed: no active response
    // found" error from Azure, which the error handler used to escalate into a
    // full teardown of a healthy session.
    // The server emits response.done for the cancelled response — we must
    // ignore exactly that one event so onEndCall doesn't fire before the
    // goodbye is delivered.
    if (this.responseInFlight) {
      this.ignoreNextResponseDone = true;
      this.send({ type: "response.cancel" });
    }

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
        // Only reset the turn state on the INITIAL session setup. beginWrapUp
        // also sends a session.update mid-interview, and its session.updated
        // reply can land while the agent is mid-sentence or the candidate is
        // mid-answer — forcing "listening" there would desync the on-screen
        // turn indicator (and the silence watchdog) from what's actually
        // happening on the call.
        if (!this.hasGreeted) {
          // Deliberately does NOT set "listening" here. The agent is about to
          // speak the greeting and the mic starts muted, so announcing the
          // candidate's turn now would show "Your Turn" before they can
          // actually be heard. setMicEnabled emits it when the mic opens.
          //
          // Trigger the assistant to speak first (the interviewer opens the
          // conversation). Only fire once — subsequent session.updated events
          // shouldn't re-greet.
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
        // During wrap-up, the candidate has just finished the answer we were
        // waiting for. Server VAD is about to auto-generate the agent's reply,
        // and left alone that reply asks the next question — the standing
        // prompt's "cover EVERY question" rule outweighs the session-level
        // wrap-up instructions. Pre-empt it: cancel the pending auto-response
        // and drive the closing turn ourselves with a per-response instruction
        // override, which reliably binds. Guarded so it fires exactly once.
        if (this.isWrappingUp && !this.wrapUpCloseRequested) {
          this.wrapUpCloseRequested = true;
          // beginWrapUp disabled VAD auto-responses, so nothing is competing
          // with us here and there is nothing to cancel — this is the only
          // response the agent will produce. Sending a cancel anyway would just
          // draw a "no active response found" error.
          this.send({
            type: "response.create",
            response: {
              modalities: ["audio", "text"],
              instructions: WRAP_UP_RESPONSE_INSTRUCTIONS,
            },
          });
        }
        break;

      case "rate_limits.updated": {
        // Previously silently dropped (fell through to default:). Voice Live
        // enforces a tokens-per-minute quota per resource; if a reported
        // audio cutout correlates with `remaining` being near 0 here, the
        // stall is server-side throttling, not a transport stall.
        const limits = Array.isArray(msg.rate_limits) ? msg.rate_limits : [];
        const tight = limits.filter(
          (l: any) =>
            typeof l.remaining === "number" && l.remaining < l.limit * 0.1,
        );
        if (tight.length > 0) {
          // eslint-disable-next-line no-console
          console.warn("[VoiceLive] rate limit running low:", tight);
        }
        break;
      }

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

      case "response.audio.delta": {
        this.setStatus("assistant_speaking");
        // A tryUnmute poll from the previous turn may still be pending. Kill it
        // before muting — otherwise it can resolve mid-utterance and unmute
        // against this turn's intent, which is exactly how micEnabled and the
        // track's real state used to drift apart.
        this.clearUnmuteTimer();
        // Suppress mic input the moment the agent starts speaking so
        // server_vad can't false-trigger on ambient noise and chop the
        // agent's audio mid-sentence.
        this.setMicEnabled(false);
        // Agent's turn — the candidate isn't expected to speak right now,
        // so disarm the silence watchdog until response.done re-arms it.
        this.clearSilenceTimer();
        this.currentResponseHadAudio = true;

        // Diagnostic: measure the wall-clock gap between consecutive deltas
        // WITHIN the same turn. A large gap here, with no onclose/onerror
        // logged in between, means audio was delayed in transit (WebSocket/
        // TCP head-of-line blocking) rather than Azure failing the session —
        // the socket stayed open and healthy the whole time, it just didn't
        // deliver the next chunk promptly.
        const now = performance.now();
        if (this.turnFirstChunkAt === null) {
          this.turnFirstChunkAt = now;
        }
        if (this.lastAudioDeltaAt !== null) {
          const gap = now - this.lastAudioDeltaAt;
          if (gap > this.turnMaxArrivalGapMs) {
            this.turnMaxArrivalGapMs = gap;
          }
          if (gap > VoiceLiveClient.AUDIO_GAP_WARN_MS) {
            // eslint-disable-next-line no-console
            console.warn(
              `[VoiceLive][audio] arrival gap ${Math.round(gap)}ms (socket still open) — data starvation; ` +
                `if this exceeds the playback cushion the agent's voice audibly cuts out`,
            );
          }
        }
        this.lastAudioDeltaAt = now;

        if (msg.delta) {
          this.playAudioChunk(this.base64ToArrayBuffer(msg.delta));
        }
        break;
      }

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

      case "response.created":
        // Track in-flight state so we only ever send response.cancel when
        // there is genuinely something to cancel (see speech_stopped).
        this.responseInFlight = true;
        break;

      case "response.done": {
        this.responseInFlight = false;
        const hadAudio = this.currentResponseHadAudio;
        const hadToolCall = this.currentResponseHadToolCall;
        this.currentResponseHadAudio = false;
        this.currentResponseHadToolCall = false;
        // Per-turn playback summary. One line per agent utterance stating
        // whether the voice actually cut out and, if so, which side caused it.
        // Read this first when investigating a reported stutter, then drill
        // into the per-chunk debug trace for the same turn.
        if (this.turnChunkCount > 0) {
          const streamMs =
            this.turnFirstChunkAt !== null
              ? Math.round(performance.now() - this.turnFirstChunkAt)
              : 0;
          const verdict =
            this.turnUnderrunCount === 0
              ? "clean (no audible gap)"
              : `STUTTERED — ${this.turnUnderrunCount} underrun(s); ` +
                (this.turnMaxArrivalGapMs > this.playbackMinLeadMs
                  ? `cause=data starvation (max arrival gap ${Math.round(this.turnMaxArrivalGapMs)}ms exceeded the ${this.playbackMinLeadMs}ms cushion)`
                  : `cause=scheduling (data arrived in time; max gap only ${Math.round(this.turnMaxArrivalGapMs)}ms)`);
          // eslint-disable-next-line no-console
          console.info(
            `[VoiceLive][audio] turn complete: ${this.turnChunkCount} chunks over ${streamMs}ms — ${verdict}`,
          );
        }
        this.turnChunkCount = 0;
        this.turnUnderrunCount = 0;
        this.turnFirstChunkAt = null;
        this.turnMaxArrivalGapMs = 0;
        // Turn boundary — don't let the next turn's first chunk be measured
        // against this turn's last chunk (that gap is expected silence, not
        // a mid-utterance stall).
        this.lastAudioDeltaAt = null;

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
        } else if (this.wrapUpCloseRequested && hadAudio) {
          // The wrap-up closing turn (acknowledgment + goodbye) has just been
          // spoken. We deliberately told the agent NOT to call end_interview in
          // that turn — speaking and tool-calling in one response is exactly
          // what produced abrupt cut-offs before — so nothing else would end
          // the session. Fire the end ourselves now that the goodbye is out.
          this.callbacks.onEndCall?.("time_expired");
          willEnd = true;
        } else if (hadToolCall && !hadAudio && !this.wrapUpCloseRequested) {
          // Agent called a tool (e.g. report_refusal) but said nothing.
          // server_vad won't auto-create a follow-up because no user audio
          // arrived in between, so the conversation stalls in silence.
          // Prompt the agent to continue with a brief acknowledgment and
          // the next question.
          this.send({
            type: "response.create",
            response: {
              modalities: ["audio", "text"],
              instructions: this.isWrappingUp
                ? "The interview time is up. Do NOT ask any question. Briefly acknowledge the candidate's previous answer in one short sentence, then speak a warm closing message thanking them by name. Do NOT call any tools in this response."
                : "Briefly acknowledge the candidate's previous answer in one short sentence, then ask the next question from your list. Do NOT repeat the question they just answered. Do NOT call any tools in this response.",
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
        //
        // The poll is single-instance (any stale one from a previous turn is
        // cancelled first) and hard-bounded by UNMUTE_MAX_WAIT_MS. Previously
        // it was an uncancellable recursive setTimeout with no deadline: each
        // turn spawned another, they raced, and one that resolved late could
        // flip the mic against the current turn's intent. If the playhead kept
        // being pushed forward (agent speaks again, or a stalled queue never
        // drains) the poll could also spin forever and never unmute at all.
        // Failing open — unmuting after the deadline even if audio seems to
        // still be playing — is strictly better than never unmuting: the worst
        // case is the agent briefly hearing itself, versus a candidate who is
        // silently unheard for the rest of the interview.
        if (!willEnd && !awaitingFollowupResponse) {
          this.clearUnmuteTimer();
          // Size the deadline to the audio ACTUALLY still queued, plus a margin
          // for late-arriving chunks. A flat 3s ceiling was wrong: response.done
          // fires when the server stops streaming, but a long utterance (the
          // opening greeting especially) can still have many seconds of audio
          // buffered locally. The poll would hit 3s, force-unmute mid-sentence,
          // and — now that the turn indicator follows the mic — flip the badge
          // to "Your Turn" while the agent was still talking.
          //
          // The deadline still exists so a queue that never drains can't leave
          // the candidate permanently unheard; it's just now proportional to
          // what's really pending rather than an arbitrary constant.
          const pendingAudioMs =
            this.audioCtx && this.playheadTime > this.audioCtx.currentTime
              ? (this.playheadTime - this.audioCtx.currentTime) * 1000
              : 0;
          const unmuteDeadline =
            Date.now() + pendingAudioMs + VoiceLiveClient.UNMUTE_MAX_WAIT_MS;
          const tryUnmute = () => {
            this.unmuteTimer = null;
            if (this.isPlayingAudio() && Date.now() < unmuteDeadline) {
              this.unmuteTimer = setTimeout(tryUnmute, 100);

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
        // No setStatus("listening") here. response.done means the SERVER
        // finished streaming, but agent audio is typically still queued in our
        // AudioContext for another second or two — the unmute poll above waits
        // for it to drain. setMicEnabled emits "listening" at that point, so
        // the badge flips exactly when the candidate can actually be heard.
        break;
      }

      case "error": {
        const errMessage = msg.error?.message || "Unknown Voice Live error";
        // Not every server error is fatal. A cancel that races the response
        // lifecycle ("no active response found") is harmless — the response we
        // wanted to stop simply wasn't running yet. Escalating it through
        // fail() tore down the WebSocket and ended a healthy interview, and
        // showed the candidate an "Interview error" toast for a non-event.
        // Log and carry on instead.
        if (/no active response/i.test(errMessage)) {
          // eslint-disable-next-line no-console
          console.info(`[VoiceLive] ignoring benign error: ${errMessage}`);
          break;
        }
        this.fail(errMessage);
        break;
      }

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
      ? this.playbackLeadMs
      : this.playbackMinLeadMs;
    const minStart = now + leadMs / 1000;
    const startAt = Math.max(this.playheadTime, minStart);

    // ── Playback underrun diagnostics ──────────────────────────────────────
    // This is the mechanism behind the reported "agent starts speaking, stops
    // mid-sentence, then resumes". A drained queue MID-TURN means the previous
    // chunk finished playing before this one was scheduled: the speakers went
    // silent for `silenceMs`, and the listener hears a cut. `chunksInFlight`
    // separates the two root causes — 0 means we were starved of data (network
    // or server generation stall), >0 means audio was queued but scheduled too
    // late (a lead/cushion problem on our side).
    if (queueDrained && this.turnChunkCount > 0) {
      const silenceMs = Math.round((now - this.playheadTime) * 1000);
      this.turnUnderrunCount += 1;
      // eslint-disable-next-line no-console
      console.warn(
        `[VoiceLive][audio] UNDERRUN mid-turn — playback queue empty for ~${silenceMs}ms ` +
          `(chunk #${this.turnChunkCount} of this turn, underrun #${this.turnUnderrunCount}, ` +
          `chunksInFlight=${this.playbackNodes.length}, scheduledLead=${leadMs}ms)`,
      );
    }

    this.turnChunkCount += 1;
    // Per-chunk trace. Verbose by design — this is the raw timeline needed to
    // correlate an audible stutter with what the scheduler was doing at that
    // instant. Kept on console.debug so it's filterable and off by default in
    // most devtools setups.
    // eslint-disable-next-line no-console
    console.debug(
      `[VoiceLive][audio] chunk#${this.turnChunkCount} dur=${(buffer.duration * 1000).toFixed(0)}ms ` +
        `now=${now.toFixed(3)} playhead=${this.playheadTime.toFixed(3)} startAt=${startAt.toFixed(3)} ` +
        `cushion=${Math.round((this.playheadTime - now) * 1000)}ms queued=${this.playbackNodes.length}`,
    );

    src.start(startAt);
    this.playheadTime = startAt + buffer.duration;
    this.isFirstChunkOfTurn = false;
    this.playbackNodes.push(src);

    src.onended = () => {
      this.playbackNodes = this.playbackNodes.filter((n) => n !== src);
    };
  }

  private flushPlayback(): void {
    // A flush DISCARDS audio the agent had already generated, so if this fires
    // mid-utterance the candidate hears the voice cut off abruptly. This is the
    // third distinct cause of the reported "AI stops then continues": the other
    // two are data starvation and late scheduling (both logged in
    // playAudioChunk). Here the audio was in hand and we threw it away —
    // normally because server_vad decided the candidate started talking, which
    // it can do falsely on a cough, keyboard noise, or speaker bleed.
    const discarded = this.playbackNodes.length;
    const pendingMs =
      this.audioCtx && this.playheadTime > this.audioCtx.currentTime
        ? Math.round((this.playheadTime - this.audioCtx.currentTime) * 1000)
        : 0;
    if (discarded > 0 && pendingMs > 0) {
      // eslint-disable-next-line no-console
      console.warn(
        `[VoiceLive][audio] FLUSH mid-utterance — discarded ${discarded} queued chunk(s) ` +
          `(~${pendingMs}ms of agent speech) due to a barge-in/VAD trigger. ` +
          `If the candidate was NOT actually speaking, this is a false VAD trigger ` +
          `(threshold too low / speaker bleed into the mic).`,
      );
    }

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
    // User-interruption flush is also a turn boundary for gap measurement.
    this.lastAudioDeltaAt = null;
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
