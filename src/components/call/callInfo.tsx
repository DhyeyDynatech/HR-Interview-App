"use client";

import React, { useEffect, useRef, useState } from "react";
import {
  Analytics,
  CallData,
  ViolationEvent,
  Response as InterviewResponse,
} from "@/types/response";
import axios from "axios";
import { ScrollArea } from "@radix-ui/react-scroll-area";
import {
  DownloadIcon,
  TrashIcon,
  Clock,
  AlertTriangle,
  Video,
  Users,
  CheckCircle2,
  CameraOff,
  UserX,
  Shield,
  Monitor,
  Calendar,
  Smile,
  Frown,
  Meh,
  Play,
  Pause,
  Volume2,
  VolumeX,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { ResponseService } from "@/services/responses.service";
import { useRouter } from "next/navigation";
import LoaderWithText from "@/components/loaders/loader-with-text/loaderWithText";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { CircularProgress } from "@nextui-org/react";
import QuestionAnswerCard from "@/components/dashboard/interview/questionAnswerCard";
import { marked } from "marked";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CandidateStatus } from "@/lib/enum";
import { ArrowLeft } from "lucide-react";
import { assigneeService } from "@/services/users.service";

type CallProps = {
  call_id: string;
  onDeleteResponse: (deletedCallId: string) => void;
  onCandidateStatusChange: (callId: string, newStatus: string) => void;
};

function formatTime(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);

  return `${m}:${s.toString().padStart(2, "0")}`;
}

// Custom audio player. Shows the total duration immediately, renders a
// countdown, supports click-to-seek, playback-speed dropdown, mutable
// volume control, and forces a real download (vs. cross-origin browsers
// ignoring the <a download> attribute and just opening the file inline).
const PLAYBACK_RATES = [0.5, 0.75, 1, 1.25, 1.5, 2];

