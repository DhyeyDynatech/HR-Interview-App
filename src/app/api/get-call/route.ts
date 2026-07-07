import { logger } from "@/lib/logger";
import { generateInterviewAnalytics } from "@/services/analytics.service";
import { ResponseService } from "@/services/responses.service";
import { InterviewService } from "@/services/interviews.service";
import { getUserById } from "@/lib/auth";
import { ApiUsageService } from "@/services/api-usage.service";
import { Response } from "@/types/response";
import { NextResponse } from "next/server";
import Retell from "retell-sdk";

// Bound the serverless function so a slow analytics call can't run past the
// platform limit and get killed mid-write. Matches the ATS/company-finder
// routes. Must exceed OPENAI_ANALYTICS_TIMEOUT_MS so the abort fires first.
export const maxDuration = 300;

/** Resolve organization_id from interview, falling back to user lookup */
async function resolveOrgId(interview: any): Promise<string | undefined> {
  if (interview?.organization_id) return interview.organization_id;
  if (interview?.user_id) {
    try {
      const user = await getUserById(interview.user_id);
      return user?.organization_id || undefined;
    } catch {
      /* best effort */
    }
  }
  return undefined;
}

const retell = new Retell({
  apiKey: process.env.RETELL_API_KEY || "",
});

// Extract cost in dollars from Retell's call_cost (which is in cents)
function extractRetellCost(callResponse: any): number | undefined {
  const combinedCost = callResponse?.call_cost?.combined_cost;
  if (combinedCost != null && typeof combinedCost === "number") {
    return combinedCost / 100; // Convert cents to dollars
  }
  return undefined;
}

