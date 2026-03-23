import { createClient, SupabaseClient } from "@supabase/supabase-js";
import {
  CostBreakdown,
  CostFilters,
  CostSummary,
  InterviewCostData,
  PRICING,
  CategoryCostBreakdown,
  EnhancedCostSummary,
  UsageCategory,
  CATEGORY_LABELS,
} from "@/types/cost";

function getSupabaseClient(): SupabaseClient {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseKey) {
    throw new Error("Supabase key is required.");
  }

  if (!supabaseUrl) {
    throw new Error("Supabase URL is required.");
  }

  // Create a fresh client for each request in serverless environment
  // This avoids stale connection issues on Vercel
  return createClient(supabaseUrl, supabaseKey);
}

export class CostService {
  static calculateCostBreakdown(duration: number): CostBreakdown {
    // Duration is in seconds, convert to minutes
    const durationMinutes = duration / 60;

    // Voice cost based on call duration
    const voiceCost = durationMinutes * PRICING.RETELL_VOICE_PER_MIN;

    // Estimated GPT costs (analytics generation per interview)
    const inputTokens = PRICING.ESTIMATED_INPUT_TOKENS;
    const outputTokens = PRICING.ESTIMATED_OUTPUT_TOKENS;
    const totalTokens = inputTokens + outputTokens;

    const gptInputCost = (inputTokens / 1000) * PRICING.GPT5_INPUT_PER_1K;
    const gptOutputCost = (outputTokens / 1000) * PRICING.GPT5_OUTPUT_PER_1K;
    const gptCost = gptInputCost + gptOutputCost;

    return {
      gpt: {
        inputTokens,
        outputTokens,
        totalTokens,
        cost: Number(gptCost.toFixed(4)),
      },
      voice: {
        durationMinutes: Number(durationMinutes.toFixed(2)),
        cost: Number(voiceCost.toFixed(4)),
      },
      total: Number((gptCost + voiceCost).toFixed(4)),
    };
  }

  static async getCostAnalytics(
    organizationId: string,
    filters?: CostFilters
  ): Promise<{ data: InterviewCostData[]; summary: CostSummary }> {
    const supabase = getSupabaseClient();

    // Build query to get responses with interview data
    let query = supabase
      .from("response")
      .select(`
        id,
        created_at,
        interview_id,
        name,
        email,
        duration,
        is_analysed,
        interview:interview_id (
          id,
          name,
          organization_id,
          user_id
        )
      `)
      .eq("is_ended", true)
      .not("duration", "is", null);

    // Apply date filters
    if (filters?.startDate) {
      query = query.gte("created_at", filters.startDate);
    }
    if (filters?.endDate) {
      query = query.lte("created_at", filters.endDate);
    }
    if (filters?.interviewId) {
      query = query.eq("interview_id", filters.interviewId);
    }

    // Apply sorting
    const sortBy = filters?.sortBy || "date";
    const sortOrder = filters?.sortOrder || "desc";

    if (sortBy === "date") {
      query = query.order("created_at", { ascending: sortOrder === "asc" });
    } else if (sortBy === "duration") {
      query = query.order("duration", { ascending: sortOrder === "asc" });
    }

    const { data: responses, error } = await query;

    if (error) {
      console.error("Error fetching cost data:", error);
      throw new Error("Failed to fetch cost data");
    }

    // Filter by organization_id (from interview relation)
    // If organization_id is null, fall back to filtering by user_id
    const filteredResponses = (responses || []).filter((r: any) => {
      // If organization_id is set, filter by it
      if (r.interview?.organization_id) {
        return r.interview.organization_id === organizationId;
      }
      // Fallback: if no organization_id on interview, match by user_id
      // This handles cases where organization isn't set up yet
      return r.interview?.user_id === organizationId;
    });

    // Calculate costs for each interview
    let costData: InterviewCostData[] = filteredResponses.map((response: any) => {
      const duration = response.duration || 0;
      const costBreakdown = this.calculateCostBreakdown(duration);

      return {
        id: response.id,
        interviewId: response.interview_id,
        interviewName: response.interview?.name || "Unknown Interview",
        candidateName: response.name || "Unknown",
        candidateEmail: response.email || "",
        date: response.created_at,
        duration: duration,
        costBreakdown,
      };
    });

    // Apply cost filters
    if (filters?.minCost !== undefined) {
      costData = costData.filter(d => d.costBreakdown.total >= filters.minCost!);
    }
    if (filters?.maxCost !== undefined) {
      costData = costData.filter(d => d.costBreakdown.total <= filters.maxCost!);
    }

    // Sort by cost if needed (since we can't do it in the query)
    if (sortBy === "cost") {
      costData.sort((a, b) => {
        const diff = a.costBreakdown.total - b.costBreakdown.total;
        return sortOrder === "asc" ? diff : -diff;
      });
    }

    // Calculate summary
    const summary: CostSummary = {
      totalCost: 0,
      totalInterviews: costData.length,
      avgCostPerInterview: 0,
      gptCost: 0,
      voiceCost: 0,
      totalTokens: 0,
      totalMinutes: 0,
    };

    costData.forEach(item => {
      summary.totalCost += item.costBreakdown.total;
      summary.gptCost += item.costBreakdown.gpt.cost;
      summary.voiceCost += item.costBreakdown.voice.cost;
      summary.totalTokens += item.costBreakdown.gpt.totalTokens;
      summary.totalMinutes += item.costBreakdown.voice.durationMinutes;
    });

    summary.totalCost = Number(summary.totalCost.toFixed(4));
    summary.gptCost = Number(summary.gptCost.toFixed(4));
    summary.voiceCost = Number(summary.voiceCost.toFixed(4));
    summary.totalMinutes = Number(summary.totalMinutes.toFixed(2));
    summary.avgCostPerInterview = costData.length > 0
      ? Number((summary.totalCost / costData.length).toFixed(4))
      : 0;

    return { data: costData, summary };
  }