function CountdownAudioPlayer({
  src,
  filename,
  durationHint,
}: {
  src: string;
  filename?: string;
  // Known interview length in seconds, from the DB (response.duration). Used
  // as the trusted duration when the WebM container has no usable duration in
  // its header — which is the norm for MediaRecorder output. Prevents the
  // player from showing a bogus short time (e.g. "1:01" for an 11-minute clip)
  // and keeps click-to-seek mapped to the correct scale.
  durationHint?: number;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const progressRef = useRef<HTMLDivElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [showVolume, setShowVolume] = useState(false);
  const [downloading, setDownloading] = useState(false);
  // Recordings are transcoded server-side to MP3 (see /api/transcode-recording)
  // right after each interview, which is properly seekable over plain HTTP —
  // no extra handling needed. The handful of recordings that haven't been
  // transcoded yet (or the rare failed transcode) are still raw MediaRecorder
  // WebM: no Cues (seek index) and no duration in the header, so a browser
  // streaming them with preload="metadata" CANNOT seek — `audio.currentTime =
  // x` silently fails or clamps. For those ONLY, we download the whole file
  // into memory and play it from a blob: URL so the browser can scan it
  // locally and seek freely. Gated on the extension so MP3 playback never
  // pays for (or risks a timing bug from) a src swap it doesn't need.
  const needsBlobWorkaround = /\.webm(\?|$)/i.test(src);
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const playbackSrc = blobUrl || src;

  useEffect(() => {
    if (!src || !needsBlobWorkaround) return;
    let cancelled = false;
    let createdUrl: string | null = null;

    (async () => {
      try {
        const res = await fetch(src);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const blob = await res.blob();
        if (cancelled) return;
        createdUrl = URL.createObjectURL(blob);
        setBlobUrl(createdUrl);
      } catch {
        // Keep the remote src fallback — no-op.
      }
    })();

    return () => {
      cancelled = true;
      setBlobUrl(null);
      if (createdUrl) URL.revokeObjectURL(createdUrl);
    };
  }, [src, needsBlobWorkaround]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    // Recordings are served as MP3 (transcoded server-side from the raw
    // MediaRecorder webm), which has a normal, self-describing duration — so
    // the browser's own audio.duration is trustworthy here and MUST win once
    // available. Older un-transcoded webm files have no duration in the
    // container header (audio.duration reports Infinity until the browser
    // scans the stream), so those still need the seek-past-end trick below.
    //
    // durationHint (the DB's recorded interview length in seconds) is ONLY a
    // fallback/seed for the brief window before the browser reports a real
    // duration — it must never override a real duration once we have one.
    // Using it as an authority (comparing the browser's value against it and
    // rejecting mismatches) was a bug: the transcoded MP3's actual length can
    // legitimately differ from duration_seconds (a wall-clock timestamp diff,
    // not an audio sample count — muted/dropped chunks during the call shift
    // it), so real-but-"implausible" durations were being thrown out, and
    // click-to-seek was scaled against the wrong (hint) duration while
    // playing the real (different-length) file — exactly the "still not
    // working" symptom even on a properly seekable MP3.
    let durationFixed = false;

    const isUsableBrowserDuration = (d: number) => isFinite(d) && d > 0;

    // Seed from the hint ONLY until the browser reports something real, so
    // the timer/seek aren't stuck at 0 during the initial load.
    if (durationHint && durationHint > 0) {
      setDuration(durationHint);
    }

    const ensureFiniteDuration = () => {
      if (durationFixed) return;
      if (isUsableBrowserDuration(audio.duration)) {
        durationFixed = true;
        setDuration(audio.duration);

        return;
      }
      // Infinity/NaN — an un-transcoded streaming webm with no seek index.
      // Force a full scan by seeking past the end; the browser clamps to the
      // real end and reports a finite duration via "seeked"/"durationchange".
      const onSeeked = () => {
        if (isUsableBrowserDuration(audio.duration)) {
          durationFixed = true;
          setDuration(audio.duration);
          audio.currentTime = 0;
          audio.removeEventListener("seeked", onSeeked);
        }
      };
      audio.addEventListener("seeked", onSeeked);
      try {
        audio.currentTime = 1e9; // large finite — browser clamps to real end
      } catch {
        /* some browsers reject this; we keep the durationHint seed instead */
      }
    };

    // Chromium quirk: `audio.seekable` can get stuck reporting only [[0,0]]
    // even once `buffered`/`duration` correctly cover the whole file — verified
    // by reproduction, including via raw `audio.currentTime = x` from the
    // console, completely independent of our click handler or the file itself
    // (the identical file opened fresh in a new tab seeks correctly). The one
    // thing that reliably fixed the broken element in testing was calling
    // `audio.load()` AFTER the resource had already finished its first load —
    // calling it pre-emptively at mount (before anything has loaded) was a
    // no-op, which is why that first attempt didn't fix it. So: check
    // `seekable` once metadata is available, and only if it's degenerate
    // (covers essentially nothing despite a known duration) force exactly one
    // reload. Guarded by `reloadedForSeek` so the reload's own loadedmetadata
    // doesn't trigger a second reload.
    let reloadedForSeek = false;
    const fixSeekableIfStuck = () => {
      if (reloadedForSeek) {
        return;
      }
      if (!isUsableBrowserDuration(audio.duration)) {
        return;
      }
      const seekable = audio.seekable;
      const seekableCoversFile =
        seekable.length > 0 && seekable.end(seekable.length - 1) > 1;
      if (seekableCoversFile) {
        return;
      }
      reloadedForSeek = true;
      audio.load();
    };

    const onLoaded = () => {
      ensureFiniteDuration();
      fixSeekableIfStuck();
    };
    const onDurChange = () => ensureFiniteDuration();
    // While the seek-past-end trick is running (before durationFixed), the
    // browser momentarily parks currentTime near the real end. Don't reflect
    // that transient position in the UI or the progress bar would flash to the
    // end before snapping back to 0.
    const onTime = () => {
      if (!durationFixed && audio.currentTime > 1e8) return;
      setCurrentTime(audio.currentTime || 0);
    };
    const onEnd = () => setIsPlaying(false);
    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    audio.addEventListener("loadedmetadata", onLoaded);
    audio.addEventListener("durationchange", onDurChange);
    audio.addEventListener("timeupdate", onTime);
    audio.addEventListener("ended", onEnd);
    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPause);

    return () => {
      audio.removeEventListener("loadedmetadata", onLoaded);
      audio.removeEventListener("durationchange", onDurChange);
      audio.removeEventListener("timeupdate", onTime);
      audio.removeEventListener("ended", onEnd);
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("pause", onPause);
    };
    // Re-run when the actual media source changes (remote → blob URL) so the
    // duration-detection listeners re-attach against the seekable blob.
  }, [playbackSrc, durationHint]);

  const togglePlay = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      audio.play().catch(() => {});
    } else {
      audio.pause();
    }
  };

  const seekFromClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const audio = audioRef.current;
    const bar = progressRef.current;
    if (!audio || !bar) return;
    // Guard: until the duration-detection trick completes, `duration` may
    // be 0 (or stale Infinity), and setting currentTime to a non-finite
    // value throws. Bail out silently and the click becomes a no-op.
    if (!isFinite(duration) || duration <= 0) return;
    const rect = bar.getBoundingClientRect();
    const ratio = Math.min(
      1,
      Math.max(0, (e.clientX - rect.left) / rect.width),
    );
    const target = ratio * duration;
    if (!isFinite(target)) return;
    audio.currentTime = target;
    // Use `target` directly — reading audio.currentTime immediately after
    // setting it returns the pre-seek position because the seek is async.
    setCurrentTime(target);
  };

  // Keep the audio element in sync with React state for playbackRate and
  // volume. We do this in an effect rather than inline so that if the audio
  // element is re-mounted (e.g. src changes) the latest settings re-apply.
  useEffect(() => {
    const audio = audioRef.current;
    if (audio) audio.playbackRate = playbackRate;
  }, [playbackRate]);

  useEffect(() => {
    const audio = audioRef.current;
    if (audio) {
      audio.volume = volume;
      audio.muted = muted;
    }
  }, [volume, muted]);

  // Force a real download. The browser's <a download> attribute is ignored
  // for cross-origin URLs (Azure Blob is always cross-origin), so the file
  // just opens inline. Fetching as a Blob and using a synthetic anchor
  // bypasses that — works as long as the storage account allows GET via
  // CORS, which we've already set up.
  const downloadRecording = async () => {
    if (downloading) return;
    setDownloading(true);
    try {
      const res = await fetch(src);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objectUrl;
      a.download =
        filename ||
        src.split("/").pop()?.split("?")[0] ||
        "interview-recording.webm";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      // Revoke after a tick — Safari needs the URL alive until the click
      // is processed.
      setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    } catch {
      // Fall back to opening the URL in a new tab so the user still has
      // *some* way to access the file.
      window.open(src, "_blank", "noopener");
    } finally {
      setDownloading(false);
    }
  };

  const remaining = Math.max(0, duration - currentTime);
  const percent = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <div className="flex items-center gap-3 w-full max-w-md rounded-md border border-slate-200 bg-white px-3 py-2">
      <audio ref={audioRef} src={playbackSrc} preload="metadata" />
      <button
        type="button"
        onClick={togglePlay}
        className="flex h-8 w-8 items-center justify-center rounded-full bg-indigo-600 text-white hover:bg-indigo-700 transition"
        aria-label={isPlaying ? "Pause" : "Play"}
      >
        {isPlaying ? (
          <Pause size={14} />
        ) : (
          <Play size={14} className="ml-0.5" />
        )}
      </button>
      {/* Tall transparent wrapper gives a ~20px click target while the bar stays thin */}
      <div
        ref={progressRef}
        onClick={seekFromClick}
        className="flex-1 flex items-center py-2 cursor-pointer"
        role="slider"
        aria-label="Seek"
        aria-valuemin={0}
        aria-valuemax={Math.floor(duration)}
        aria-valuenow={Math.floor(currentTime)}
      >
        <div className="w-full h-1.5 bg-slate-200 rounded-full overflow-hidden">
          <div
            className="h-full bg-indigo-600 rounded-full transition-[width] duration-100"
            style={{ width: `${percent}%` }}
          />
        </div>
      </div>
      <span className="tabular-nums text-xs font-medium text-slate-700 min-w-[3rem] text-right">
        {formatTime(remaining)}
      </span>

      <select
        value={playbackRate}
        onChange={(e) => setPlaybackRate(Number(e.target.value))}
        className="text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded px-1.5 py-1 cursor-pointer border-0 focus:ring-1 focus:ring-indigo-500"
        aria-label="Playback speed"
      >
        {PLAYBACK_RATES.map((r) => (
          <option key={r} value={r}>
            {r}x
          </option>
        ))}
      </select>

      <div className="relative flex items-center">
        <button
          type="button"
          onClick={() => {
            if (showVolume) {
              setMuted((m) => !m);
            } else {
              setShowVolume(true);
            }
          }}
          onBlur={() => setTimeout(() => setShowVolume(false), 150)}
          className="flex h-7 w-7 items-center justify-center rounded text-slate-700 hover:bg-slate-100 transition"
          aria-label={muted ? "Unmute" : "Mute / volume"}
        >
          {muted || volume === 0 ? (
            <VolumeX size={16} />
          ) : (
            <Volume2 size={16} />
          )}
        </button>
        {showVolume && (
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={muted ? 0 : volume}
            onChange={(e) => {
              const v = Number(e.target.value);
              setVolume(v);
              setMuted(v === 0);
            }}
            onMouseLeave={() => setShowVolume(false)}
            className="ml-1 w-20 accent-indigo-600 cursor-pointer"
            aria-label="Volume"
          />
        )}
      </div>

      <button
        type="button"
        onClick={downloadRecording}
        disabled={downloading}
        className="flex h-7 w-7 items-center justify-center rounded text-slate-700 hover:bg-slate-100 transition disabled:opacity-50"
        aria-label="Download recording"
        title="Download recording"
      >
        <DownloadIcon size={16} />
      </button>
    </div>
  );
}

