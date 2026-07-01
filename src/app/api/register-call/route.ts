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

    await lockRetake(data.email, data.interview_id);

    await logAttemptStarted(req, {
      callId,
      interviewerId: body.interviewer_id,
      interviewId: data.interview_id,
      candidateEmail: data.email,
      candidateName: data.name,
    });

    const host = endpoint.replace(/^https?:\/\//, "").replace(/\/$/, "");
    const wsUrl =
      `wss://${host}/voice-live/realtime` +
      `?api-version=${encodeURIComponent(apiVersion)}` +
      `&model=${encodeURIComponent(model)}` +
      `&api-key=${encodeURIComponent(apiKey)}`;

    logger.info("Voice Live call registered", { call_id: callId });

    return NextResponse.json({
      provider: "voicelive",
      call_id: callId,
      wsUrl,
      sessionConfig: {
        modalities: ["audio", "text"],
        instructions,
        voice: { name: voice, type: "azure-standard", temperature: 0.8 },
        input_audio_format: "pcm16",
        output_audio_format: "pcm16",
        input_audio_sampling_rate: 24000,
        turn_detection: {
          type: "server_vad",
          // Higher threshold = less sensitive to background noise (mic fan,
          // typing, ambient hum). In an interview the candidate is usually
          // the only speaker, so we'd rather miss faint speech than cut off
          // the interviewer for noise.
          threshold: 0.7,
          prefix_padding_ms: 300,
          // 1200 ms gives the candidate enough pause time between clauses
          // without the agent jumping in. 800 ms was too short and caused
          // the agent to interrupt mid-sentence on natural speech pauses.
          silence_duration_ms: 1200,
        },
        // Force English transcription so non-English speech doesn't drift
        // the agent into another language (Whisper otherwise auto-detects).
        input_audio_transcription: { model: "whisper-1", language: "en" },
        tools: [
          {
            type: "function",
            name: "end_interview",
            description:
              "ENDS the interview session immediately. STRICT REQUIREMENT: you must SPEAK a warm closing message thanking the candidate by name BEFORE calling this tool. Never call this in the same response as the closing message — first speak the goodbye, wait for the candidate's response (or silence), then in your NEXT response call this tool. If you call this without a spoken goodbye first, the candidate will hear nothing and the experience will feel abrupt. Use when all questions are covered, the candidate refused 3 separate questions, the candidate explicitly asked to end, or the time limit is reached.",
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

  await lockRetake(body.dynamic_data?.email, body.dynamic_data?.interview_id);

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

  await logAttemptStarted(req, {
    callId: registerCallResponse.call_id,
    interviewerId,
    interviewId: body.dynamic_data?.interview_id,
    candidateEmail: body.dynamic_data?.email,
    candidateName: body.dynamic_data?.name,
  });

  return NextResponse.json(
    {
      registerCallResponse,
    },
    { status: 200 },
  );
}
