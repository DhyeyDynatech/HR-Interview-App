import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getOpenAIClient, MODELS } from "@/lib/openai-client";
import { ATS_SYSTEM_PROMPT, generateATSScoringPrompt } from "@/lib/prompts/ats-scoring";
import { ApiUsageService } from "@/services/api-usage.service";

export const maxDuration = 300; // 5 minutes — matches Vercel max

const OPENAI_TIMEOUT_MS = 270_000; // 4.5 minutes — leaves 30s for DB ops before Vercel kills the fn
const MAX_RESUME_TEXT_LENGTH = 80_000; // ~80K chars per resume

function getSupabaseClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

async function callOpenAIForBatch(
  jobDescription: string,
  resumes: { name: string; text: string }[]
): Promise<{ results: any[]; usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number } | null }> {
  const openai = getOpenAIClient();

  const trimmedResumes = resumes.map((r) => ({
    name: r.name,
    text: r.text.slice(0, MAX_RESUME_TEXT_LENGTH),
  }));

  const prompt = generateATSScoringPrompt({
    jobDescription,
    resumes: trimmedResumes,
  });

  const completion = await openai.chat.completions.create({
    model: MODELS.GPT5_MINI,
    max_completion_tokens: 32768,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: ATS_SYSTEM_PROMPT },
      { role: "user", content: prompt },
    ],
  } as any);

  const raw = completion.choices[0]?.message?.content || "{}";
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("No JSON found in OpenAI response");

  let jsonStr = jsonMatch[0];
  let parsed: any;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    // Attempt JSON repair for truncated responses
    jsonStr = jsonStr.replace(/,\s*([\]}])/g, "$1");
    const openBraces = (jsonStr.match(/\{/g) || []).length;
    const closeBraces = (jsonStr.match(/\}/g) || []).length;
    const openBrackets = (jsonStr.match(/\[/g) || []).length;
    const closeBrackets = (jsonStr.match(/\]/g) || []).length;
    jsonStr += "]".repeat(Math.max(0, openBrackets - closeBrackets));
    jsonStr += "}".repeat(Math.max(0, openBraces - closeBraces));
    parsed = JSON.parse(jsonStr);
  }

  return { results: parsed.results || parsed, usage: completion.usage ?? null };
}

