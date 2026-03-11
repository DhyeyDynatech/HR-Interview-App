import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { verifyToken, getUserById } from "@/lib/auth";
import { ATSScoreResult } from "@/types/ats-scoring";

function getSupabaseClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

async function extractAuth(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) return null;

  const token = authHeader.substring(7);
  const { valid, userId } = verifyToken(token);
  if (!valid || !userId) return null;

  const user = await getUserById(userId);
  if (!user) return null;

  return { userId, organizationId: user.organization_id || user.id };
}

// GET /api/ats-scoring/jobs/[interviewId] - full detail for one job
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ interviewId: string }> }
) {
  try {
    const auth = await extractAuth(request);
    if (!auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { interviewId } = await params;
    const supabase = getSupabaseClient();

    const { data, error } = await supabase
      .from("ats_job_data")
      .select(
        "interview_id, jd_text, jd_filename, results, interview:interview_id(name)"
      )
      .eq("interview_id", interviewId)
      .eq("organization_id", auth.organizationId)
      .single();

    if (error && error.code === "PGRST116") {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (error) throw error;

    return NextResponse.json(
      {
        interviewId: data.interview_id,
        interviewName: (data as any).interview?.name || "Untitled",
        jdText: data.jd_text || "",
        jdFilename: data.jd_filename || "",
        results: data.results || [],
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("Error in GET /api/ats-scoring/jobs/[interviewId]:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// PUT /api/ats-scoring/jobs/[interviewId] - update JD and/or results
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ interviewId: string }> }
) {
  try {
    const auth = await extractAuth(request);
    if (!auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { interviewId } = await params;
    const body = await request.json();

    const updatePayload: Record<string, any> = {
      updated_at: new Date().toISOString(),
    };

    if (body.jdText !== undefined) updatePayload.jd_text = body.jdText;
    if (body.jdFilename !== undefined)
      updatePayload.jd_filename = body.jdFilename;

    if (body.results !== undefined) {
      updatePayload.results = body.results;
      const results: ATSScoreResult[] = body.results || [];
      updatePayload.result_count = results.length;
      updatePayload.avg_score =
        results.length > 0
          ? Math.round(
              results.reduce((sum, r) => sum + r.overallScore, 0) /
                results.length
            )
          : 0;
    }

    const supabase = getSupabaseClient();

    const { error } = await supabase
      .from("ats_job_data")
      .update(updatePayload)
      .eq("interview_id", interviewId)
      .eq("organization_id", auth.organizationId);

    if (error) throw error;

    return NextResponse.json({ message: "Updated" }, { status: 200 });
  } catch (error) {
    console.error("Error in PUT /api/ats-scoring/jobs/[interviewId]:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// DELETE /api/ats-scoring/jobs/[interviewId] - remove job from ATS dashboard
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ interviewId: string }> }
) {
  try {
    const auth = await extractAuth(request);
    if (!auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { interviewId } = await params;
    const supabase = getSupabaseClient();

    const { error } = await supabase
      .from("ats_job_data")
      .delete()
      .eq("interview_id", interviewId)
      .eq("organization_id", auth.organizationId);

    if (error) throw error;

    return NextResponse.json({ message: "Removed" }, { status: 200 });
  } catch (error) {
    console.error(
      "Error in DELETE /api/ats-scoring/jobs/[interviewId]:",
      error
    );
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
