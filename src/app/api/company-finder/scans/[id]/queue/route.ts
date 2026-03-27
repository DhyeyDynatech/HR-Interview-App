import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { verifyToken, getUserById } from "@/lib/auth";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

function getSupabaseClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
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
 * POST /api/company-finder/scans/[id]/queue
 * Queue resumes for server-side CF processing (mirrors ATS queue pattern).
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await extractAuth(request);
    if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id: scanId } = await params;
    const { resumes } = await request.json();

    if (!resumes || !Array.isArray(resumes) || resumes.length === 0) {
      return NextResponse.json({ error: "No resumes provided" }, { status: 400 });
    }

    const supabase = getSupabaseClient();

    // Find or create an active batch job for this scan
    const { data: existingJob } = await supabase
      .from("cf_batch_jobs")
      .select("id, total_items")
      .eq("scan_id", scanId)
      .eq("status", "processing")
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    let jobId: string;

    if (existingJob) {
      // Append to existing job
      jobId = existingJob.id;
      await supabase
        .from("cf_batch_jobs")
        .update({ total_items: existingJob.total_items + resumes.length, updated_at: new Date().toISOString() })
        .eq("id", jobId);
    } else {
      // Clean up leftover enrich queue items from previous interrupted runs so the
      // new job starts from a clean slate and doesn't re-process stale items.
      await supabase
        .from("cf_enrich_queue")
        .delete()
        .eq("scan_id", scanId);

      // Create new job
      const { data: job, error: jobError } = await supabase
        .from("cf_batch_jobs")
        .insert({
          scan_id: scanId,
          manager_id: auth.userId,
          status: "processing",
          total_items: resumes.length,
          processed_items: 0,
          failed_items: 0,
        })
        .select("id")
        .single();

      if (jobError) throw jobError;
      jobId = job.id;
    }

    // Insert tasks
    const tasks = resumes.map((r: any) => ({
      job_id: jobId,
      resume_name: (r.name || "Unknown").replace(/[\u0000-\u001F\u007F-\u009F]/g, ""),
      resume_text: (r.text || "").replace(/\u0000/g, ""),
      resume_url: r.url || null,
      status: "pending",
    }));

    const CHUNK_SIZE = 500;
    for (let i = 0; i < tasks.length; i += CHUNK_SIZE) {
      const chunk = tasks.slice(i, i + CHUNK_SIZE);
      const { error: taskError } = await supabase.from("cf_job_tasks").insert(chunk);
      if (taskError) {
        logger.error(`[CF Queue] Insert error at chunk ${i}:`, taskError.message);
        throw new Error(`Database error: ${taskError.message}`);
      }
    }

    logger.info(`[CF Queue] Queued ${tasks.length} tasks for scan ${scanId}, job ${jobId}`);

    return NextResponse.json({ jobId, totalItems: resumes.length }, { status: 201 });
  } catch (error: any) {
    logger.error("CF queue error:", error?.message || String(error));
    return NextResponse.json({ error: error?.message || "Queue failed" }, { status: 500 });
  }
}
