import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

function getSupabaseClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

/**
 * PATCH /api/ats-scoring/jobs/[interviewId]/urls
 * Backfill resume_url for scored items that are missing it.
 * The batch process route doesn't have access to blob URLs,
 * so the client patches them after scoring completes.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ interviewId: string }> }
) {
  try {
    const { interviewId } = await params;
    const { updates } = await request.json();

    if (!Array.isArray(updates) || updates.length === 0) {
      return NextResponse.json({ error: "No updates provided" }, { status: 400 });
    }

    const supabase = getSupabaseClient();

    // Update each item's resume_url individually (only if currently null)
    let patched = 0;
    for (const { resumeName, resumeUrl } of updates) {
      if (!resumeName || !resumeUrl) continue;

      const { error } = await supabase
        .from("ats_score_items")
        .update({ resume_url: resumeUrl })
        .eq("interview_id", interviewId)
        .eq("resume_name", resumeName)
        .is("resume_url", null);

      if (!error) patched++;
    }

    return NextResponse.json({ patched }, { status: 200 });
  } catch (error) {
    console.error("Error backfilling resume URLs:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
