import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { verifyToken, getUserById } from "@/lib/auth";

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

  return { userId, organizationId: user.organization_id || user.id, realOrgId: user.organization_id || null };
}

export async function POST(
  request: NextRequest,
  { params }: { params: { interviewId: string } }
) {
  try {
    const auth = await extractAuth(request);
    if (!auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { interviewId } = params;
    const { resumes } = await request.json(); // Array of { name, text }

    if (!resumes || !Array.isArray(resumes)) {
      return NextResponse.json({ error: "Resumes array is required" }, { status: 400 });
    }

    const supabase = getSupabaseClient();

    // 1. Check if there's already an active job
    const { data: existingJob } = await supabase
      .from("ats_batch_jobs")
      .select("id, total_items")
      .eq("interview_id", interviewId)
      .eq("status", "processing")
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    let jobId: string;
    let isNewJob = false;

    if (existingJob) {
      jobId = existingJob.id;
      // Update total count for the existing job
      await supabase
        .from("ats_batch_jobs")
        .update({ total_items: (existingJob.total_items || 0) + resumes.length })
        .eq("id", jobId);
    } else {
      isNewJob = true;
      // 2. Create a new batch job
      const { data: job, error: jobError } = await supabase
        .from("ats_batch_jobs")
        .insert({
          interview_id: interviewId,
          manager_id: auth.userId,
          organization_id: auth.realOrgId,
          status: "processing",
          total_items: resumes.length,
          processed_items: 0,
          failed_items: 0
        })
        .select("id")
        .single();

      if (jobError) throw jobError;
      jobId = job.id;
    }

    // 3. Create all tasks in background
    const tasks = resumes.map((r: any) => ({
      job_id: jobId,
      resume_name: (r.name || "Unknown").replace(/[\u0000-\u001F\u007F-\u009F]/g, ""),
      // Sanitize resume text: remove null characters and other problematic controls
      resume_text: (r.text || "").replace(/\u0000/g, ""),
      resume_url: r.url || null,
      status: "pending"
    }));

    console.log(`[Queue] Inserting ${tasks.length} tasks for job ${jobId}`);

    // Insert tasks in chunks to avoid single request size limits if needed
    const CHUNK_SIZE_PG = 1000;
    for (let i = 0; i < tasks.length; i += CHUNK_SIZE_PG) {
      const chunk = tasks.slice(i, i + CHUNK_SIZE_PG);
      const { error: taskError } = await supabase
        .from("ats_job_tasks")
        .insert(chunk);
      if (taskError) {
        console.error(`[Queue] Postgres error at chunk ${i}:`, taskError);
        throw new Error(`Database error: ${taskError.message}`);
      }
    }

    return NextResponse.json({ 
      jobId: jobId, 
      totalItems: resumes.length,
      message: "Resumes queued successfully" 
    }, { status: 201 });

  } catch (error: any) {
    console.error("Error queueing resumes:", error);
    // Be explicit about where the error came from
    const msg = error.message || "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
