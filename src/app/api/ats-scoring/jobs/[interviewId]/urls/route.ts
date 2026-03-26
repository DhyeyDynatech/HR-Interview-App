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
    const auth = await extractAuth(request);
    if (!auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

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
