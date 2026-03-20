import { NextRequest, NextResponse } from "next/server";
import { ResponseService } from "@/services/responses.service";
import { logActivityFromRequest } from "@/lib/user-activity-log";
import { logger } from "@/lib/logger";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

/**
 * API endpoint for saving response with logging
 * This wraps the ResponseService.saveResponse to add activity logging
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { payload, call_id } = body;

    if (!call_id) {
      return NextResponse.json(
        { error: "Call ID is required" },
        { status: 400 }
      );
    }

    // Get existing response to capture details for logging
    const existingResponse = await ResponseService.getResponseByCallId(call_id);

    // Save the response
    const result = await ResponseService.saveResponse(payload, call_id);

    // Server-side: auto-disable retakes when interview is completed
    if (payload.is_ended === true && existingResponse) {
      try {
        const candidateEmail = existingResponse.email;
        const interviewId = existingResponse.interview_id;
        if (candidateEmail && interviewId) {
          await supabase
            .from("interview_assignee")
            .update({ allow_retake: false, interview_status: "INTERVIEW_COMPLETED" })
            .ilike("email", candidateEmail)
            .eq("interview_id", interviewId);
        }
      } catch (retakeError) {
        logger.error("Failed to disable retake:", retakeError instanceof Error ? retakeError.message : String(retakeError));
      }
    }

    // Log interview completion if is_ended is true
    if (payload.is_ended === true && existingResponse) {
      try {
        await logActivityFromRequest(
          request,
          "interview_attempt_completed",
          {
            user_id: null, // Candidate may not be a logged-in user
            resource_type: "interview",
            resource_id: existingResponse.interview_id || null,
            details: {
              call_id: call_id,
              interview_id: existingResponse.interview_id || null,
              candidate_email: existingResponse.email || null,
              candidate_name: existingResponse.name || null,
              duration: payload.duration || existingResponse.duration || null,
              tab_switch_count: payload.tab_switch_count || 0,
              face_mismatch_count: payload.face_mismatch_count || 0,
              camera_off_count: payload.camera_off_count || 0,
              multiple_person_count: payload.multiple_person_count || 0,
              completion_timestamp: new Date().toISOString(),
            },
          }
        );
      } catch (logError) {
        // Don't fail the request if logging fails
        logger.error("Failed to log interview completion:", logError instanceof Error ? logError.message : String(logError));
      }
    }

    return NextResponse.json(
      { success: true, data: result },
      { status: 200 }
    );
  } catch (error) {
    logger.error("Error saving response:", error instanceof Error ? error.message : String(error));
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

