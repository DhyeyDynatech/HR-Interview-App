import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { verifyToken, getUserById } from "@/lib/auth";
import { ATSScoreResult } from "@/types/ats-scoring";

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
  if (!user) return null;

  return { userId, organizationId: user.organization_id || user.id };
}

// GET /api/ats-scoring/jobs/[interviewId] - full detail for one job (supports pagination)
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

    // 1. Get job metadata
    const { data: jobData, error: jobError } = await supabase
      .from("ats_job_data")
      .select("interview_id, jd_text, jd_filename, result_count, avg_score, interview:interview_id(name)")
      .eq("interview_id", interviewId)
      .eq("organization_id", auth.organizationId)
      .single();

    if (jobError && jobError.code === "PGRST116") {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (jobError) throw jobError;

    // 2. Check for an active batch job (so UI can restore progress on remount)
    const { data: activeBatchJob } = await supabase
      .from("ats_batch_jobs")
      .select("id, total_items, processed_items, failed_items")
      .eq("interview_id", interviewId)
      .eq("status", "processing")
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    // 3. Get pagination params
    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get("limit") || "10000"); 
    const offset = parseInt(searchParams.get("offset") || "0");

    // 3. Get total count
    const { count, error: countError } = await supabase
      .from("ats_score_items")
      .select("*", { count: "exact", head: true })
      .eq("interview_id", interviewId);

    if (countError) throw countError;

    // Check if ats_job_data summary count matches the true count. Auto-repair if out of sync.
    if (count !== null && count !== jobData.result_count) {
       // Also recalculate avg score to repair completely
       const { data: statsData } = await supabase
         .from("ats_score_items")
         .select("overall_score")
         .eq("interview_id", interviewId);
       
       const avgScore = statsData && statsData.length > 0
         ? Math.round(statsData.reduce((sum, r) => sum + r.overall_score, 0) / statsData.length)
         : 0;
         
       const { error: repairError } = await supabase
         .from("ats_job_data")
         .update({ result_count: count, avg_score: avgScore })
         .eq("interview_id", interviewId);
         
       if (!repairError) {
         jobData.result_count = count;
         jobData.avg_score = avgScore;
       }
    }

    // 4. Get individual scores from the relational table (paged)
    const { data: scoreItems, error: scoresError } = await supabase
      .from("ats_score_items")
      .select("*")
      .eq("interview_id", interviewId)
      .order("overall_score", { ascending: false })
      .range(offset, offset + limit - 1);

    if (scoresError) throw scoresError;

    // Map from DB (snake_case) to Frontend (camelCase) types
    const mappedResults = (scoreItems || []).map((item: any) => ({
      resumeName: item.resume_name,
      overallScore: item.overall_score,
      categoryScores: item.category_scores,
      categoryDetails: item.category_details,
      matchedSkills: item.matched_skills,
      missingSkills: item.missing_skills,
      strengths: item.strengths,
      interviewFocusAreas: item.interview_focus_areas,
      summary: item.summary,
      candidateDetails: item.candidate_details,
      suggestedTag: item.suggested_tag,
      resumeUrl: item.resume_url,
      scoredAt: item.scored_at,
      candidateProfile: item.candidate_profile,
      jdUnderstanding: item.jd_understanding,
      experienceDepthAnalysis: item.experience_depth_analysis,
      swotAnalysis: item.swot_analysis,
      experienceMatch: item.experience_match,
    }));

    return NextResponse.json(
      {
        results: mappedResults,
        pagination: {
          total: count || 0,
          offset,
          limit,
        },
        interviewId: jobData.interview_id,
        interviewName: (jobData as any).interview?.name || "Untitled",
        jdText: jobData.jd_text || "",
        jdFilename: jobData.jd_filename || "",
        activeBatchJob: activeBatchJob
          ? {
              id: activeBatchJob.id,
              totalItems: activeBatchJob.total_items,
              processedItems: activeBatchJob.processed_items,
              failedItems: activeBatchJob.failed_items,
            }
          : null,
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
    const supabase = getSupabaseClient();

    // Handle JD updates in the main table
    if (body.jdText !== undefined || body.jdFilename !== undefined) {
      const updatePayload: any = { updated_at: new Date().toISOString() };
      if (body.jdText !== undefined) updatePayload.jd_text = body.jdText;
      if (body.jdFilename !== undefined) updatePayload.jd_filename = body.jdFilename;

      const { error } = await supabase
        .from("ats_job_data")
        .update(updatePayload)
        .eq("interview_id", interviewId)
        .eq("organization_id", auth.organizationId);
      if (error) throw error;
    }

    // Handle results updates - Bulk Upsert to the new relational table
    if (body.results !== undefined) {
      const results: ATSScoreResult[] = body.results || [];
      const keepNames = results.map(r => r.resumeName);

      // 1. Delete rows that are no longer in the results array
      if (keepNames.length > 0) {
        const { error: deleteError } = await supabase
          .from("ats_score_items")
          .delete()
          .eq("interview_id", interviewId)
          .not("resume_name", "in", `(${keepNames.map(n => `"${n.replace(/"/g, '\\"')}"`).join(",")})`);
        if (deleteError) throw deleteError;
      } else {
        // All results deleted — remove all rows for this interview
        const { error: deleteError } = await supabase
          .from("ats_score_items")
          .delete()
          .eq("interview_id", interviewId);
        if (deleteError) throw deleteError;
      }

      // 2. Upsert remaining results
      const scoreRows = results.map(r => ({
        interview_id: interviewId,
        organization_id: auth.organizationId,
        resume_name: r.resumeName,
        resume_url: r.resumeUrl,
        overall_score: r.overallScore,
        category_scores: r.categoryScores,
        category_details: r.categoryDetails,
        matched_skills: r.matchedSkills,
        missing_skills: r.missingSkills,
        strengths: r.strengths,
        interview_focus_areas: r.interviewFocusAreas,
        summary: r.summary,
        candidate_details: r.candidateDetails,
        suggested_tag: r.suggestedTag,
        candidate_profile: r.candidateProfile,
        jd_understanding: r.jdUnderstanding,
        experience_depth_analysis: r.experienceDepthAnalysis,
        swot_analysis: r.swotAnalysis
      }));

      if (scoreRows.length > 0) {
        const { error: upsertError } = await supabase
          .from("ats_score_items")
          .upsert(scoreRows, { onConflict: "interview_id,resume_name" });
        if (upsertError) throw upsertError;
      }

      // 3. Update summary stats in the main table (avg score, result count)
      const avgScore = results.length > 0
        ? Math.round(results.reduce((sum, r) => sum + r.overallScore, 0) / results.length)
        : 0;

      const { error: summaryError } = await supabase
        .from("ats_job_data")
        .update({
          result_count: results.length,
          avg_score: avgScore,
          updated_at: new Date().toISOString()
        })
        .eq("interview_id", interviewId)
        .eq("organization_id", auth.organizationId);

      if (summaryError) throw summaryError;
    }

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
/** PATCH — cancel the active batch job (Stop button) */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ interviewId: string }> }
) {
  try {
    const auth = await extractAuth(request);
    if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { interviewId } = await params;
    const supabase = getSupabaseClient();

    // Mark the active batch job as cancelled
    await supabase
      .from("ats_batch_jobs")
      .update({ status: "cancelled", updated_at: new Date().toISOString() })
      .eq("interview_id", interviewId)
      .eq("status", "processing");

    // Mark all pending tasks for that job as cancelled
    const { data: job } = await supabase
      .from("ats_batch_jobs")
      .select("id")
      .eq("interview_id", interviewId)
      .eq("status", "cancelled")
      .order("updated_at", { ascending: false })
      .limit(1)
      .single();

    if (job) {
      await supabase
        .from("ats_job_tasks")
        .update({ status: "cancelled" })
        .eq("job_id", job.id)
        .eq("status", "pending");
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

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
