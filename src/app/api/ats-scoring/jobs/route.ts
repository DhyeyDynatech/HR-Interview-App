import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { verifyToken, getUserById } from "@/lib/auth";

export const dynamic = "force-dynamic";

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
  if (!user || !user.organization_id) return null;

  return { userId, organizationId: user.organization_id };
}

// GET /api/ats-scoring/jobs - list all ATS jobs for the user's org
export async function GET(request: NextRequest) {
  try {
    const auth = await extractAuth(request);
    if (!auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const supabase = getSupabaseClient();

    const { data, error } = await supabase
      .from("ats_job_data")
      .select(
        `
        interview_id,
        jd_text,
        jd_filename,
        result_count,
        avg_score,
        interview:interview_id ( name )
      `
      )
      .eq("organization_id", auth.organizationId)
      .order("created_at", { ascending: false });

    if (error) throw error;

    const jobs = (data || []).map((row: any) => ({
      interviewId: row.interview_id,
      interviewName: row.interview?.name || "Untitled",
      hasJd: !!(row.jd_text && row.jd_text.trim()),
      jdFilename: row.jd_filename || "",
      resultCount: row.result_count || 0,
      avgScore: Number(row.avg_score) || 0,
    }));

    return NextResponse.json({ jobs }, { status: 200 });
  } catch (error) {
    console.error("Error in GET /api/ats-scoring/jobs:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// POST /api/ats-scoring/jobs - add interviews to ATS dashboard
export async function POST(request: NextRequest) {
  try {
    const auth = await extractAuth(request);
    if (!auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { interviewIds } = await request.json();
    if (!Array.isArray(interviewIds) || interviewIds.length === 0) {
      return NextResponse.json(
        { error: "interviewIds array is required" },
        { status: 400 }
      );
    }

    const supabase = getSupabaseClient();

    const rows = interviewIds.map((id: string) => ({
      interview_id: id,
      organization_id: auth.organizationId,
    }));

    const { data, error } = await supabase
      .from("ats_job_data")
      .upsert(rows, {
        onConflict: "interview_id,organization_id",
        ignoreDuplicates: true,
      })
      .select("interview_id");

    if (error) throw error;

    return NextResponse.json(
      {
        message: "Jobs added",
        addedIds: (data || []).map((r: any) => r.interview_id),
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("Error in POST /api/ats-scoring/jobs:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
