import { logger } from "@/lib/logger";
import { InterviewerService } from "@/services/interviewers.service";
import { InterviewService } from "@/services/interviews.service";

import { NextRequest, NextResponse } from "next/server";
import Retell from "retell-sdk";
import { logActivityFromRequest } from "@/lib/user-activity-log";

const retellClient = new Retell({
  apiKey: process.env.RETELL_API_KEY || "",
});

export async function POST(req: NextRequest, res: Response) {
  logger.info("register-call request received");

  const body = await req.json();

  const interviewerId = body.interviewer_id;
  const interviewer = await InterviewerService.getInterviewer(interviewerId);

  if (!interviewer?.agent_id) {
    logger.error("Interviewer or agent_id not found");

    return NextResponse.json(
      { error: "Interviewer not found or missing agent_id" },
      { status: 404 }
    );
  }

  // Optionally fetch Retell agent details to get voice and other configuration
  try {
    const retellAgentDetails = await InterviewerService.getRetellAgentDetails(interviewer.agent_id);
    if (retellAgentDetails) {
      logger.info(`Retrieved Retell agent details for agent_id: ${interviewer.agent_id}`, {
        agent_name: interviewer.name,
        voice_id: retellAgentDetails.voice_id || 'N/A',
      });
    }
  } catch (error) {
    // Non-critical error - continue even if we can't fetch Retell details
    logger.warn("Could not fetch Retell agent details (non-critical):", error instanceof Error ? error.message : String(error));
  }

  const callParams: any = {
    agent_id: interviewer.agent_id,
    retell_llm_dynamic_variables: body.dynamic_data,
    opt_out_sensitive_data_storage: false, // Enable recording
  };

  const registerCallResponse = await retellClient.call.createWebCall(callParams);

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
      logger.warn("Could not fetch interview for API usage tracking", { error: err });
    }
  }

  // Log interview attempt start
  try {
    const interviewId = body.dynamic_data?.interview_id || null;
    const candidateEmail = body.dynamic_data?.email || null;
    const candidateName = body.dynamic_data?.name || null;
    
    await logActivityFromRequest(
      req,
      "interview_attempt_started",
      {
        user_id: null, // Candidate may not be a logged-in user
        resource_type: "interview",
        resource_id: interviewId,
        details: {
          call_id: registerCallResponse.call_id || null,
          interview_id: interviewId,
          interviewer_id: interviewerId,
          candidate_email: candidateEmail,
          candidate_name: candidateName,
          start_timestamp: new Date().toISOString(),
        },
      }
    );
  } catch (logError) {
    logger.error("Failed to log interview attempt start:", logError instanceof Error ? logError.message : String(logError));
  }

  return NextResponse.json(
    {
      registerCallResponse,
    },
    { status: 200 },
  );
}
