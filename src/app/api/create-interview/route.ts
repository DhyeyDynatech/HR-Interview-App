import { nanoid } from "nanoid";
import { NextRequest, NextResponse } from "next/server";
import { InterviewService } from "@/services/interviews.service";
import { logger } from "@/lib/logger";
import { logActivityFromRequest } from "@/lib/user-activity-log";
import { verifyToken, getUserById } from "@/lib/auth";

const base_url = process.env.NEXT_PUBLIC_LIVE_URL;

async function extractAuth(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) return null;
  const token = authHeader.substring(7);
  const { valid, userId } = verifyToken(token);
  if (!valid || !userId) return null;
  const user = await getUserById(userId);
  if (!user || !user.organization_id) return null;
  return { userId, organizationId: user.organization_id };
}

export async function POST(req: NextRequest) {
  try {
    const auth = await extractAuth(req);
    if (!auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const url_id = nanoid();
    const url = `${base_url}/call/${url_id}`;
    const body = await req.json();

    logger.info("create-interview request received");

    const payload = body.interviewData;

    let readableSlug = null;
    if (payload.name) {
      const interviewNameSlug = payload.name?.toLowerCase().replace(/\s/g, "-");
      readableSlug = interviewNameSlug;
    }

    const newInterview = await InterviewService.createInterview({
      ...payload,
      organization_id: auth.organizationId,
      url: url,
      id: url_id,
      readable_slug: readableSlug,
    });

    logger.info("Interview created successfully");

    // Log interview creation
    try {
      await logActivityFromRequest(
        req,
        "interview_created",
        {
          user_id: auth.userId,
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