function CallInfo({
  call_id,
  onDeleteResponse,
  onCandidateStatusChange,
}: CallProps) {
  const [call, setCall] = useState<CallData>();
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [email, setEmail] = useState<string>("");
  const [name, setName] = useState<string>("");
  const [isClicked, setIsClicked] = useState(false);
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(true);
  const [transcript, setTranscript] = useState("");
  const [candidateStatus, setCandidateStatus] = useState<string>("");
  const [interviewId, setInterviewId] = useState<string>("");
  const [tabSwitchCount, setTabSwitchCount] = useState<number>(0);
  const [faceMismatchCount, setFaceMismatchCount] = useState<number>(0);
  const [cameraOffCount, setCameraOffCount] = useState<number>(0);
  const [multiplePersonCount, setMultiplePersonCount] = useState<number>(0);
  const [faceMismatchTotal, setFaceMismatchTotal] = useState<number>(0);
  const [cameraOffTotal, setCameraOffTotal] = useState<number>(0);
  const [multiplePersonTotal, setMultiplePersonTotal] = useState<number>(0);
  const [violationsSummary, setViolationsSummary] = useState<ViolationEvent[]>(
    [],
  );
  const [responseData, setResponseData] = useState<any>(null);
  const [userResponses, setUserResponses] = useState<InterviewResponse[]>([]);
  const [qaPairs, setQaPairs] = useState<
    Array<{ question: string; answer: string }>
  >([]);

  useEffect(() => {
    const fetchResponses = async () => {
      setIsLoading(true);
      setCall(undefined);
      setEmail("");
      setName("");

      try {
        // Bound the request so a slow/stalled analytics call can't leave the
        // recruiter staring at an infinite spinner. Slightly longer than the
        // server-side analytics abort so the server's clean error usually wins
        // first; if not, axios aborts and the catch below stops the loader.
        const response = await axios.post(
          "/api/get-call",
          { id: call_id },
          { timeout: 135_000 },
        );
        setCall(response.data.callResponse);
        setAnalytics(response.data.analytics);

        // Update responseData with duration from API if available
        if (response.data.duration !== undefined) {
          setResponseData((prev: any) => ({
            ...prev,
            duration: response.data.duration,
            details: response.data.callResponse,
          }));
        }
      } catch (error) {
        console.error(error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchResponses();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [call_id]);

  useEffect(() => {
    const fetchEmail = async () => {
      setIsLoading(true);
      try {
        const response = await ResponseService.getResponseByCallId(call_id);
        setEmail(response.email);
        setName(response.name);
        setCandidateStatus(response.candidate_status);
        setInterviewId(response.interview_id);
        setTabSwitchCount(response.tab_switch_count || 0);
        setFaceMismatchCount(response.face_mismatch_count || 0);
        setCameraOffCount(response.camera_off_count || 0);
        setMultiplePersonCount(response.multiple_person_count || 0);
        setFaceMismatchTotal(response.face_mismatch_total || 0);
        setCameraOffTotal(response.camera_off_total || 0);
        setMultiplePersonTotal(response.multiple_person_total || 0);
        setViolationsSummary(response.violations_summary || []);
        setResponseData(response);
      } catch (error) {
        console.error(error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchEmail();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [call_id]);

  // The recording is uploaded as raw webm first, then transcoded to mp3 by a
  // fire-and-forget server job (see /api/transcode-recording) — webm has no
  // seek index, so a recruiter who opens the recording before the transcode
  // finishes gets a player that can't seek reliably. Rather than show that
  // broken state, poll details.recording_status until it flips to "uploaded"
  // (mp3 ready) and keep the recording hidden behind a "processing" indicator
  // until then. Stops polling once ready, once a terminal non-uploading state
  // is reached (empty/upload_failed/failed_to_start — nothing more to wait
  // for), or after a safe upper bound in case the transcode job crashed.
  useEffect(() => {
    const recordingUrl =
      responseData?.details?.recording_url || call?.recording_url;
    const recordingStatus = responseData?.details?.recording_status;
    const isWebm = /\.webm(\?|$)/i.test(recordingUrl || "");
    const isTerminal =
      recordingStatus === "uploaded" ||
      recordingStatus === "empty" ||
      recordingStatus === "upload_failed" ||
      recordingStatus === "failed_to_start";

    if (!recordingUrl || !isWebm || isTerminal) {
      return;
    }

    let cancelled = false;
    let pollTimer: ReturnType<typeof setTimeout> | null = null;
    const startTime = Date.now();
    const MAX_POLL_DURATION_MS = 5 * 60 * 1000;
    const POLL_INTERVAL_MS = 5000;

    const tick = async () => {
      if (cancelled) {
        return;
      }
      try {
        const response = await ResponseService.getResponseByCallId(call_id);
        if (cancelled) {
          return;
        }
        setResponseData(response);
      } catch {
        // Transient failure — keep polling, transcode may still be in flight.
      }
      if (cancelled) {
        return;
      }
      if (Date.now() - startTime < MAX_POLL_DURATION_MS) {
        pollTimer = setTimeout(tick, POLL_INTERVAL_MS);
      }
    };

    pollTimer = setTimeout(tick, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      if (pollTimer) {
        clearTimeout(pollTimer);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    call_id,
    responseData?.details?.recording_url,
    responseData?.details?.recording_status,
    call?.recording_url,
  ]);

  // Fetch all attempts for this assignee (by email + interview_id)
  useEffect(() => {
    const fetchUserResponses = async () => {
      try {
        if (!email || !interviewId) {
          return;
        }

        const allResponses = await ResponseService.getAllResponses(interviewId);

        const sameUserResponses = allResponses.filter(
          (r: InterviewResponse) =>
            r.email && email && r.email.toLowerCase() === email.toLowerCase(),
        );

        sameUserResponses.sort(
          (a: InterviewResponse, b: InterviewResponse) =>
            new Date(String(b.created_at)).getTime() -
            new Date(String(a.created_at)).getTime(),
        );

        setUserResponses(sameUserResponses);
      } catch (error) {
        console.error("Error fetching user responses:", error);
      }
    };

    fetchUserResponses();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [email, interviewId]);

  useEffect(() => {
    const replaceAgentAndUser = (transcript: string, name: string): string => {
      const agentReplacement = "**AI interviewer:**";
      const userReplacement = `**${name}:**`;

      // Replace "Agent:" with "AI interviewer:" and "User:" with the variable `${name}:`
      let updatedTranscript = transcript
        .replace(/Agent:/g, agentReplacement)
        .replace(/User:/g, userReplacement);

      // Add space between the dialogues
      updatedTranscript = updatedTranscript.replace(/(?:\r\n|\r|\n)/g, "\n\n");

      return updatedTranscript;
    };

    const buildTranscriptFromObject = (transcriptObject: any[]): string => {
      if (!transcriptObject || !Array.isArray(transcriptObject)) {
        return "";
      }

      return transcriptObject
        .map((item: any) => {
          const role = item.role === "agent" ? "Agent" : "User";

          return `${role}: ${item.content || ""}`;
        })
        .join("\n\n");
    };

    const extractQAPairs = (
      transcriptObject: any[],
    ): Array<{ question: string; answer: string }> => {
      if (!transcriptObject || !Array.isArray(transcriptObject)) {
        return [];
      }

      const pairs: Array<{ question: string; answer: string }> = [];
      let currentQuestion = "";
      let currentAnswer = "";

      for (const item of transcriptObject) {
        const content = (item.content || "").trim();
        if (!content) continue;

        if (item.role === "agent") {
          // If we have a pending question-answer pair, save it
          if (currentQuestion && currentAnswer) {
            pairs.push({ question: currentQuestion, answer: currentAnswer });
          }
          // Start a new question
          currentQuestion = content;
          currentAnswer = "";
        } else if (item.role === "user") {
          // Accumulate answer (in case answer spans multiple entries)
          if (currentAnswer) {
            currentAnswer += " " + content;
          } else {
            currentAnswer = content;
          }
        }
      }

      // Don't forget the last pair
      if (currentQuestion && currentAnswer) {
        pairs.push({ question: currentQuestion, answer: currentAnswer });
      }

      return pairs;
    };

    if (call || responseData) {
      // Check multiple possible transcript locations
      let transcriptText = "";

      // 1. Direct transcript property from call
      if (call?.transcript && typeof call.transcript === "string") {
        transcriptText = call.transcript;
      }
      // 2. Transcript in responseData.details (for analyzed calls)
      else if (
        responseData?.details?.transcript &&
        typeof responseData.details.transcript === "string"
      ) {
        transcriptText = responseData.details.transcript;
      }
      // 3. Transcript in call.details object (for analyzed calls)
      else if (
        (call as any)?.details?.transcript &&
        typeof (call as any).details.transcript === "string"
      ) {
        transcriptText = (call as any).details.transcript;
      }
      // 4. Build from call.transcript_object array
      else if (
        call?.transcript_object &&
        Array.isArray(call.transcript_object) &&
        call.transcript_object.length > 0
      ) {
        transcriptText = buildTranscriptFromObject(call.transcript_object);
      }
      // 5. Build from responseData.details.transcript_object
      else if (
        responseData?.details?.transcript_object &&
        Array.isArray(responseData.details.transcript_object) &&
        responseData.details.transcript_object.length > 0
      ) {
        transcriptText = buildTranscriptFromObject(
          responseData.details.transcript_object,
        );
      }
      // 6. Build from call.transcript_with_tool_calls array
      else if (
        (call as any)?.transcript_with_tool_calls &&
        Array.isArray((call as any).transcript_with_tool_calls) &&
        (call as any).transcript_with_tool_calls.length > 0
      ) {
        transcriptText = buildTranscriptFromObject(
          (call as any).transcript_with_tool_calls,
        );
      }
      // 7. Check call.details.transcript_object
      else if (
        (call as any)?.details?.transcript_object &&
        Array.isArray((call as any).details.transcript_object) &&
        (call as any).details.transcript_object.length > 0
      ) {
        transcriptText = buildTranscriptFromObject(
          (call as any).details.transcript_object,
        );
      }

      // Debug logging (can be removed in production)
      if (!transcriptText || transcriptText.trim().length === 0) {
        console.log("🔍 Transcript Debug:", {
          hasCall: !!call,
          hasResponseData: !!responseData,
          hasCallTranscript: !!call?.transcript,
          hasResponseDataDetailsTranscript: !!responseData?.details?.transcript,
          hasCallDetails: !!(call as any)?.details,
          hasCallDetailsTranscript: !!(call as any)?.details?.transcript,
          hasCallTranscriptObject: !!call?.transcript_object,
          callTranscriptObjectLength: call?.transcript_object?.length || 0,
          hasResponseDataDetailsTranscriptObject:
            !!responseData?.details?.transcript_object,
          responseDataDetailsTranscriptObjectLength:
            responseData?.details?.transcript_object?.length || 0,
          callKeys: Object.keys(call || {}),
          responseDataKeys: Object.keys(responseData || {}),
        });
      }

      if (transcriptText && transcriptText.trim().length > 0) {
        if (name) {
          setTranscript(replaceAgentAndUser(transcriptText, name));
        } else {
          // Use generic replacement if name is not available yet
          let updatedTranscript = transcriptText
            .replace(/Agent:/g, "**AI interviewer:**")
            .replace(/User:/g, "**Candidate:**");
          updatedTranscript = updatedTranscript.replace(
            /(?:\r\n|\r|\n)/g,
            "\n\n",
          );
          setTranscript(updatedTranscript);
        }
      } else {
        setTranscript("");
      }

      // Extract Q&A pairs from transcript_object
      let transcriptObjectArray: any[] = [];

      if (call?.transcript_object && Array.isArray(call.transcript_object)) {
        transcriptObjectArray = call.transcript_object;
      } else if (
        responseData?.details?.transcript_object &&
        Array.isArray(responseData.details.transcript_object)
      ) {
        transcriptObjectArray = responseData.details.transcript_object;
      } else if (
        (call as any)?.details?.transcript_object &&
        Array.isArray((call as any).details.transcript_object)
      ) {
        transcriptObjectArray = (call as any).details.transcript_object;
      } else if (
        (call as any)?.transcript_with_tool_calls &&
        Array.isArray((call as any).transcript_with_tool_calls)
      ) {
        transcriptObjectArray = (call as any).transcript_with_tool_calls;
      }

      if (transcriptObjectArray.length > 0) {
        const pairs = extractQAPairs(transcriptObjectArray);
        setQaPairs(pairs);
      } else {
        setQaPairs([]);
      }
    }
  }, [call, name, responseData]);

  const onDeleteResponseClick = async () => {
    try {
      const response = await ResponseService.getResponseByCallId(call_id);

      if (response) {
        const interview_id = response.interview_id;

        await ResponseService.deleteResponse(call_id);

        router.push(`/interviews/${interview_id}`);

        onDeleteResponse(call_id);
      }

      toast.success("Response deleted successfully.", {
        position: "bottom-right",

        duration: 3000,
      });
    } catch (error) {
      console.error("Error deleting response:", error);

      toast.error("Failed to delete the response.", {
        position: "bottom-right",

        duration: 3000,
      });
    }
  };

  return (
    <div className="w-full h-full z-[10]">
      {isLoading ? (
        <div className="flex flex-col items-center justify-center h-[75%] w-full">
          <LoaderWithText />
        </div>
      ) : (
        <>
          {userResponses.length > 1 && (
            <div className="bg-slate-200 rounded-2xl min-h-[100px] p-4 px-5 mb-[20px]">
              <p className="font-semibold my-2 mb-3">Attempt History</p>
              <div className="flex flex-wrap gap-2">
                {userResponses.map((resp, index) => (
                  <button
                    key={resp.call_id}
                    className={`text-xs px-3 py-1 rounded-full border transition-colors ${
                      resp.call_id === call_id
                        ? "bg-indigo-600 text-white border-indigo-600"
                        : "bg-white text-gray-700 border-gray-300 hover:bg-indigo-50 hover:border-indigo-300"
                    }`}
                    onClick={() => {
                      if (resp.call_id !== call_id) {
                        router.push(
                          `/interviews/${interviewId}?call=${resp.call_id}`,
                        );
                      }
                    }}
                  >
                    Attempt {userResponses.length - index}
                  </button>
                ))}
              </div>
            </div>
          )}
          {/* Interview Information Block */}
          <div className="bg-gradient-to-r from-indigo-50 to-purple-50 rounded-xl p-6 mb-4 border border-indigo-200 shadow-sm">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              {/* Duration */}
              <div className="bg-white rounded-lg p-4 border border-gray-200 shadow-sm">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-indigo-100 rounded-lg">
                    <Clock className="h-5 w-5 text-indigo-600" />
                  </div>
                  <div className="flex-1">
                    <p className="text-xs text-gray-500 font-medium">
                      Interview Duration
                    </p>
                    <p className="text-lg font-bold text-gray-900">
                      {responseData?.duration
                        ? `${Math.floor(responseData.duration / 60)}m ${responseData.duration % 60}s`
                        : call?.start_timestamp && call?.end_timestamp
                          ? `${Math.floor((call.end_timestamp - call.start_timestamp) / 60000)}m ${Math.floor(((call.end_timestamp - call.start_timestamp) % 60000) / 1000)}s`
                          : "N/A"}
                    </p>
                  </div>
                </div>
              </div>

              {/* Tab Switching */}
              <div className="bg-white rounded-lg p-4 border border-gray-200 shadow-sm">
                <div className="flex items-center gap-3">
                  <div
                    className={`p-2 rounded-lg ${tabSwitchCount > 0 ? "bg-red-100" : "bg-green-100"}`}
                  >
                    <AlertTriangle
                      className={`h-5 w-5 ${tabSwitchCount > 0 ? "text-red-600" : "text-green-600"}`}
                    />
                  </div>
                  <div className="flex-1">
                    <p className="text-xs text-gray-500 font-medium">
                      Tab Switching
                    </p>
                    <p
                      className={`text-lg font-bold ${tabSwitchCount > 0 ? "text-red-600" : "text-green-600"}`}
                    >
                      {tabSwitchCount > 0
                        ? `${tabSwitchCount} times`
                        : "No issues"}
                    </p>
                  </div>
                </div>
              </div>

              {/* Video Status */}
              {(() => {
                const normalReasons = [
                  "agent_hangup",
                  "user_hangup",
                  "call_transfer",
                ];
                const reason = call?.disconnection_reason;
                const hasDisconnectionIssue =
                  !!reason && !normalReasons.includes(reason);
                const hasCameraIssue = cameraOffCount > 0;
                const hasIssue = hasDisconnectionIssue || hasCameraIssue;

                const statusLabel = hasDisconnectionIssue
                  ? "Issues detected"
                  : hasCameraIssue
                    ? `Camera off ${cameraOffCount}x`
                    : "Normal";

                return (
                  <div className="bg-white rounded-lg p-4 border border-gray-200 shadow-sm">
                    <div className="flex items-center gap-3">
                      <div
                        className={`p-2 rounded-lg ${hasIssue ? "bg-yellow-100" : "bg-green-100"}`}
                      >
                        <Video
                          className={`h-5 w-5 ${hasIssue ? "text-yellow-600" : "text-green-600"}`}
                        />
                      </div>
                      <div className="flex-1">
                        <p className="text-xs text-gray-500 font-medium">
                          Video/Audio Status
                        </p>
                        <p
                          className={`text-lg font-bold ${hasIssue ? "text-yellow-600" : "text-green-600"}`}
                        >
                          {statusLabel}
                        </p>
                        {hasDisconnectionIssue && (
                          <p className="text-xs text-gray-500 mt-1 truncate">
                            {reason}
                          </p>
                        )}
                        {hasCameraIssue && !hasDisconnectionIssue && (
                          <p className="text-xs text-gray-500 mt-1">
                            {cameraOffCount} of{" "}
                            {cameraOffTotal || cameraOffCount} checks failed
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })()}

              {/* Voice Detection - Multiple Person */}
              <div className="bg-white rounded-lg p-4 border border-gray-200 shadow-sm">
                <div className="flex items-center gap-3">
                  <div
                    className={`p-2 rounded-lg ${multiplePersonCount > 0 ? "bg-red-100" : "bg-green-100"}`}
                  >
                    <Users
                      className={`h-5 w-5 ${multiplePersonCount > 0 ? "text-red-600" : "text-green-600"}`}
                    />
                  </div>
                  <div className="flex-1">
                    <p className="text-xs text-gray-500 font-medium">
                      Voice Detection
                    </p>
                    <p
                      className={`text-lg font-bold ${multiplePersonCount > 0 ? "text-red-600" : "text-green-600"}`}
                    >
                      {multiplePersonCount > 0
                        ? `${multiplePersonCount} times`
                        : "Single person detected"}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Interview Violations Section */}

          <div className="bg-slate-200 rounded-2xl min-h-[120px] p-4 px-5 y-3">
            <div className="flex flex-col justify-between bt-2">
              <div>
                <div className="flex justify-between items-center pb-4 pr-2">
                  <div
                    className=" inline-flex items-center text-indigo-600 hover:cursor-pointer"
                    onClick={() => {
                      router.push(`/interviews/${interviewId}`);
                    }}
                  >
                    <ArrowLeft className="mr-2" />
                    <p className="text-sm font-semibold">Back to Summary</p>
                  </div>
                </div>
              </div>
              <div className="flex flex-col justify-between gap-3 w-full">
                <div className="flex flex-row justify-between">
                  <div className="flex flex-row gap-3">
                    <Avatar>
                      <AvatarFallback>{name ? name[0] : "A"}</AvatarFallback>
                    </Avatar>
                    <div className="flex flex-col">
                      {name && (
                        <p className="text-sm font-semibold px-2">{name}</p>
                      )}
                      {email && <p className="text-sm px-2">{email}</p>}
                    </div>
                  </div>
                  <div className="flex flex-row mr-2 items-center gap-3">
                    <label
                      htmlFor="candidateStatus"
                      className="text-sm font-semibold"
                    >
                      Candidate Review Status
                    </label>
                    <Select
                      value={candidateStatus}
                      onValueChange={async (newValue: string) => {
                        setCandidateStatus(newValue);
                        // Update status for this specific response in local state
                        onCandidateStatusChange(call_id, newValue);

                        // Update candidate_status for all attempts of this assignee in the database
                        if (email && interviewId) {
                          try {
                            await ResponseService.updateCandidateStatusForUser(
                              interviewId,
                              email,
                              newValue,
                            );
                          } catch (error) {
                            console.error(
                              "Error updating candidate status for all attempts:",
                              error,
                            );
                          }
                        }

                        // Sync review_status with candidate_status in assignee table
                        if (email && interviewId) {
                          try {
                            await assigneeService.updateAssigneeReviewStatus(
                              email,
                              interviewId,
                              newValue as
                                | "NO_STATUS"
                                | "NOT_SELECTED"
                                | "POTENTIAL"
                                | "SELECTED",
                            );
                            // Dispatch event to notify other pages to refresh assignees
                            window.dispatchEvent(
                              new CustomEvent("assigneeReviewStatusUpdated", {
                                detail: {
                                  email,
                                  interviewId,
                                  reviewStatus: newValue,
                                },
                              }),
                            );
                          } catch (error) {
                            console.error(
                              "Error syncing review status:",
                              error,
                            );
                            // Don't show error to user - this is a background sync
                          }
                        }
                      }}
                    >
                      <SelectTrigger className="w-[180px]  bg-slate-50 rounded-2xl">
                        <SelectValue placeholder="Not Selected" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={CandidateStatus.NO_STATUS}>
                          <div className="flex items-center">
                            <div className="w-3 h-3 bg-gray-400 rounded-full mr-2" />
                            To Be Reviewed
                          </div>
                        </SelectItem>
                        <SelectItem value={CandidateStatus.NOT_SELECTED}>
                          <div className="flex items-center">
                            <div className="w-3 h-3 bg-red-500 rounded-full mr-2" />
                            Not Selected
                          </div>
                        </SelectItem>
                        <SelectItem value={CandidateStatus.POTENTIAL}>
                          <div className="flex items-center">
                            <div className="w-3 h-3 bg-yellow-500 rounded-full mr-2" />
                            Potential
                          </div>
                        </SelectItem>
                        <SelectItem value={CandidateStatus.SELECTED}>
                          <div className="flex items-center">
                            <div className="w-3 h-3 bg-green-500 rounded-full mr-2" />
                            Selected
                          </div>
                        </SelectItem>
                      </SelectContent>
                    </Select>
                    <AlertDialog>
                      <AlertDialogTrigger>
                        <Button
                          disabled={isClicked}
                          className="bg-red-500 hover:bg-red-600 p-2"
                        >
                          <TrashIcon size={16} className="" />
                        </Button>
                      </AlertDialogTrigger>

                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Are you sure?</AlertDialogTitle>

                          <AlertDialogDescription>
                            This action cannot be undone. This will permanently
                            delete this response.
                          </AlertDialogDescription>
                        </AlertDialogHeader>

                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>

                          <AlertDialogAction
                            className="bg-indigo-600 hover:bg-indigo-800"
                            onClick={async () => {
                              await onDeleteResponseClick();
                            }}
                          >
                            Continue
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                </div>
                <div className="flex flex-col mt-3">
                  <p className="font-semibold">Interview Recording</p>
                  <div className="flex flex-row gap-3 mt-2">
                    {(() => {
                      // responseData is refreshed by the poll effect below;
                      // call is fetched once on mount and never updated, so
                      // it can still hold the pre-transcode webm URL even
                      // after the poll has picked up the finished mp3 —
                      // responseData must win whenever it has a value.
                      const recordingUrl =
                        responseData?.details?.recording_url ||
                        call?.recording_url ||
                        (call as any)?.details?.recording_url;

                      if (!recordingUrl) {
                        return (
                          <p className="text-sm text-gray-500 italic">
                            Recording not available
                          </p>
                        );
                      }

                      // Hold the player back until the recording is on its
                      // final mp3 URL — the transcode from the raw webm
                      // upload runs as a fire-and-forget server job right
                      // after the interview ends, and webm has no seek index
                      // (see CountdownAudioPlayer above), so opening it too
                      // early gives recruiters a player that can't seek
                      // reliably. The poll effect above refreshes
                      // responseData until recording_status flips to
                      // "uploaded" (or a terminal failure state).
                      const recordingStatus =
                        responseData?.details?.recording_status;
                      const isWebm = /\.webm(\?|$)/i.test(recordingUrl);
                      const stillProcessing =
                        isWebm &&
                        recordingStatus !== "empty" &&
                        recordingStatus !== "upload_failed" &&
                        recordingStatus !== "failed_to_start";

                      if (stillProcessing) {
                        return (
                          <p className="text-sm text-gray-500 italic">
                            Recording is still processing — check back in a
                            moment.
                          </p>
                        );
                      }

                      return (
                        <CountdownAudioPlayer
                          src={recordingUrl}
                          durationHint={
                            responseData?.duration ||
                            (call?.start_timestamp && call?.end_timestamp
                              ? Math.round(
                                  (call.end_timestamp - call.start_timestamp) /
                                    1000,
                                )
                              : undefined)
                          }
                          filename={`interview-${call_id}.webm`}
                        />
                      );
                    })()}
                  </div>
                </div>
              </div>
            </div>
            {/* <div>{call.}</div> */}
          </div>
          <div className="bg-slate-200 rounded-2xl min-h-[120px] p-4 px-5 my-3">
            <p className="font-semibold my-2">General Summary</p>

            <div className="grid grid-cols-3 gap-4 my-2 mt-4 ">
              {analytics?.overallScore !== undefined && (
                <div className="flex flex-col gap-3 text-sm p-4 rounded-2xl bg-slate-50">
                  <div className="flex flex-row gap-2 align-middle">
                    <CircularProgress
                      classNames={{
                        svg: "w-28 h-28 drop-shadow-md",
                        indicator: "stroke-indigo-600",
                        track: "stroke-indigo-600/10",
                        value: "text-3xl font-semibold text-indigo-600",
                      }}
                      value={analytics?.overallScore}
                      strokeWidth={4}
                      showValueLabel={true}
                      formatOptions={{ signDisplay: "never" }}
                    />
                    <p className="font-medium my-auto text-xl">
                      Overall Hiring Score
                    </p>
                  </div>
                  <div className="">
                    <div className="font-medium ">
                      <span className="font-normal">Feedback: </span>
                      {analytics?.overallFeedback === undefined ? (
                        <Skeleton className="w-[200px] h-[20px]" />
                      ) : (
                        analytics?.overallFeedback
                      )}
                    </div>
                  </div>
                </div>
              )}
              {analytics?.communication && (
                <div className="flex flex-col gap-3 text-sm p-4 rounded-2xl bg-slate-50">
                  <div className="flex flex-row gap-2 align-middle">
                    <CircularProgress
                      classNames={{
                        svg: "w-28 h-28 drop-shadow-md",
                        indicator: "stroke-indigo-600",
                        track: "stroke-indigo-600/10",
                        value: "text-3xl font-semibold text-indigo-600",
                      }}
                      value={analytics?.communication.score}
                      maxValue={10}
                      minValue={0}
                      strokeWidth={4}
                      showValueLabel={true}
                      valueLabel={
                        <div className="flex items-baseline">
                          {analytics?.communication.score ?? 0}
                          <span className="text-xl ml-0.5">/10</span>
                        </div>
                      }
                      formatOptions={{ signDisplay: "never" }}
                    />
                    <p className="font-medium my-auto text-xl">Communication</p>
                  </div>
                  <div className="">
                    <div className="font-medium ">
                      <span className="font-normal">Feedback: </span>
                      {analytics?.communication.feedback === undefined ? (
                        <Skeleton className="w-[200px] h-[20px]" />
                      ) : (
                        analytics?.communication.feedback
                      )}
                    </div>
                  </div>
                </div>
              )}
              <div className="flex flex-col gap-3 text-sm p-4 rounded-2xl bg-slate-50">
                <div className="flex flex-row gap-3 items-center">
                  <p className="my-auto font-medium">User Sentiment: </p>
                  {(() => {
                    const userSentiment =
                      call?.call_analysis?.user_sentiment ||
                      (call as any)?.details?.call_analysis?.user_sentiment ||
                      responseData?.details?.call_analysis?.user_sentiment;

                    if (userSentiment === undefined) {
                      return (
                        <div className="flex items-center gap-2">
                          <span className="text-gray-500 italic">
                            Not available
                          </span>
                        </div>
                      );
                    }

                    const sentiment = userSentiment.toString().toLowerCase();
                    const isPositive = sentiment === "positive";
                    const isNegative = sentiment === "negative";
                    const isNeutral = sentiment === "neutral";

                    return (
                      <div className="flex items-center gap-2">
                        {/* Sentiment Badge with Icon */}
                        <div
                          className={`flex items-center gap-2 px-3 py-1.5 rounded-full font-semibold text-sm ${
                            isPositive
                              ? "bg-green-100 text-green-700 border border-green-300"
                              : isNegative
                                ? "bg-red-100 text-red-700 border border-red-300"
                                : isNeutral
                                  ? "bg-yellow-100 text-yellow-700 border border-yellow-300"
                                  : "bg-gray-100 text-gray-700 border border-gray-300"
                          }`}
                        >
                          {/* Icon */}
                          {isPositive && <Smile className="h-4 w-4" />}
                          {isNegative && <Frown className="h-4 w-4" />}
                          {isNeutral && <Meh className="h-4 w-4" />}

                          {/* Sentiment Text */}
                          <span>{userSentiment}</span>

                          {/* Colored Dot Indicator */}
                          <div
                            className={`h-2 w-2 rounded-full ${
                              isPositive
                                ? "bg-green-500"
                                : isNegative
                                  ? "bg-red-500"
                                  : isNeutral
                                    ? "bg-yellow-500"
                                    : "bg-gray-500"
                            }`}
                          />
                        </div>
                      </div>
                    );
                  })()}
                </div>
                <div className="">
                  <div className="font-medium  ">
                    <span className="font-normal">Call Summary: </span>
                    {(() => {
                      const callSummary =
                        call?.call_analysis?.call_summary ||
                        (call as any)?.details?.call_analysis?.call_summary ||
                        responseData?.details?.call_analysis?.call_summary;

                      return callSummary === undefined ? (
                        <span className="text-gray-500 italic">
                          Not available
                        </span>
                      ) : (
                        callSummary
                      );
                    })()}
                  </div>
                </div>
                {(() => {
                  const completionReason =
                    call?.call_analysis?.call_completion_rating_reason ||
                    (call as any)?.details?.call_analysis
                      ?.call_completion_rating_reason ||
                    responseData?.details?.call_analysis
                      ?.call_completion_rating_reason;

                  return (
                    completionReason && (
                      <p className="font-medium ">{completionReason}</p>
                    )
                  );
                })()}
              </div>
            </div>
          </div>

          {/* Accordion Section - All content in one block */}
          <div className="bg-slate-200 rounded-2xl p-4 px-5 my-3 mb-[20px]">
            <Accordion
              type="single"
              collapsible
              className="w-full"
              defaultValue="call-summary"
            >
              {/* Call Summary Accordion Item */}
              <AccordionItem
                value="call-summary"
                className="border-b border-slate-300"
              >
                <AccordionTrigger className="text-lg font-semibold hover:no-underline py-4">
                  Call Summary
                </AccordionTrigger>
                <AccordionContent className="pt-2 pb-4">
                  <div className="bg-slate-50 rounded-xl p-4">
                    <div className="font-medium">
                      <span className="font-normal">Call Summary: </span>
                      {(() => {
                        const callSummary =
                          call?.call_analysis?.call_summary ||
                          (call as any)?.details?.call_analysis?.call_summary ||
                          responseData?.details?.call_analysis?.call_summary;

                        return callSummary === undefined ? (
                          <span className="text-gray-500 italic">
                            Not available
                          </span>
                        ) : (
                          callSummary
                        );
                      })()}
                    </div>
                    {(() => {
                      const completionReason =
                        call?.call_analysis?.call_completion_rating_reason ||
                        (call as any)?.details?.call_analysis
                          ?.call_completion_rating_reason ||
                        responseData?.details?.call_analysis
                          ?.call_completion_rating_reason;

                      return (
                        completionReason && (
                          <p className="font-medium mt-2">{completionReason}</p>
                        )
                      );
                    })()}
                  </div>
                </AccordionContent>
              </AccordionItem>

              {/* Question Summary Accordion Item */}
              {analytics &&
                analytics.questionSummaries &&
                analytics.questionSummaries.length > 0 && (
                  <AccordionItem
                    value="question-summary"
                    className="border-b border-slate-300"
                  >
                    <AccordionTrigger className="text-lg font-semibold hover:no-underline py-4">
                      Question Summary
                    </AccordionTrigger>
                    <AccordionContent className="pt-2 pb-4">
                      <div className="rounded-md max-h-72 text-sm mt-3 py-3 leading-6 overflow-y-auto whitespace-pre-line px-2 bg-slate-50">
                        {analytics?.questionSummaries.map((qs, index) => (
                          <QuestionAnswerCard
                            key={qs.question}
                            questionNumber={index + 1}
                            question={qs.question}
                            answer={qs.summary}
                          />
                        ))}
                      </div>
                    </AccordionContent>
                  </AccordionItem>
                )}

              {/* Transcript Summary Accordion Item - Shows Q&A Pairs */}
              {qaPairs.length > 0 && (
                <AccordionItem
                  value="transcript-summary"
                  className="border-b border-slate-300"
                >
                  <AccordionTrigger className="text-lg font-semibold hover:no-underline py-4">
                    <div className="flex items-center justify-between w-full pr-4">
                      <span>Transcript Summary</span>
                      <span className="text-xs text-gray-600 font-medium">
                        {qaPairs.length} Q&A{" "}
                        {qaPairs.length === 1 ? "pair" : "pairs"}
                      </span>
                    </div>
                  </AccordionTrigger>
                  <AccordionContent className="pt-2 pb-4">
                    <div className="rounded-md max-h-96 text-sm mt-3 py-3 leading-6 overflow-y-auto whitespace-pre-line px-2 bg-slate-50">
                      {qaPairs.map((qa, index) => (
                        <QuestionAnswerCard
                          key={`qa-${index}`}
                          questionNumber={index + 1}
                          question={qa.question}
                          answer={qa.answer}
                        />
                      ))}
                    </div>
                  </AccordionContent>
                </AccordionItem>
              )}

              {/* Transcript Accordion Item */}
              <AccordionItem
                value="transcript"
                className="border-b border-slate-300"
              >
                <AccordionTrigger className="text-lg font-semibold hover:no-underline py-4">
                  <div className="flex items-center justify-between w-full pr-4">
                    <span>Transcript</span>
                    {userResponses.length > 1 && (
                      <div className="text-xs text-gray-600 flex items-center gap-2">
                        <span className="font-semibold">
                          Interview Attempts:
                        </span>
                        <span className="px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-700 font-medium">
                          {userResponses.length}
                        </span>
                      </div>
                    )}
                  </div>
                </AccordionTrigger>
                <AccordionContent className="pt-2 pb-4">
                  <div className="rounded-2xl text-sm max-h-96 overflow-y-auto whitespace-pre-line px-2 bg-slate-50">
                    <div
                      className="text-sm p-4 rounded-2xl leading-5"
                      // eslint-disable-next-line react/no-danger
                      dangerouslySetInnerHTML={{
                        __html:
                          transcript && transcript.trim().length > 0
                            ? marked(transcript)
                            : '<p class="text-gray-500 italic">No transcript available for this interview.</p>',
                      }}
                    />
                  </div>
                </AccordionContent>
              </AccordionItem>

              {/* Violations Details Accordion Item */}
              {violationsSummary.length > 0 && (
                <AccordionItem
                  value="violations-details"
                  className="border-b border-slate-300"
                >
                  <AccordionTrigger className="text-lg font-semibold hover:no-underline py-4">
                    <div className="flex items-center justify-between w-full pr-4">
                      <span className="flex items-center gap-2">
                        <Shield className="h-5 w-5 text-red-500" />
                        Violations Details
                      </span>
                      <span className="text-xs text-red-600 font-medium px-2 py-0.5 rounded-full bg-red-100">
                        {violationsSummary.length} total
                      </span>
                    </div>
                  </AccordionTrigger>
                  <AccordionContent className="pt-2 pb-4">
                    <div className="space-y-4">
                      {/* Violation Summary Cards - 5 boxes in 1 row */}
                      <div className="grid grid-cols-5 gap-3">
                        {/* Tab Switch Count */}
                        <div
                          className={`p-3 rounded-lg ${tabSwitchCount > 0 ? "bg-orange-50 border border-orange-200" : "bg-green-50 border border-green-200"}`}
                        >
                          <div className="flex items-center gap-2">
                            <Monitor
                              className={`h-4 w-4 ${tabSwitchCount > 0 ? "text-orange-500" : "text-green-500"}`}
                            />
                            <span className="text-xs font-medium text-gray-600">
                              Tab Switches
                            </span>
                          </div>
                          <p
                            className={`text-lg font-bold mt-1 ${tabSwitchCount > 0 ? "text-orange-600" : "text-green-600"}`}
                          >
                            {tabSwitchCount}
                          </p>
                        </div>

                        {/* Face Mismatch Count */}
                        <div
                          className={`p-3 rounded-lg ${faceMismatchCount > 0 ? "bg-red-50 border border-red-200" : "bg-green-50 border border-green-200"}`}
                        >
                          <div className="flex items-center gap-2">
                            <UserX
                              className={`h-4 w-4 ${faceMismatchCount > 0 ? "text-red-500" : "text-green-500"}`}
                            />
                            <span className="text-xs font-medium text-gray-600">
                              Face Mismatch
                            </span>
                          </div>
                          <p
                            className={`text-lg font-bold mt-1 ${faceMismatchCount > 0 ? "text-red-600" : "text-green-600"}`}
                          >
                            {faceMismatchCount}
                            {faceMismatchTotal > 0 && (
                              <span className="text-sm font-normal text-gray-500">
                                /{faceMismatchTotal}
                              </span>
                            )}
                          </p>
                          {faceMismatchTotal > 0 && (
                            <p className="text-xs text-gray-500">
                              Total checks: {faceMismatchTotal}
                            </p>
                          )}
                        </div>

                        {/* Camera Off Count */}
                        <div
                          className={`p-3 rounded-lg ${cameraOffCount > 0 ? "bg-yellow-50 border border-yellow-200" : "bg-green-50 border border-green-200"}`}
                        >
                          <div className="flex items-center gap-2">
                            <CameraOff
                              className={`h-4 w-4 ${cameraOffCount > 0 ? "text-yellow-600" : "text-green-500"}`}
                            />
                            <span className="text-xs font-medium text-gray-600">
                              Camera Off
                            </span>
                          </div>
                          <p
                            className={`text-lg font-bold mt-1 ${cameraOffCount > 0 ? "text-yellow-600" : "text-green-600"}`}
                          >
                            {cameraOffCount}
                            {cameraOffTotal > 0 && (
                              <span className="text-sm font-normal text-gray-500">
                                /{cameraOffTotal}
                              </span>
                            )}
                          </p>
                          {cameraOffTotal > 0 && (
                            <p className="text-xs text-gray-500">
                              Total checks: {cameraOffTotal}
                            </p>
                          )}
                        </div>

                        {/* Multiple Person Count */}
                        <div
                          className={`p-3 rounded-lg ${multiplePersonCount > 0 ? "bg-purple-50 border border-purple-200" : "bg-green-50 border border-green-200"}`}
                        >
                          <div className="flex items-center gap-2">
                            <Users
                              className={`h-4 w-4 ${multiplePersonCount > 0 ? "text-purple-500" : "text-green-500"}`}
                            />
                            <span className="text-xs font-medium text-gray-600">
                              Multiple Persons
                            </span>
                          </div>
                          <p
                            className={`text-lg font-bold mt-1 ${multiplePersonCount > 0 ? "text-purple-600" : "text-green-600"}`}
                          >
                            {multiplePersonCount}
                            {multiplePersonTotal > 0 && (
                              <span className="text-sm font-normal text-gray-500">
                                /{multiplePersonTotal}
                              </span>
                            )}
                          </p>
                          {multiplePersonTotal > 0 && (
                            <p className="text-xs text-gray-500">
                              Total checks: {multiplePersonTotal}
                            </p>
                          )}
                        </div>

                        {/* Total Violations */}
                        <div
                          className={`p-3 rounded-lg ${tabSwitchCount + faceMismatchCount + cameraOffCount + multiplePersonCount > 0 ? "bg-red-50 border border-red-200" : "bg-green-50 border border-green-200"}`}
                        >
                          <div className="flex items-center gap-2">
                            <Shield
                              className={`h-4 w-4 ${tabSwitchCount + faceMismatchCount + cameraOffCount + multiplePersonCount > 0 ? "text-red-500" : "text-green-500"}`}
                            />
                            <span className="text-xs font-medium text-gray-600">
                              Total Violations
                            </span>
                          </div>
                          <p
                            className={`text-lg font-bold mt-1 ${tabSwitchCount + faceMismatchCount + cameraOffCount + multiplePersonCount > 0 ? "text-red-600" : "text-green-600"}`}
                          >
                            {tabSwitchCount +
                              faceMismatchCount +
                              cameraOffCount +
                              multiplePersonCount}
                          </p>
                        </div>
                      </div>

                      {/* Violation Timeline - 5 boxes per row */}
                      <p className="text-sm font-semibold text-gray-700">
                        Violation Timeline
                      </p>
                      <div className="grid grid-cols-5 gap-3 max-h-80 overflow-y-auto">
                        {violationsSummary.map((violation, index) => (
                          <div
                            key={index}
                            className={`p-3 rounded-lg border ${
                              violation.type === "tab_switch"
                                ? "bg-orange-50 border-orange-200"
                                : violation.type === "face_mismatch"
                                  ? "bg-red-50 border-red-200"
                                  : violation.type === "camera_off"
                                    ? "bg-yellow-50 border-yellow-200"
                                    : "bg-purple-50 border-purple-200"
                            }`}
                          >
                            <div className="flex items-center gap-2 mb-2">
                              <div
                                className={`p-1.5 rounded-full ${
                                  violation.type === "tab_switch"
                                    ? "bg-orange-100"
                                    : violation.type === "face_mismatch"
                                      ? "bg-red-100"
                                      : violation.type === "camera_off"
                                        ? "bg-yellow-100"
                                        : "bg-purple-100"
                                }`}
                              >
                                {violation.type === "tab_switch" && (
                                  <Monitor className="h-3 w-3 text-orange-600" />
                                )}
                                {violation.type === "face_mismatch" && (
                                  <UserX className="h-3 w-3 text-red-600" />
                                )}
                                {violation.type === "camera_off" && (
                                  <CameraOff className="h-3 w-3 text-yellow-600" />
                                )}
                                {violation.type === "multiple_person" && (
                                  <Users className="h-3 w-3 text-purple-600" />
                                )}
                              </div>
                              <span
                                className={`text-xs font-semibold ${
                                  violation.type === "tab_switch"
                                    ? "text-orange-700"
                                    : violation.type === "face_mismatch"
                                      ? "text-red-700"
                                      : violation.type === "camera_off"
                                        ? "text-yellow-700"
                                        : "text-purple-700"
                                }`}
                              >
                                {violation.type === "tab_switch" &&
                                  "Tab Switch"}
                                {violation.type === "face_mismatch" &&
                                  "Face Mismatch"}
                                {violation.type === "camera_off" &&
                                  "Camera Off"}
                                {violation.type === "multiple_person" &&
                                  "Multiple Persons"}
                              </span>
                            </div>
                            <p className="text-xs text-gray-500">
                              {new Date(
                                violation.timestamp,
                              ).toLocaleTimeString()}
                            </p>
                            {violation.details && (
                              <p
                                className="text-xs text-gray-500 mt-1 truncate"
                                title={violation.details}
                              >
                                {violation.details}
                              </p>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  </AccordionContent>
                </AccordionItem>
              )}
            </Accordion>
          </div>
        </>
      )}
    </div>
  );
}

export default CallInfo;