export async function POST(req: Request, res: Response) {
  logger.info("get-call request received");
  const body = await req.json();

  const callDetails: Response | null =
    await ResponseService.getResponseByCallId(body.id);

  // If is_analysed but analytics is missing, regenerate using existing DB transcript
  if (callDetails && callDetails.is_analysed && !callDetails.analytics) {
    const existingDetails = callDetails.details;
    const interviewId = callDetails.interview_id;
    const existingTranscript = existingDetails?.transcript;

    if (existingTranscript && interviewId) {
      const result = await generateInterviewAnalytics({
        callId: body.id,
        interviewId,
        transcript: existingTranscript,
      });

      if (result.analytics) {
        // saveResponse throws on DB error now; this is a best-effort cache
        // write of regenerated analytics, so log and still return the result.
        try {
          await ResponseService.saveResponse(
            { analytics: result.analytics },
            body.id,
          );
        } catch (err) {
          logger.error(
            "get-call: failed to cache regenerated analytics",
            err instanceof Error ? err.message : String(err),
          );
        }
        return NextResponse.json(
          {
            callResponse: existingDetails,
            analytics: result.analytics,
            duration: callDetails.duration || 0,
          },
          { status: 200 },
        );
      }
    }
  }

  // Voice Live calls (call_id prefix `vl-` or details.source === "azure-voicelive")
  // never go through the Retell SDK. The save-call route owns persistence and
  // analytics for them. Here we just return whatever's in the DB and, if the
  // row is unanalysed but has a transcript saved, retry analytics once so the
  // dashboard's interviewCard polling loop can move it forward without
  // crashing on retell.call.retrieve.
  const isVoiceLiveCall =
    String(body.id || "").startsWith("vl-") ||
    callDetails?.details?.source === "azure-voicelive";

  if (isVoiceLiveCall) {
    const existingDetails: any = callDetails?.details ?? null;
    const interviewId = callDetails?.interview_id;
    const transcriptString = existingDetails?.transcript;

    // Already analysed → return cached data exactly like the Retell branch below.
    if (callDetails?.is_analysed && callDetails.analytics) {
      return NextResponse.json(
        {
          callResponse: existingDetails,
          analytics: callDetails.analytics,
          duration: callDetails.duration || 0,
        },
        { status: 200 },
      );
    }

    // Not yet analysed but transcript is present → retry analytics inline.
    // This mirrors what /api/voice-live/save-call would have done if it hadn't
    // failed mid-flight, and lets the recruiter dashboard recover the row.
    if (transcriptString && interviewId) {
      const result = await generateInterviewAnalytics({
        callId: body.id,
        interviewId,
        transcript: transcriptString,
      });
      if (result.analytics) {
        const enrichedDetails = {
          ...existingDetails,
          call_analysis: {
            call_summary:
              result.analytics.softSkillSummary ||
              result.analytics.overallFeedback ||
              "",
            user_sentiment: result.analytics.userSentiment || "Unknown",
            call_successful: true,
          },
        };
        try {
          await ResponseService.saveResponse(
            {
              is_analysed: true,
              analytics: result.analytics,
              details: enrichedDetails,
            },
            body.id,
          );
        } catch (err) {
          logger.error(
            "get-call: failed to save Voice Live analytics retry",
            err instanceof Error ? err.message : String(err),
          );
        }
        return NextResponse.json(
          {
            callResponse: enrichedDetails,
            analytics: result.analytics,
            duration: callDetails?.duration || 0,
          },
          { status: 200 },
        );
      }
    }

    // No transcript to score. Two sub-cases:
    //  (a) The candidate is genuinely still mid-call — the row is fresh and the
    //      save-call write just hasn't landed the transcript yet. Keep showing
    //      in_progress so the dashboard poll waits for it.
    //  (b) The attempt was abandoned (candidate opened & bailed) or an old save
    //      path left the row transcript-less. There is nothing to score and
    //      nothing will ever arrive, but the poll used to return in_progress on
    //      every tick — spinning forever and jamming the "in progress" counts.
    //      Self-heal: once the row is old enough that it can't still be live,
    //      mark it terminal (is_analysed=true, empty call_analysis) so the poll
    //      exits. This also recovers rows created by the pre-fix save path
    //      without any manual SQL.
    const TERMINAL_AGE_MS = 10 * 60 * 1000; // 10 min — well past any real call
    const createdAtMs = callDetails?.created_at
      ? new Date(callDetails.created_at as any).getTime()
      : Date.now();
    const isStaleEmpty =
      !callDetails?.is_analysed && Date.now() - createdAtMs > TERMINAL_AGE_MS;

    if (isStaleEmpty) {
      logger.info(
        `get-call: Voice Live row ${body.id} has no transcript and is stale — marking terminal`,
      );
      const emptyDetails = {
        ...(existingDetails || { call_id: body.id, source: "azure-voicelive" }),
        call_analysis: {
          call_summary: "No interview conducted — candidate did not respond.",
          user_sentiment: "Unknown",
          call_successful: false,
        },
      };
      try {
        await ResponseService.saveResponse(
          { is_analysed: true, details: emptyDetails },
          body.id,
        );
      } catch (err) {
        logger.error(
          "get-call: failed to mark stale empty Voice Live row terminal",
          err instanceof Error ? err.message : String(err),
        );
      }

      return NextResponse.json(
        {
          callResponse: emptyDetails,
          analytics: null,
          duration: callDetails?.duration || 0,
          in_progress: false,
          empty: true,
        },
        { status: 200 },
      );
    }

    // Still fresh — genuinely mid-call. Keep the dashboard showing in_progress.
    return NextResponse.json(
      {
        callResponse: existingDetails,
        analytics: callDetails?.analytics ?? null,
        duration: callDetails?.duration || 0,
        in_progress: !callDetails?.is_analysed,
      },
      { status: 200 },
    );
  }

  if (callDetails && callDetails.is_analysed && callDetails.analytics) {
    let callResponse = callDetails.details;
    let duration = callDetails.duration || 0;

    // If details are null, we need to refetch from Retell
    if (!callResponse) {
      logger.warn(
        `Call ${body.id} is marked as analysed but details are null. Refetching from Retell...`,
      );

      try {
        const callOutput = await retell.call.retrieve(body.id);
        duration =
          callOutput.end_timestamp && callOutput.start_timestamp
            ? Math.round(
                callOutput.end_timestamp / 1000 -
                  callOutput.start_timestamp / 1000,
              )
            : 0;

        // Update database with the missing details
        await ResponseService.updateResponse(
          {
            details: callOutput,
            duration: duration,
          },
          body.id,
        );

        logger.info(
          `Successfully refetched and saved details for call ${body.id}`,
        );
        callResponse = callOutput;
      } catch (error) {
        logger.error(`Failed to refetch call from Retell: ${error}`);
        // Return what we have even if refetch fails
        return NextResponse.json(
          {
            callResponse: null,
            analytics: callDetails.analytics,
            duration: callDetails.duration,
            error: "Call details missing and refetch failed",
          },
          { status: 200 },
        );
      }
    }

    // Track voice call cost (saveVoiceUsage has built-in deduplication using request_id)
    if (duration > 0 && callDetails.interview_id) {
      try {
        const interview = await InterviewService.getInterviewById(
          callDetails.interview_id,
        );
        const orgId = await resolveOrgId(interview);

        ApiUsageService.saveVoiceUsage({
          interviewId: callDetails.interview_id,
          responseId: callDetails.id ? Number(callDetails.id) : undefined,
          organizationId: orgId,
          userId: interview?.user_id,
          durationSeconds: duration,
          requestId: body.id,
          retellCost: extractRetellCost(callResponse),
          metadata: {
            candidateName: callDetails.name,
            candidateEmail: callDetails.email,
          },
        }).catch((err) => {
          logger.error("Failed to save voice usage for analyzed call", {
            error: err,
          });
        });
      } catch (err) {
        logger.error("Failed to get interview for voice usage tracking", {
          error: err,
        });
      }
    }

    return NextResponse.json(
      {
        callResponse,
        analytics: callDetails.analytics,
        duration: duration,
      },
      { status: 200 },
    );
  }
  const callOutput = await retell.call.retrieve(body.id);
  const interviewId = callDetails?.interview_id;
  let callResponse = callOutput;
  const duration =
    callResponse.end_timestamp && callResponse.start_timestamp
      ? Math.round(
          callResponse.end_timestamp / 1000 -
            callResponse.start_timestamp / 1000,
        )
      : 0;

  if (!interviewId || !callResponse.transcript) {
    logger.error("Missing required data for analytics");

    return NextResponse.json(
      { error: "Missing interview ID or transcript" },
      { status: 400 },
    );
  }

  const payload = {
    callId: body.id,
    interviewId: interviewId,
    transcript: callResponse.transcript,
  };
  const result = await generateInterviewAnalytics(payload);

  const analytics = result.analytics;

  // Primary Retell persistence. saveResponse throws on DB error; return an
  // explicit 500 so the webhook / dashboard poll retries get-call rather than
  // us reporting success while nothing was written.
  try {
    await ResponseService.saveResponse(
      {
        details: callResponse,
        is_analysed: true,
        duration: duration,
        analytics: analytics,
      },
      body.id,
    );
  } catch (err) {
    logger.error(
      "get-call: primary Retell response save failed",
      err instanceof Error ? err.message : String(err),
    );

    return NextResponse.json(
      { error: "Failed to persist call response" },
      { status: 500 },
    );
  }

  // Track voice call cost with real duration
  if (duration > 0 && interviewId) {
    try {
      const interview = await InterviewService.getInterviewById(interviewId);
      const orgId = await resolveOrgId(interview);

      ApiUsageService.saveVoiceUsage({
        interviewId: interviewId,
        responseId: callDetails?.id ? Number(callDetails.id) : undefined,
        organizationId: orgId,
        userId: interview?.user_id,
        durationSeconds: duration,
        requestId: body.id,
        retellCost: extractRetellCost(callResponse),
        metadata: {
          candidateName: callDetails?.name,
          candidateEmail: callDetails?.email,
        },
      }).catch((err) => {
        logger.error("Failed to save voice usage", { error: err });
      });
    } catch (err) {
      logger.error("Failed to get interview for voice usage tracking", {
        error: err,
      });
    }
  }

  logger.info("Call analysed successfully", { duration });

  return NextResponse.json(
    {
      callResponse,
      analytics,
      duration,
    },
    { status: 200 },
  );
}