  static async getInterviewsList(organizationId: string): Promise<{ id: string; name: string }[]> {
    const supabase = getSupabaseClient();

    // Try by organization_id first, then by user_id
    let { data, error } = await supabase
      .from("interview")
      .select("id, name")
      .eq("organization_id", organizationId)
      .order("created_at", { ascending: false });

    // If no results by org_id, try by user_id
    if ((!data || data.length === 0) && !error) {
      const result = await supabase
        .from("interview")
        .select("id, name")
        .eq("user_id", organizationId)
        .order("created_at", { ascending: false });
      data = result.data;
      error = result.error;
    }

    if (error) {
      console.error("Error fetching interviews list:", error);
      return [];
    }

    return (data || []).map((i: any) => ({ id: i.id, name: i.name || "Unnamed Interview" }));
  }

  /**
   * Get cost analytics with category breakdown from api_usage table
   * This uses real tracked data instead of estimates
   */
  static async getCostAnalyticsWithCategories(
    organizationId: string,
    filters?: CostFilters
  ): Promise<{ data: any[]; summary: EnhancedCostSummary }> {
    const supabase = getSupabaseClient();

    // Build query to get api_usage records
    const sortBy = filters?.sortBy || "date";
    const sortOrder = filters?.sortOrder || "desc";

    let query = supabase
      .from("api_usage")
      .select(`
        id,
        created_at,
        organization_id,
        user_id,
        interview_id,
        response_id,
        category,
        service,
        input_tokens,
        output_tokens,
        total_tokens,
        duration_seconds,
        cost_usd,
        model,
        request_id,
        metadata
      `);

    // Apply server-side sorting where possible
    if (sortBy === "date") {
      query = query.order("created_at", { ascending: sortOrder === "asc" });
    } else if (sortBy === "duration") {
      query = query.order("duration_seconds", { ascending: sortOrder === "asc" });
    } else {
      // "cost" sort is applied client-side after fetching
      query = query.order("created_at", { ascending: false });
    }

    // Apply date filters
    if (filters?.startDate) {
      query = query.gte("created_at", filters.startDate);
    }
    if (filters?.endDate) {
      query = query.lte("created_at", filters.endDate);
    }
    if (filters?.interviewId) {
      query = query.eq("interview_id", filters.interviewId);
    }
    if (filters?.category) {
      query = query.eq("category", filters.category);
    }

    const { data: usageRecords, error } = await query;

    if (error) {
      console.error("Error fetching api_usage data:", error);
      // Fall back to legacy method if api_usage table doesn't exist or errors

      return this.getCostAnalytics(organizationId, filters) as any;
    }

    // Filter by organization_id or user_id
    const filteredRecords = (usageRecords || []).filter((r: any) => {
      if (r.organization_id) {
        return r.organization_id === organizationId;
      }

      return r.user_id === organizationId;
    });

    // Fetch interview names for records that have interview_id
    const interviewIds = Array.from(new Set(filteredRecords.map((r: any) => r.interview_id).filter(Boolean)));
    const interviewMap = new Map<string, { name: string; description: string }>();

    if (interviewIds.length > 0) {
      const { data: interviews } = await supabase
        .from("interview")
        .select("id, name, description")
        .in("id", interviewIds);

      if (interviews) {
        interviews.forEach((interview: any) => {
          interviewMap.set(interview.id, {
            name: interview.name || "Unnamed Interview",
            description: interview.description || "",
          });
        });
      }
    }

    // Group by category for breakdown
    const categoryMap = new Map<UsageCategory, CategoryCostBreakdown>();

    for (const record of filteredRecords) {
      const category = record.category as UsageCategory;

      if (!categoryMap.has(category)) {
        categoryMap.set(category, {
          category,
          categoryLabel: CATEGORY_LABELS[category] || category,
          service: record.service,
          count: 0,
          totalInputTokens: 0,
          totalOutputTokens: 0,
          totalTokens: 0,
          totalDurationMinutes: 0,
          totalCost: 0,
          totalStorageBytes: 0,
        });
      }

      const breakdown = categoryMap.get(category)!;
      breakdown.count += 1;
      breakdown.totalInputTokens += record.input_tokens || 0;
      breakdown.totalOutputTokens += record.output_tokens || 0;
      breakdown.totalTokens += record.total_tokens || 0;
      breakdown.totalDurationMinutes += (record.duration_seconds || 0) / 60;
      breakdown.totalCost += Number(record.cost_usd) || 0;
      if (category === "blob_upload") {
        breakdown.totalStorageBytes += (record as any).metadata?.fileSizeBytes || 0;
      }
    }

    // Format category breakdown
    const byCategory: CategoryCostBreakdown[] = Array.from(categoryMap.values()).map(b => ({
      ...b,
      totalDurationMinutes: Number(b.totalDurationMinutes.toFixed(2)),
      totalCost: Number(b.totalCost.toFixed(6)),
    }));

    // Calculate totals
    const gptCategories = byCategory.filter(b => b.service === "openai");
    const voiceCategories = byCategory.filter(b => b.service === "retell");

    // --- Avg Cost per Interview ---
    // Interview-related categories: voice_call, interview_response, communication_analysis,
    // interview_creation, insights
    const interviewCategories: UsageCategory[] = [
      "voice_call", "interview_response", "communication_analysis",
      "interview_creation", "insights",
    ];
    const interviewRecords = filteredRecords.filter(
      (r: any) => interviewCategories.includes(r.category)
    );
    const interviewCost = interviewRecords.reduce(
      (sum: number, r: any) => sum + (Number(r.cost_usd) || 0), 0
    );
    // Count interview cycles = number of voice_call records (each = one interview session)
    const interviewCycles = filteredRecords.filter(
      (r: any) => r.category === "voice_call"
    ).length;

    // --- Avg Cost per Resume for ATS Scoring (ats_scoring category includes CF when run from ATS) ---
    const atsRecords = filteredRecords.filter((r: any) => r.category === "ats_scoring");
    const atsCost = atsRecords.reduce(
      (sum: number, r: any) => sum + (Number(r.cost_usd) || 0), 0
    );
    const atsResumes = atsRecords.reduce(
      (sum: number, r: any) => sum + (r.metadata?.resumeCount || 0), 0
    );

    // --- Avg Cost per Resume for standalone Company Finder ---
    const cfRecords = filteredRecords.filter((r: any) => r.category === "company_finder");
    const cfCost = cfRecords.reduce(
      (sum: number, r: any) => sum + (Number(r.cost_usd) || 0), 0
    );
    const cfResumes = cfRecords.reduce(
      (sum: number, r: any) => sum + (r.metadata?.resumeCount || 0), 0
    );

    const avgInterviewCost = interviewCycles > 0
      ? Number((interviewCost / interviewCycles).toFixed(6))
      : 0;

    const totalGptCost = Number(gptCategories.reduce((sum, b) => sum + b.totalCost, 0).toFixed(6));
    // Sum web search costs stored in metadata.searchCost by the enrichment routes
    const totalWebSearchCost = Number(
      filteredRecords
        .reduce((sum: number, r: any) => sum + (Number(r.metadata?.searchCost) || 0), 0)
        .toFixed(6)
    );
    const totalTokenCost = Number(Math.max(0, totalGptCost - totalWebSearchCost).toFixed(6));

    const summary: EnhancedCostSummary = {
      totalCost: Number(byCategory.reduce((sum, b) => sum + b.totalCost, 0).toFixed(6)),
      totalInterviews: new Set(filteredRecords.map((r: any) => r.interview_id).filter(Boolean)).size,
      // interview-only cost (voice + analytics + communication + question gen + insights)
      avgCostPerInterview: avgInterviewCost,
      gptCost: totalGptCost,
      voiceCost: Number(voiceCategories.reduce((sum, b) => sum + b.totalCost, 0).toFixed(6)),
      totalTokens: byCategory.reduce((sum, b) => sum + b.totalTokens, 0),
      totalMinutes: Number(voiceCategories.reduce((sum, b) => sum + b.totalDurationMinutes, 0).toFixed(2)),
      byCategory,
      avgInterviewCost,
      totalInterviewCycles: interviewCycles,
      tokenCost: totalTokenCost,
      webSearchCost: totalWebSearchCost,
      avgCostPerResumeATS: atsResumes > 0
        ? Number((atsCost / atsResumes).toFixed(6))
        : 0,
      totalATSResumes: atsResumes,
      avgCostPerResumeCF: cfResumes > 0
        ? Number((cfCost / cfResumes).toFixed(6))
        : 0,
      totalCFResumes: cfResumes,
    };

    // Transform records into display format with interview details
    const data = filteredRecords.map((record: any) => {
      const interviewInfo = record.interview_id ? interviewMap.get(record.interview_id) : null;
      return {
        id: record.id,
        date: record.created_at,
        category: record.category,
        categoryLabel: CATEGORY_LABELS[record.category as UsageCategory] || record.category,
        service: record.service,
        interviewId: record.interview_id,
        interviewName: interviewInfo?.name || null,
        interviewDescription: interviewInfo?.description || null,
        responseId: record.response_id,
        inputTokens: record.input_tokens,
        outputTokens: record.output_tokens,
        totalTokens: record.total_tokens,
        durationSeconds: record.duration_seconds,
        durationMinutes: record.duration_seconds ? Number((record.duration_seconds / 60).toFixed(2)) : null,
        cost: Number(record.cost_usd) || 0,
        model: record.model,
        metadata: record.metadata,
      };
    });

    // Apply client-side cost sort (can't be done server-side)
    if (sortBy === "cost") {
      data.sort((a, b) => sortOrder === "asc" ? a.cost - b.cost : b.cost - a.cost);
    }

    return { data, summary };
  }

  /**
   * Check if api_usage table has data for this organization
   * Used to determine whether to use new or legacy cost calculation
   */
  static async hasApiUsageData(organizationId: string): Promise<boolean> {
    const supabase = getSupabaseClient();

    const { count, error } = await supabase
      .from("api_usage")
      .select("*", { count: "exact", head: true })
      .or(`organization_id.eq.${organizationId},user_id.eq.${organizationId}`)
      .limit(1);

    if (error) {
      console.error("Error checking api_usage data:", error);

      return false;
    }

    return (count || 0) > 0;
  }
}
