import { logger } from "@/lib/logger";
import { InterviewerService } from "@/services/interviewers.service";
import { InterviewService } from "@/services/interviews.service";

import { NextRequest, NextResponse } from "next/server";
import Retell from "retell-sdk";
import { logActivityFromRequest } from "@/lib/user-activity-log";
import { createClient } from "@supabase/supabase-js";
import { buildVoiceLiveInterviewPrompt } from "@/lib/constants";
import { randomUUID } from "crypto";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
);

const retellClient = new Retell({
  apiKey: process.env.RETELL_API_KEY || "",
});

/**
 * Disables retake immediately for the candidate, regardless of provider.
 * Prevents re-attempts even if the candidate closes the tab mid-interview.
 */
async function lockRetake(candidateEmail?: string, interviewId?: string) {
  if (!candidateEmail || !interviewId) return;
  try {
    await supabase
      .from("interview_assignee")
      .update({ allow_retake: false })
      .ilike("email", candidateEmail)
      .eq("interview_id", interviewId);
  } catch (err) {
    logger.error(
      "Failed to disable retake at call start:",
      err instanceof Error ? err.message : String(err),
    );
  }
}

async function logAttemptStarted(
  req: NextRequest,
  params: {
    callId: string;
    interviewerId: any;
    interviewId?: string;
    candidateEmail?: string;
    candidateName?: string;
  },
) {
  try {
    await logActivityFromRequest(req, "interview_attempt_started", {
      user_id: null,
      resource_type: "interview",
      resource_id: params.interviewId || null,
      details: {
        call_id: params.callId,
        interview_id: params.interviewId || null,
        interviewer_id: params.interviewerId,
        candidate_email: params.candidateEmail || null,
        candidate_name: params.candidateName || null,
        start_timestamp: new Date().toISOString(),
      },
    });
  } catch (err) {
    logger.error(
      "Failed to log interview attempt start:",
      err instanceof Error ? err.message : String(err),
    );
  }
}