export async function POST(
  req: NextRequest,
  { params }: { params: { interviewId: string } }
) {
  const { interviewId } = params;
  const { batchSize = 5 } = await req.json();
  const supabase = getSupabaseClient();

  try {
    // 1. Get the current active job for this interview
    const { data: job, error: jobError } = await supabase
      .from("ats_batch_jobs")
      .select("id, status")
      .eq("interview_id", interviewId)
      .eq("status", "processing")
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    if (jobError || !job) {
      // Distinguish "job completed" from "queue still creating job"
      const { data: anyJob } = await supabase
        .from("ats_batch_jobs")
        .select("id, status")
        .eq("interview_id", interviewId)
        .order("created_at", { ascending: false })
        .limit(1)
        .single();

      if (!anyJob) {
        // No batch job at all — queue route may still be inserting tasks, wait
        return NextResponse.json({ waiting: true, processedCount: 0, failedCount: 0 }, { status: 202 });
      }
      // Job exists but is completed/failed — truly done
      return NextResponse.json({ message: "No active processing job found" }, { status: 404 });
    }

    // 2. Get the JD for this interview
    const { data: jobData, error: jdError } = await supabase
      .from("ats_job_data")
      .select("jd_text, organization_id")
      .eq("interview_id", interviewId)
      .single();

    if (jdError || !jobData?.jd_text) {
      return NextResponse.json({ message: "No job description found. Please upload a JD first." }, { status: 400 });
    }

    // 3. Reset stale "processing" tasks — tasks stuck for >6 min mean the Vercel fn timed out
    //    (maxDuration=300s=5min, so anything still "processing" after 6min is orphaned)
    const staleThreshold = new Date(Date.now() - 6 * 60 * 1000).toISOString();
    await supabase
      .from("ats_job_tasks")
      .update({ status: "pending" })
      .eq("job_id", job.id)
      .eq("status", "processing")
      .lt("created_at", staleThreshold);

    // 4. Fetch next batch of pending tasks
    const { data: tasks, error: tasksError } = await supabase
      .from("ats_job_tasks")
      .select("id, resume_name, resume_text")
      .eq("job_id", job.id)
      .eq("status", "pending")
      .limit(batchSize);

    if (tasksError) throw tasksError;

    if (!tasks || tasks.length === 0) {
      // Check total task count and in-flight count to distinguish these states:
      // a) Queue still inserting tasks (totalCount = 0) → wait
      // b) Other parallel workers have all tasks in-flight (inFlightCount > 0) → wait
      // c) All tasks truly done (no pending, no in-flight) → mark complete
      const { count: totalTaskCount } = await supabase
        .from("ats_job_tasks")
        .select("*", { count: "exact", head: true })
        .eq("job_id", job.id);

      if (!totalTaskCount || totalTaskCount === 0) {
        return NextResponse.json({ waiting: true, processedCount: 0, failedCount: 0 }, { status: 202 });
      }

      const { count: inFlightCount } = await supabase
        .from("ats_job_tasks")
        .select("*", { count: "exact", head: true })
        .eq("job_id", job.id)
        .eq("status", "processing");

      if (inFlightCount && inFlightCount > 0) {
        // Parallel workers are still processing — this worker should wait
        return NextResponse.json({ waiting: true, processedCount: 0, failedCount: 0 }, { status: 202 });
      }

      // No pending, no in-flight — all done
      await supabase
        .from("ats_batch_jobs")
        .update({ status: "completed", updated_at: new Date().toISOString() })
        .eq("id", job.id);

      return NextResponse.json({ message: "All tasks processed", processedCount: 0, failedCount: 0 });
    }

    // 4. Atomically claim tasks — only update rows still "pending" to avoid race conditions
    //    between parallel workers that may have SELECTed the same rows simultaneously.
    const { data: claimedTasks } = await supabase
      .from("ats_job_tasks")
      .update({ status: "processing" })
      .in("id", tasks.map((t: any) => t.id))
      .eq("status", "pending") // only claim if still pending — prevents duplicate processing
      .select("id");

    if (!claimedTasks || claimedTasks.length === 0) {
      // Another parallel worker already claimed these tasks — wait for next batch
      return NextResponse.json({ waiting: true, processedCount: 0, failedCount: 0 }, { status: 202 });
    }

    // Only process the tasks we actually claimed (may be fewer than selected)
    const claimedIds = new Set(claimedTasks.map((r: any) => r.id));
    const actualTasks = tasks.filter((t: any) => claimedIds.has(t.id));

    console.log(`[Process] Sending batch of ${actualTasks.length} resumes to OpenAI for job ${interviewId}`);

    // 5. Call real OpenAI analysis
    let aiResults: any[] = [];
    let processedCount = 0;
    let failedCount = 0;

    const actualTaskIds = actualTasks.map((t: any) => t.id);

    try {
      const { results: batchResults, usage: batchUsage } = await callOpenAIForBatch(
        jobData.jd_text,
        actualTasks.map((t: any) => ({ name: t.resume_name, text: t.resume_text || "" }))
      );
      aiResults = Array.isArray(batchResults) ? batchResults : (batchResults?.results || []);

      // Track API usage for this batch
      if (batchUsage) {
        ApiUsageService.saveOpenAIUsage({
          organizationId: jobData.organization_id,
          category: "ats_scoring",
          inputTokens: batchUsage.prompt_tokens,
          outputTokens: batchUsage.completion_tokens,
          totalTokens: batchUsage.total_tokens,
          model: MODELS.GPT5_MINI,
          metadata: {
            resumeCount: actualTasks.length,
            resumeNames: actualTasks.map((t: any) => t.resume_name),
            interviewId,
          },
        }).catch((err: any) => {
          console.error("[Process] Failed to save API usage:", err.message);
        });
      }
    } catch (aiErr: any) {
      console.error("[Process] OpenAI batch call failed:", aiErr.message);
      // Mark all as failed
      await supabase
        .from("ats_job_tasks")
        .update({ status: "failed", error_message: aiErr.message })
        .in("id", actualTaskIds);
      failedCount = actualTasks.length;

      // Still update progress
      try {
        await supabase.rpc("increment_job_progress", {
          job_uuid: job.id,
          processed_inc: 0,
          failed_inc: failedCount,
        });
      } catch (_) {}

      return NextResponse.json({ processedCount: 0, failedCount });
    }

    // 6. Save results to ats_score_items
    const scoreRows = aiResults.map((result: any) => ({
      interview_id: interviewId,
      organization_id: jobData.organization_id,
      resume_name: result.resumeName,
      overall_score: result.overallScore ?? 0,
      category_scores: result.categoryScores,
      category_details: result.categoryDetails,
      matched_skills: result.matchedSkills,
      missing_skills: result.missingSkills,
      strengths: result.strengths,
      interview_focus_areas: result.interviewFocusAreas,
      summary: result.summary,
      candidate_details: result.candidateDetails,
      suggested_tag: result.suggestedTag,
      candidate_profile: result.candidateProfile,
      jd_understanding: result.jdUnderstanding,
      experience_depth_analysis: result.experienceDepthAnalysis,
      swot_analysis: result.swotAnalysis,
      experience_match: result.experienceMatch,
    }));

    if (scoreRows.length > 0) {
      const { error: upsertError } = await supabase
        .from("ats_score_items")
        .upsert(scoreRows, { onConflict: "interview_id,resume_name" });

      if (upsertError) {
        console.error("[Process] Upsert failed:", upsertError.message, upsertError.details, upsertError.hint);
        // Fallback: try inserting one by one (ignoring individual conflicts)
        let fallbackSaved = 0;
        for (const row of scoreRows) {
          const { error: singleErr } = await supabase
            .from("ats_score_items")
            .upsert(row, { onConflict: "interview_id,resume_name" });
          if (!singleErr) fallbackSaved++;
          else console.error("[Process] Single row upsert failed:", singleErr.message, "row:", row.resume_name);
        }
        processedCount = fallbackSaved;
        if (processedCount === 0) {
          // Return error details so client logs can show what's wrong
          return NextResponse.json({
            processedCount: 0,
            failedCount: scoreRows.length,
            dbError: upsertError.message,
          });
        }
      } else {
        processedCount = scoreRows.length;
      }
    }

    // 7. Mark tasks as completed
    await supabase
      .from("ats_job_tasks")
      .update({ status: "completed" })
      .in("id", actualTaskIds);

    // For any tasks not in aiResults (AI might have skipped some), mark as failed
    const processedNames = new Set(aiResults.map((r: any) => r.resumeName));
    const skippedTasks = actualTasks.filter((t: any) => !processedNames.has(t.resume_name));
    if (skippedTasks.length > 0) {
      const skippedIds = skippedTasks.map((t: any) => t.id);
      await supabase
        .from("ats_job_tasks")
        .update({ status: "failed", error_message: "Not returned by AI" })
        .in("id", skippedIds);
      failedCount += skippedTasks.length;
      processedCount = Math.max(0, processedCount - skippedTasks.length);
    }

    // 8. Update job progress
    try {
      await supabase.rpc("increment_job_progress", {
        job_uuid: job.id,
        processed_inc: processedCount,
        failed_inc: failedCount,
      });
    } catch (_) {}

    // 9. Sync summary counts in ats_job_data
    const { data: statsData } = await supabase
      .from("ats_score_items")
      .select("overall_score")
      .eq("interview_id", interviewId);

    if (statsData) {
      const avgScore = statsData.length > 0
        ? Math.round(statsData.reduce((sum, r) => sum + r.overall_score, 0) / statsData.length * 10) / 10
        : 0;

      await supabase
        .from("ats_job_data")
        .update({
          result_count: statsData.length,
          avg_score: avgScore,
          updated_at: new Date().toISOString(),
        })
        .eq("interview_id", interviewId);
    }

    console.log(`[Process] Batch done: ${processedCount} scored, ${failedCount} failed`);

    return NextResponse.json({ processedCount, failedCount });
  } catch (error: any) {
    console.error("Batch processing error:", error);
    return NextResponse.json({ message: error.message }, { status: 500 });
  }
}
