import { NextRequest, NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { ResponseService } from "@/services/responses.service";
import { InterviewService } from "@/services/interviews.service";
import { generateInterviewAnalytics } from "@/services/analytics.service";
import { ApiUsageService } from "@/services/api-usage.service";
import { assigneeService } from "@/services/users.service";
import { getUserById } from "@/lib/auth";
import { logActivityFromRequest } from "@/lib/user-activity-log";

export const dynamic = "force-dynamic";

/**
 * Voice Live equivalent of Retell's response-webhook + get-call flow.
 *
 * Called by the browser when the Voice Live session ends. Owns the entire
 * end-of-call sequence so the client doesn't have to race a second write
 * path against this one:
 *   1. Persists transcript + violation counts + violations_summary to the
 *      `response` row in a single saveResponse call.
 *   2. Runs the same generateInterviewAnalytics pipeline.
 *   3. Records voice cost into `api_usage` (service="azure-voicelive").
 *   4. Marks the assignee as INTERVIEW_COMPLETED + locks retake.
 *   5. Triggers the recruiter notification email.
 *
 * The Retell flow keeps doing the violation+assignee+email update on the
 * client (in src/components/call/index.tsx); for Voice Live that client-side
 * effect is gated off and everything is centralized here.
 */
export async function POST(req: NextRequest) {
  logger.info("voice-live/save-call request received");

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const {
    call_id,
    transcript,
    duration_seconds,
    usage,
    model,
    violations_summary,
    tab_switch_count,
    face_mismatch_count,
    camera_off_count,
    multiple_person_count,
    face_mismatch_total,
    camera_off_total,
    multiple_person_total,
    recording_url,
  } = body;

  if (!call_id || !Array.isArray(transcript)) {
    return NextResponse.json(
      { error: "call_id and transcript[] are required" },
      { status: 400 },
    );
  }

  // 1. Look up the existing response row created at call start.
  // Defensive: if `createResponse` failed silently in the browser, the row
  // won't exist yet. In that case, try to create it now using interview_id
  // from the request body so we don't 404 and lose the interview entirely.
  let existing = await ResponseService.getResponseByCallId(call_id);
  if (!existing) {
    logger.warn(
      `No response row found for ${call_id} — creating one from save-call body`,
    );
    const fallbackInterviewId = body.interview_id;
    if (!fallbackInterviewId) {
      logger.error(
        `Cannot create response row — no interview_id in save-call body either`,
      );

      return NextResponse.json(
        { error: "Response not found and no interview_id to create one" },
        { status: 400 },
      );
    }
    // createResponse now throws on DB error. It can also fail on a duplicate
    // call_id if two save paths (e.g. the async POST and the unload beacon)
    // race to create the row. In either case, re-read: if the row exists now,
    // another path won the race and we proceed normally; otherwise surface a
    // 500 so the client retries.
    try {
      const createdId = await ResponseService.createResponse({
        call_id,
        interview_id: fallbackInterviewId,
        email: body.email || null,
        name: body.name || null,
      });
      if (!createdId) {
        logger.error(`Failed to create fallback response row for ${call_id}`);
      }
    } catch (err) {
      logger.warn(
        `createResponse in save-call failed (possibly a concurrent create) for ${call_id}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
    existing = await ResponseService.getResponseByCallId(call_id);
    if (!existing) {
      return NextResponse.json(
        { error: "Failed to create or read back response row" },
        { status: 500 },
      );
    }
  }

  const interviewId = existing.interview_id;
  if (!interviewId) {
    return NextResponse.json(
      { error: "Response has no interview_id" },
      { status: 400 },
    );
  }

  // 2. Build BOTH transcript shapes the rest of the app expects:
  //    - transcript: a string in the same format Retell produces
  //      ("Agent: ...\nUser: ...") — used by generateInterviewAnalytics
  //      and the dashboard's plain-text transcript view.
  //    - transcript_object: Array<{ role: "agent" | "user", content }>
  //      Used by the dashboard's structured transcript view in
  //      src/components/call/callInfo.tsx.
  const transcriptObject = transcript.map((t: any) => ({
    role: t.role === "assistant" ? "agent" : "user",
    content: String(t.content || ""),
  }));

  const transcriptString = transcriptObject
    .map((t: any) => {
      const label = t.role === "agent" ? "Agent" : "User";

      return `${label}: ${t.content}`;
    })
    .join("\n");

  // 3. Persist transcript first. Matches the Retell flow's ordering in
  // /api/get-call — if analytics later fails, the transcript is still saved
  // and the response row is usable.
  // IMPORTANT: include a non-null `call_analysis` field. The dashboard's
  // response-list query in src/services/responses.service.ts filters with
  //   .or("details.is.null, details->call_analysis.not.is.null")
  // Retell calls naturally include call_analysis in their stored details;
  // without it, our Voice Live responses are hidden from the dashboard.
  // We populate it with the same shape Retell uses so any downstream code
  // that reads details.call_analysis.call_summary continues to work.
  const callDetails: Record<string, any> = {
    call_id,
    transcript: transcriptString,
    transcript_object: transcriptObject,
    duration_seconds: duration_seconds || 0,
    source: "azure-voicelive",
    usage,
    model,
    call_analysis: {
      call_summary: "",
      user_sentiment: "Unknown",
      call_successful: true,
      // Populated later from generated analytics if we have it
    },
  };

  // Azure Blob URL for the stereo audio recording (candidate L, agent R).
  // Stored under details.recording_url to match the shape the Retell flow
  // produces — the audio player in src/components/call/callInfo.tsx already
  // reads call.recording_url / details.recording_url, so no UI change needed.
  if (recording_url && typeof recording_url === "string") {
    callDetails.recording_url = recording_url;
  }

  // Bundle violation data into the same write so we never race the
  // separate client-side violation effect (which is gated off for Voice Live
  // in src/components/call/index.tsx).
  const violationsArray = Array.isArray(violations_summary)
    ? violations_summary
    : [];

  // First write also flips is_ended=true. Critical for spinner parity with
  // Retell: the dashboard's getAllResponses filters with .eq("is_ended", true),
  // so the row only becomes visible to the recruiter UI after this. We want
  // it visible BEFORE analytics runs so the interviewCard can show its
  // "in progress" loader during the analytics window — same UX as Retell,
  // where the violation useEffect writes is_ended=true ahead of the webhook.
  // is_analysed stays false until analytics actually succeeds in step 5.
  // This first write is the critical one — it flips is_ended=true (making the
  // row visible to recruiters) and persists the transcript + violations. If it
  // fails we MUST tell the client so it retries, instead of silently returning
  // success while the interview stays lost. saveResponse now throws on error.
  try {
    await ResponseService.saveResponse(
      {
        details: callDetails,
        duration: duration_seconds || 0,
        is_ended: true,
        tab_switch_count: tab_switch_count ?? 0,
        face_mismatch_count: face_mismatch_count ?? 0,
        camera_off_count: camera_off_count ?? 0,
        multiple_person_count: multiple_person_count ?? 0,
        face_mismatch_total: face_mismatch_total ?? 0,
        camera_off_total: camera_off_total ?? 0,
        multiple_person_total: multiple_person_total ?? 0,
        violations_summary: violationsArray,
        candidate_status: "NO_STATUS",
      },
      call_id,
    );
  } catch (err) {
    logger.error(
      "voice-live/save-call: primary transcript write failed",
      err instanceof Error ? err.message : String(err),
    );

    return NextResponse.json(
      { error: "Failed to persist interview transcript" },
      { status: 500 },
    );
  }

  // 4. Run analytics. Pass the STRING form — generateInterviewAnalytics
  // requires `transcript: string` (line 18 of analytics.service.ts).
  let analytics: any = null;
  try {
    const result = await generateInterviewAnalytics({
      callId: call_id,
      interviewId,
      transcript: transcriptString,
    });
    analytics = result.analytics;
  } catch (err) {
    logger.error(
      "generateInterviewAnalytics failed for Voice Live call",
      err instanceof Error ? err.message : String(err),
    );
  }

  // 5. Final save — flip the flags now that analytics has run (or has been
  // attempted). Also refresh details.call_analysis from analytics so the
  // dashboard's response list (which filters on details->call_analysis)
  // shows the row reliably and any downstream code reading call_summary /
  // user_sentiment gets meaningful values.
  //
  // Crucial: only mark is_analysed=true when analytics actually succeeded.
  // Otherwise the dashboard treats the row as "done" and hides the broken
  // state instead of retrying later.
  const finalPayload: any = {
    is_ended: true,
  };
  if (analytics) {
    finalPayload.is_analysed = true;
    finalPayload.analytics = analytics;

    // Mirror analytics into details.call_analysis (Retell-shaped) so legacy
    // dashboard components that read details.call_analysis.* still work.
    // Field names match the analytics prompt's JSON output (camelCase).
    const enrichedDetails = {
      ...callDetails,
      // Re-assert recording_url on the enriched object — spread of
      // callDetails already includes it but being explicit guards against
      // future refactors that touch the spread order.
      ...(callDetails.recording_url
        ? { recording_url: callDetails.recording_url }
        : {}),
      call_analysis: {
        call_summary:
          analytics.softSkillSummary || analytics.overallFeedback || "",
        user_sentiment: analytics.userSentiment || "Unknown",
        call_successful: true,
      },
    };
    finalPayload.details = enrichedDetails;
  }
  // Secondary write — flips is_analysed + enriches details. The transcript is
  // already safely persisted by the first write above, so a failure here is
  // non-fatal: the row stays visible (is_ended=true) and the dashboard's
  // analytics-retry poll can finish the job later. Log, don't 500.
  try {
    await ResponseService.saveResponse(finalPayload, call_id);
  } catch (err) {
    logger.error(
      "voice-live/save-call: analytics/flags write failed (transcript already saved)",
      err instanceof Error ? err.message : String(err),
    );
  }

  // 5. Track voice cost in api_usage
  if (usage && duration_seconds > 0) {
    try {
      const interview = await InterviewService.getInterviewById(interviewId);
      let organizationId: string | undefined = interview?.organization_id;
      if (!organizationId && interview?.user_id) {
        try {
          const user = await getUserById(interview.user_id);
          organizationId = user?.organization_id || undefined;
        } catch {
          /* best effort */
        }
      }

      ApiUsageService.saveVoiceLiveUsage({
        interviewId,
        responseId: existing.id ? Number(existing.id) : undefined,
        organizationId,
        userId: interview?.user_id,
        durationSeconds: duration_seconds,
        requestId: call_id,
        inputTokens: usage.input_tokens || 0,
        outputTokens: usage.output_tokens || 0,
        inputAudioTokens: usage.input_audio_tokens || 0,
        outputAudioTokens: usage.output_audio_tokens || 0,
        model,
        metadata: {
          candidateName: existing.name,
          candidateEmail: existing.email,
        },
      }).catch((err) => {
        logger.error("Failed to save Voice Live usage", {
          error: err instanceof Error ? err.message : String(err),
        });
      });
    } catch (err) {
      logger.error("Failed to look up interview for Voice Live usage", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // 6. Log activity (mirrors Retell flow)
  try {
    await logActivityFromRequest(req, "interview_attempt_completed", {
      user_id: null,
      resource_type: "interview",
      resource_id: interviewId,
      details: {
        call_id,
        interview_id: interviewId,
        duration_seconds,
        source: "azure-voicelive",
        end_timestamp: new Date().toISOString(),
      },
    });
  } catch (err) {
    logger.error(
      "Failed to log interview completion",
      err instanceof Error ? err.message : String(err),
    );
  }

  // 7. Mark the assignee as INTERVIEW_COMPLETED + lock retake. The Retell
  // path does this on the client at end-of-call; for Voice Live we run it
  // here so it's part of the same ordered flow as save + analytics.
  const candidateEmail = existing.email || body.email;
  if (candidateEmail) {
    try {
      const assignee = await assigneeService.getAssigneeByEmailAndInterview(
        String(candidateEmail).toLowerCase(),
        interviewId,
      );
      if (assignee?.id) {
        await assigneeService.updateAssignee(assignee.id, {
          allow_retake: false,
          interview_status: "INTERVIEW_COMPLETED",
        });
      }
    } catch (err) {
      logger.error(
        "Failed to update assignee status for Voice Live call",
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  // 8. Fire the recruiter notification email. Same endpoint the Retell path
  // calls — it's already Voice-Live-aware (detects vl- prefix) and reads the
  // transcript from response.details.transcript, which we just saved above.
  if (candidateEmail) {
    try {
      const origin = req.nextUrl.origin;
      await fetch(`${origin}/api/send-recruiter-notification`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          callId: call_id,
          assigneeEmail: candidateEmail,
        }),
      });
    } catch (err) {
      logger.error(
        "Failed to send recruiter notification for Voice Live call",
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  return NextResponse.json(
    {
      success: true,
      analytics,
      duration: duration_seconds,
    },
    { status: 200 },
  );
}