export async function POST(req: NextRequest, _res: Response) {
  logger.info("register-call request received");

  const body = await req.json();
  const useVoiceLive = process.env.USE_VOICE_LIVE === "true";
  // Recruiter preview (?preview=true on the call page). The session is created
  // normally so the recruiter hears a real interview, but no persistent side
  // effect runs: no retake lock, no activity log, and — client-side — no
  // response row, recording upload, analytics, or notification email.
  const isPreviewCall = body.preview === true;

  // ──────────────────────────────────────────────────────────────────────
  // Voice Live path
  // ──────────────────────────────────────────────────────────────────────
  if (useVoiceLive) {
    const endpoint = process.env.AZURE_VOICELIVE_ENDPOINT;
    const apiKey = process.env.AZURE_VOICELIVE_API_KEY;
    const model =
      process.env.AZURE_VOICELIVE_MODEL || "gpt-4o-mini-realtime-preview";
    const voice =
      process.env.AZURE_VOICELIVE_VOICE || "en-IN-Diya:DragonHDLatestNeural";
    const apiVersion = process.env.AZURE_VOICELIVE_API_VERSION || "2025-10-01";
    // How much the model "thinks" before responding. Only reasoning-capable
    // models (gpt-realtime 2.x, gpt-5.x) accept this — others REJECT the whole
    // session.update with a misleading "the `type` field of
    // SessionUpdatedMessage should be 'session.update'" error, which kills the
    // interview before it starts. So it is opt-in: unset means we omit the
    // field entirely and behave exactly as before.
    // Allowed: none | minimal | low | medium | high | xhigh.
    const reasoningEffort = process.env.AZURE_VOICELIVE_REASONING_EFFORT;

    // Bring Your Own Model (BYOM). Without this, `model` names one of
    // Microsoft's FULLY MANAGED Voice Live models and the request runs on their
    // shared multi-tenant capacity — which is invisible in your Foundry metrics
    // and gives you no control over throughput. Setting `profile` flips the
    // meaning of `model` to "a deployment name in MY Foundry resource", so
    // traffic runs on your own deployment (and can use its PTU/provisioned
    // capacity and content-filter settings).
    //
    // Modes: byom-azure-openai-realtime (gpt-realtime, gpt-realtime-mini)
    //        byom-azure-openai-chat-completion (gpt-5.x, grok, etc.)
    //        byom-foundry-anthropic-messages (Claude, preview)
    //
    // Opt-in: unset means the URL is built exactly as before.
    // Pick the transcription model to match the chat model's family. Only the
    // multimodal gpt-realtime* models accept OpenAI transcribers (whisper-1,
    // gpt-4o-transcribe); everything else must use Azure speech to text.
    // Getting this wrong makes Azure reject session.update outright, which
    // surfaces as "WebSocket closed unexpectedly" before the agent ever speaks.
    const isMultimodalRealtimeModel = /^gpt-realtime/i.test(model);
    const transcriptionModel =
      process.env.AZURE_VOICELIVE_TRANSCRIPTION_MODEL ||
      (isMultimodalRealtimeModel ? "whisper-1" : "azure-speech");

    // Playback jitter-buffer tuning, passed through to the browser client
    // (which can't read env vars itself). Raise these if the agent's voice cuts
    // out mid-sentence on small network/generation gaps; the cost is that much
    // added delay before the agent starts speaking, once per turn.
    const playbackLeadMs = Number(process.env.AZURE_VOICELIVE_PLAYBACK_LEAD_MS);
    const playbackMinLeadMs = Number(
      process.env.AZURE_VOICELIVE_PLAYBACK_MIN_LEAD_MS,
    );

    const byomProfile = process.env.AZURE_VOICELIVE_BYOM_PROFILE;
    // Only needed when the model deployment lives in a DIFFERENT Foundry
    // resource than the one serving Voice Live. Value is the bare resource
    // name, no domain suffix.
    const foundryResourceOverride =
      process.env.AZURE_VOICELIVE_FOUNDRY_RESOURCE_OVERRIDE;

    if (!endpoint || !apiKey) {
      logger.error("Voice Live env vars missing");

      return NextResponse.json(
        {
          error:
            "AZURE_VOICELIVE_ENDPOINT and AZURE_VOICELIVE_API_KEY must be set when USE_VOICE_LIVE=true",
        },
        { status: 500 },
      );
    }

    const data = body.dynamic_data || {};

    // Split the comma-joined question string back into an ordered list so
    // the prompt can present them as numbered items the agent can track.
    const questionsList: string[] = String(data.questions || "")
      .split(",")
      .map((q: string) => q.trim())
      .filter(Boolean);

    // Normalize the time limit into a human phrase with an explicit unit.
    // `data.mins` arrives as a bare value like "15" (interview.time_duration),
    // which made the prompt read "keep the interview for 15 or short" — no
    // unit, so the model can't reliably reason about pacing. Turn a bare
    // number into "15 minutes"; leave already-formatted strings untouched.
    const rawMins = data.mins ?? "10";
    const minsPhrase = /^\s*\d+\s*$/.test(String(rawMins))
      ? `${String(rawMins).trim()} minutes`
      : String(rawMins);

    const instructions = buildVoiceLiveInterviewPrompt({
      mins: minsPhrase,
      name: data.name || "the candidate",
      objective: data.objective || "general screening",
      questionsList,
    });

    const callId = `vl-${randomUUID()}`;

    // Recruiter preview: register the call (we still need a live Voice Live
    // session) but skip every persistent side effect — no retake lock, no
    // activity log. The client skips the response row, recording, and emails.
    if (isPreviewCall) {
      logger.info("Voice Live PREVIEW call registered (nothing persisted)", {
        call_id: callId,
        model,
        transcription: transcriptionModel,
      });
    } else {
      await lockRetake(data.email, data.interview_id);

      await logAttemptStarted(req, {
        callId,
        interviewerId: body.interviewer_id,
        interviewId: data.interview_id,
        candidateEmail: data.email,
        candidateName: data.name,
      });
    }

    const host = endpoint.replace(/^https?:\/\//, "").replace(/\/$/, "");
    const wsUrl =
      `wss://${host}/voice-live/realtime` +
      `?api-version=${encodeURIComponent(apiVersion)}` +
      // `profile` must precede nothing in particular, but when present it
      // reinterprets `model` as one of YOUR Foundry deployment names.
      (byomProfile ? `&profile=${encodeURIComponent(byomProfile)}` : "") +
      `&model=${encodeURIComponent(model)}` +
      (foundryResourceOverride
        ? `&foundry-resource-override=${encodeURIComponent(foundryResourceOverride)}`
        : "") +
      `&api-key=${encodeURIComponent(apiKey)}`;

    // Log which path we took so a latency investigation can tell at a glance
    // whether a given call ran on managed capacity or your own deployment.
    logger.info("Voice Live call registered", {
      call_id: callId,
      model,
      transcription: transcriptionModel,
      mode: byomProfile ? `byom (${byomProfile})` : "managed",
    });

    return NextResponse.json({
      provider: "voicelive",
      call_id: callId,
      wsUrl,
      // Only sent when explicitly configured; the client keeps its own defaults
      // (500 / 600 ms) otherwise. NaN from an unset/garbage env var is filtered
      // out here so it never reaches the client.
      ...(Number.isFinite(playbackLeadMs) && playbackLeadMs > 0
        ? { playbackLeadMs }
        : {}),
      ...(Number.isFinite(playbackMinLeadMs) && playbackMinLeadMs > 0
        ? { playbackMinLeadMs }
        : {}),
      sessionConfig: {
        modalities: ["audio", "text"],
        instructions,
        voice: { name: voice, type: "azure-standard", temperature: 0.8 },
        input_audio_format: "pcm16",
        output_audio_format: "pcm16",
        input_audio_sampling_rate: 24000,
        // Reasoning models (gpt-realtime 2.x, gpt-5.x) can spend time
        // "thinking" before emitting any audio — a long pause BEFORE the agent
        // speaks, then normal streaming. Azure's docs are explicit that higher
        // effort increases latency and lower effort gives faster responses, so
        // on a realtime voice call this is worth tuning down.
        //
        // Spread conditionally: models that don't support reasoning reject the
        // entire session.update when this field is present, so we only include
        // it when explicitly opted in via AZURE_VOICELIVE_REASONING_EFFORT.
        ...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {}),
        turn_detection: {
          type: "server_vad",
          // Higher threshold = less sensitive to background noise (mic fan,
          // typing, ambient hum). In an interview the candidate is usually
          // the only speaker, so we'd rather miss faint speech than cut off
          // the interviewer for noise.
          threshold: 0.7,
          prefix_padding_ms: 300,
          // How long the candidate must be silent before the agent treats the
          // answer as finished. History: 800 ms caused the agent to interrupt
          // mid-sentence on natural speech pauses; 1200 ms fixed that but still
          // cut off candidates who paused mid-thought on harder questions.
          // 3000 ms prioritises never interrupting over conversational pace —
          // it pushes the total gap before the agent replies to roughly 4-4.5s
          // (3s here + model generation + the client's playback lead), which is
          // long enough that some candidates may think the call has frozen.
          silence_duration_ms: 3000,
        },
        // Force English transcription so non-English speech doesn't drift the
        // agent into another language (auto-detect otherwise).
        //
        // The transcription model MUST match the chat model's family, or Azure
        // rejects the whole session.update and the WebSocket closes before the
        // interview starts. `whisper-1` (and the gpt-4o-transcribe variants) are
        // only valid with the multimodal gpt-realtime* models; every other model
        // — gpt-5*, gpt-4.1*, gpt-4o* — routes audio through Azure speech to
        // text and needs `azure-speech`.
        input_audio_transcription: {
          model: transcriptionModel,
          language: "en",
        },
        tools: [
          {
            type: "function",
            name: "end_interview",
            description:
              "ENDS the interview session immediately. STRICT REQUIREMENT: you must SPEAK a warm closing message thanking the candidate by name BEFORE calling this tool. Never call this in the same response as the closing message — first speak the goodbye, wait for the candidate's response (or silence), then in your NEXT response call this tool. If you call this without a spoken goodbye first, the candidate will hear nothing and the experience will feel abrupt. Use when all questions are covered, the candidate refused 3 separate questions, the candidate explicitly asked to end, or the WRAP-UP PHASE is active and the candidate has finished their final answer. Do NOT call this based on your own guess about elapsed time — wait for the explicit WRAP-UP PHASE instruction.",
            parameters: {
              type: "object",
              properties: {
                reason: {
                  type: "string",
                  enum: [
                    "all_questions_covered",
                    "candidate_refused_to_answer",
                    "candidate_requested_end",
                    "time_expired",
                  ],
                  description: "Why the interview is ending",
                },
              },
              required: ["reason"],
            },
          },
          {
            type: "function",
            name: "report_refusal",
            description:
              "Report that the candidate has REFUSED to answer the current question. Use ONLY for active refusals (declining, refusing, 'I don't want to tell you', 'no comment', 'skip this'). Do NOT call this for 'I don't know', 'not sure', or short genuine answers — those are fair answers, not refusals. Call exactly once per refused question, then move on to the next question. After 3 refusals across the interview the session will be ended automatically.",
            parameters: {
              type: "object",
              properties: {
                reason: {
                  type: "string",
                  description:
                    "One short sentence describing what the candidate said that constituted a refusal.",
                },
              },
              required: ["reason"],
            },
          },
        ],
        tool_choice: "auto",
      },
    });
  }

  // ──────────────────────────────────────────────────────────────────────
  // Retell path (legacy / default)
  // ──────────────────────────────────────────────────────────────────────
  const interviewerId = body.interviewer_id;
  const interviewer = await InterviewerService.getInterviewer(interviewerId);

  if (!interviewer?.agent_id) {
    logger.error("Interviewer or agent_id not found");

    return NextResponse.json(
      { error: "Interviewer not found or missing agent_id" },
      { status: 404 },
    );
  }

  // Optionally fetch Retell agent details to get voice and other configuration
  try {
    const retellAgentDetails = await InterviewerService.getRetellAgentDetails(
      interviewer.agent_id,
    );
    if (retellAgentDetails) {
      logger.info(
        `Retrieved Retell agent details for agent_id: ${interviewer.agent_id}`,
        {
          agent_name: interviewer.name,
          voice_id: retellAgentDetails.voice_id || "N/A",
        },
      );
    }
  } catch (error) {
    // Non-critical error - continue even if we can't fetch Retell details
    logger.warn(
      "Could not fetch Retell agent details (non-critical):",
      error instanceof Error ? error.message : String(error),
    );
  }

  const callParams: any = {
    agent_id: interviewer.agent_id,
    retell_llm_dynamic_variables: body.dynamic_data,
    opt_out_sensitive_data_storage: false, // Enable recording
  };

  // Preview must not consume the candidate's attempt.
  if (!isPreviewCall) {
    await lockRetake(body.dynamic_data?.email, body.dynamic_data?.interview_id);
  }

  const registerCallResponse =
    await retellClient.call.createWebCall(callParams);

  logger.info("Call registered successfully", {
    call_id: registerCallResponse.call_id,
    interviewer_id: interviewerId,
    interviewer_name: interviewer.name,
    agent_id: interviewer.agent_id,
  });

  // Track call creation for visibility (no direct cost)
  const interviewId = body.dynamic_data?.interview_id;

  // Fetch interview to get organization_id and user_id for proper API usage tracking
  let organizationId: string | undefined;
  let userId: string | undefined;
  if (interviewId) {
    try {
      const interview = await InterviewService.getInterviewById(interviewId);
      if (interview) {
        organizationId = interview.organization_id;
        userId = interview.user_id;
      }
    } catch (err) {
      logger.warn("Could not fetch interview for API usage tracking", {
        error: err,
      });
    }
  }

  if (!isPreviewCall) {
    await logAttemptStarted(req, {
      callId: registerCallResponse.call_id,
      interviewerId,
      interviewId: body.dynamic_data?.interview_id,
      candidateEmail: body.dynamic_data?.email,
      candidateName: body.dynamic_data?.name,
    });
  }

  return NextResponse.json(
    {
      registerCallResponse,
    },
    { status: 200 },
  );
}
