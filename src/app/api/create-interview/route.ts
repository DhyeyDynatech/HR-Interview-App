import { nanoid } from "nanoid";
import { NextRequest, NextResponse } from "next/server";
import { InterviewService } from "@/services/interviews.service";
import { logger } from "@/lib/logger";
import { logActivityFromRequest, getUserIdFromRequest } from "@/lib/user-activity-log";

const base_url = process.env.NEXT_PUBLIC_LIVE_URL;

export async function POST(req: NextRequest) {
  try {
    const url_id = nanoid();
    const url = `${base_url}/call/${url_id}`;
    const body = await req.json();

    logger.info("create-interview request received");

    const payload = body.interviewData;

    // Remove organization_id from payload if it exists
    const { organization_id, ...interviewPayload } = payload;

    let readableSlug = null;
    if (payload.name) {
      const interviewNameSlug = payload.name?.toLowerCase().replace(/\s/g, "-");
      readableSlug = interviewNameSlug;
    }

    const newInterview = await InterviewService.createInterview({
      ...interviewPayload,
      url: url,
      id: url_id,
      readable_slug: readableSlug,
    });

    logger.info("Interview created successfully");

    // Log interview creation
    try {
      // Try to get user ID from request (Bearer token or cookies)
      let userId = await getUserIdFromRequest(req);
      
      // If not found, try to get from payload (frontend sends it)
      if (!userId && payload.user_id && payload.user_id.trim() !== '') {
        userId = payload.user_id;
      }
      
      await logActivityFromRequest(
        req,
        "interview_created",
        {
          user_id: userId,
          resource_type: "interview",
          resource_id: url_id,
          details: {
            interview_id: url_id,
            interview_name: payload.name || null,
            interviewer_id: payload.interviewer_id || null,
            question_count: payload.question_count || 0,
            time_duration: payload.time_duration || null,
            description: payload.description || null,
            objective: payload.objective || null,
            url: url,
            readable_slug: readableSlug,
            creation_timestamp: new Date().toISOString(),
          },
        }
      );
    } catch (logError) {
      // Don't fail the request if logging fails
      logger.error("Failed to log interview creation:", logError instanceof Error ? logError.message : String(logError));
    }


    return NextResponse.json(
      { response: "Interview created successfully" },
      { status: 200 },
    );
  } catch (err) {
    logger.error("Error creating interview");


    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
