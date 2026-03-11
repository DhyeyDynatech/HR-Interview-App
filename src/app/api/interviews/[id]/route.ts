import { NextRequest, NextResponse } from "next/server";
import { InterviewService } from "@/services/interviews.service";
import { logActivityFromRequest } from "@/lib/user-activity-log";
import { verifyToken } from "@/lib/auth";

export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    // Get user ID from token
    const authHeader = request.headers.get("authorization");
    let userId: string | null = null;
    
    if (authHeader && authHeader.startsWith("Bearer ")) {
      const token = authHeader.substring(7);
      const { valid, userId: tokenUserId } = verifyToken(token);
      if (valid && tokenUserId) {
        userId = tokenUserId;
      }
    }

    const interviewId = params.id;
    const body = await request.json();

    // Get existing interview data before update for logging
    const existingInterview = await InterviewService.getInterviewById(interviewId);
    if (!existingInterview) {
      return NextResponse.json(
        { error: "Interview not found" },
        { status: 404 }
      );
    }

    // Update interview
    const updatedInterview = await InterviewService.updateInterview(body, interviewId);
    
    // Get updated interview to capture new timestamps
    const refreshedInterview = await InterviewService.getInterviewById(interviewId);

    // Log interview update activity
    try {
      await logActivityFromRequest(
        request,
        "interview_updated",
        {
          user_id: userId,
          resource_type: "interview",
          resource_id: interviewId,
          details: {
            interview_id: interviewId,
            interview_name: body.name || existingInterview.name,
            updated_fields: Object.keys(body),
            previous_name: existingInterview.name,
            new_name: body.name || existingInterview.name,
            // Timestamp information
            original_created_at: existingInterview.created_at || null,
            previous_updated_at: existingInterview.updated_at || existingInterview.created_at || null,
            update_timestamp: new Date().toISOString(),
            new_updated_at: refreshedInterview?.updated_at || refreshedInterview?.created_at || new Date().toISOString(),
          },
        }
      );
    } catch (logError) {
      // Don't fail the request if logging fails, but log the error
      console.error("Failed to log interview update:", logError);
    }

    return NextResponse.json(
      { message: "Interview updated successfully", interview: updatedInterview },
      { status: 200 }
    );
  } catch (error) {
    console.error("Error in PUT /api/interviews/[id]:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    // Get user ID from token
    const authHeader = request.headers.get("authorization");
    let userId: string | null = null;
    
    if (authHeader && authHeader.startsWith("Bearer ")) {
      const token = authHeader.substring(7);
      const { valid, userId: tokenUserId } = verifyToken(token);
      if (valid && tokenUserId) {
        userId = tokenUserId;
      }
    }

    const interviewId = params.id;

    // Get existing interview data before deletion for logging
    const existingInterview = await InterviewService.getInterviewById(interviewId);
    if (!existingInterview) {
      return NextResponse.json(
        { error: "Interview not found" },
        { status: 404 }
      );
    }

    // Store interview info before deletion for logging
    const interviewInfo = {
      id: existingInterview.id,
      name: existingInterview.name,
      user_id: existingInterview.user_id,
      created_at: existingInterview.created_at,
      updated_at: existingInterview.updated_at,
    };

    // Delete interview
    await InterviewService.deleteInterview(interviewId);

    // Log interview deletion activity
    await logActivityFromRequest(
      request,
      "interview_deleted",
      {
        user_id: userId,
        resource_type: "interview",
        resource_id: interviewId,
        details: {
          interview_id: interviewId,
          interview_name: interviewInfo.name,
          interview_user_id: interviewInfo.user_id,
          // Timestamp information
          original_created_at: interviewInfo.created_at || null,
          last_updated_at: interviewInfo.updated_at || interviewInfo.created_at || null,
          deletion_timestamp: new Date().toISOString(),
        },
      }
    );

    return NextResponse.json(
      { message: "Interview deleted successfully" },
      { status: 200 }
    );
  } catch (error) {
    console.error("Error in DELETE /api/interviews/[id]:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

