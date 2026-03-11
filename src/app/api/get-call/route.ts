import { logger } from "@/lib/logger";
import { generateInterviewAnalytics } from "@/services/analytics.service";
import { ResponseService } from "@/services/responses.service";
import { InterviewService } from "@/services/interviews.service";
import { ApiUsageService } from "@/services/api-usage.service";
import { Response } from "@/types/response";
import { NextResponse } from "next/server";
import Retell from "retell-sdk";

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

  const callDetails: Response | null = await ResponseService.getResponseByCallId(
    body.id,
  );
  
  if (callDetails && callDetails.is_analysed) {
    let callResponse = callDetails.details;
    let duration = callDetails.duration || 0;

    // If details are null, we need to refetch from Retell
    if (!callResponse) {
      logger.warn(`Call ${body.id} is marked as analysed but details are null. Refetching from Retell...`);

      try {
        const callOutput = await retell.call.retrieve(body.id);
        duration = (callOutput.end_timestamp && callOutput.start_timestamp)
          ? Math.round(callOutput.end_timestamp / 1000 - callOutput.start_timestamp / 1000)
          : 0;

        // Update database with the missing details
        await ResponseService.updateResponse(
          {
            details: callOutput,
            duration: duration,
          },
          body.id
        );

        logger.info(`Successfully refetched and saved details for call ${body.id}`);
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
        const interview = await InterviewService.getInterviewById(callDetails.interview_id);

        ApiUsageService.saveVoiceUsage({
          interviewId: callDetails.interview_id,
          responseId: callDetails.id ? Number(callDetails.id) : undefined,
          organizationId: interview?.organization_id,
          userId: interview?.user_id,
          durationSeconds: duration,
          requestId: body.id,
          retellCost: extractRetellCost(callResponse),
          metadata: {
            candidateName: callDetails.name,
            candidateEmail: callDetails.email,
          },
        }).catch((err) => {
          logger.error("Failed to save voice usage for analyzed call", { error: err });
        });
      } catch (err) {
        logger.error("Failed to get interview for voice usage tracking", { error: err });
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
  const duration = (callResponse.end_timestamp && callResponse.start_timestamp)
    ? Math.round(callResponse.end_timestamp / 1000 - callResponse.start_timestamp / 1000)
    : 0;

  if (!interviewId || !callResponse.transcript) {
    logger.error("Missing required data for analytics");

    return NextResponse.json(
      { error: "Missing interview ID or transcript" },
      { status: 400 }
    );
  }

  const payload = {
    callId: body.id,
    interviewId: interviewId,
    transcript: callResponse.transcript,
  };
  const result = await generateInterviewAnalytics(payload);

  const analytics = result.analytics;

  await ResponseService.saveResponse(
    {
      details: callResponse,
      is_analysed: true,
      duration: duration,
      analytics: analytics,
    },
    body.id,
  );

  // Track voice call cost with real duration
  if (duration > 0 && interviewId) {
    try {
      const interview = await InterviewService.getInterviewById(interviewId);

      ApiUsageService.saveVoiceUsage({
        interviewId: interviewId,
        responseId: callDetails?.id ? Number(callDetails.id) : undefined,
        organizationId: interview?.organization_id,
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
      logger.error("Failed to get interview for voice usage tracking", { error: err });
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
