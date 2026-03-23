import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { PRICING } from "@/types/cost";

// Usage categories
export type UsageCategory =
  | "interview_creation"
  | "interview_response"
  | "insights"
  | "communication_analysis"
  | "voice_call"
  | "blob_upload"
  | "ats_scoring"
  | "company_finder";

export type ServiceType = "openai" | "retell" | "vercel";

// Interfaces for saving usage
export interface SaveOpenAIUsageParams {
  organizationId?: string;
  userId?: string;
  interviewId?: string;
  responseId?: number;
  category: Exclude<UsageCategory, "voice_call" | "blob_upload">;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  model?: string;
  requestId?: string;
  searchCalls?: number;  // Number of web_search_call tool invocations (Responses API)
  metadata?: Record<string, any>;
}

export interface SaveVoiceUsageParams {
  organizationId?: string;
  userId?: string;
  interviewId?: string;
  responseId?: number;
  durationSeconds: number;
  requestId?: string;
  retellCost?: number;      // Cost from Retell API call_cost.combined_cost (in dollars)
  metadata?: Record<string, any>;
}

export interface SaveBlobUploadUsageParams {
  organizationId?: string;
  userId?: string;
  fileSizeBytes: number;
  fileType: "resume" | "image";
  metadata?: Record<string, any>;
}

// Interface for querying usage
export interface UsageFilters {
  startDate?: string;
  endDate?: string;
  category?: UsageCategory;
  interviewId?: string;
  service?: ServiceType;
}

// Interface for usage records
export interface ApiUsageRecord {
  id: number;
  created_at: string;
  organization_id?: string;
  user_id?: string;
  interview_id?: string;
  response_id?: number;
  category: UsageCategory;
  service: ServiceType;
  input_tokens?: number;
  output_tokens?: number;
  total_tokens?: number;
  duration_seconds?: number;
  cost_usd: number;
  model?: string;
  request_id?: string;
  metadata?: Record<string, any>;
}

// Interface for category breakdown
export interface CategoryBreakdown {
  category: UsageCategory;
  categoryLabel: string;
  service: ServiceType;
  count: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalTokens: number;
  totalDurationSeconds: number;
  totalDurationMinutes: number;
  totalCost: number;
}

// Interface for usage summary
export interface UsageSummary {
  totalCost: number;
  totalRecords: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalTokens: number;
  totalDurationMinutes: number;
  byCategory: CategoryBreakdown[];
}

// Category labels for display
const CATEGORY_LABELS: Record<UsageCategory, string> = {
  interview_creation: "Interview Creation",
  interview_response: "Interview Analytics",
  insights: "Insights Generation",
  communication_analysis: "Communication Analysis",
  voice_call: "Voice Call",
  blob_upload: "File Upload",
  ats_scoring: "ATS Scoring",
  company_finder: "Company Finder",
};

function getSupabaseClient(): SupabaseClient {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

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

export class ApiUsageService {
  /**
   * Calculate cost for OpenAI usage based on token counts, model, and web search calls
   */
  static calculateOpenAICost(inputTokens: number, outputTokens: number, model?: string, searchCalls = 0): number {
    const modelKey = model?.toLowerCase() || PRICING.OPENAI_DEFAULT_MODEL;
    const rates = PRICING.OPENAI_MODELS[modelKey] || PRICING.OPENAI_MODELS[PRICING.OPENAI_DEFAULT_MODEL];
    const inputCost = (inputTokens / 1000) * rates.input;
    const outputCost = (outputTokens / 1000) * rates.output;
    const searchCost = searchCalls * PRICING.WEB_SEARCH_PER_CALL;
    return Number((inputCost + outputCost + searchCost).toFixed(6));
  }

  /**
   * Calculate fallback voice cost using flat rate (when Retell API cost is unavailable)
   */
  static calculateVoiceCostFallback(durationSeconds: number): number {
    const durationMinutes = durationSeconds / 60;
    return Number((durationMinutes * PRICING.RETELL_VOICE_PER_MIN).toFixed(6));
  }

  /**
   * Save OpenAI API usage record
   */
  static async saveOpenAIUsage(params: SaveOpenAIUsageParams): Promise<void> {
    const supabase = getSupabaseClient();

    const searchCalls = params.searchCalls || 0;
    const cost = this.calculateOpenAICost(params.inputTokens, params.outputTokens, params.model, searchCalls);

    const searchMeta = searchCalls > 0 ? {
      searchCalls,
      searchCost: Number((searchCalls * PRICING.WEB_SEARCH_PER_CALL).toFixed(6)),
      tokenCost: Number((cost - searchCalls * PRICING.WEB_SEARCH_PER_CALL).toFixed(6)),
    } : {};
    const metadataObj = { ...params.metadata, ...searchMeta };
    const metadata = Object.keys(metadataObj).length > 0 ? metadataObj : null;

    const { error } = await supabase.from("api_usage").insert({
      organization_id: params.organizationId || null,
      user_id: params.userId || null,
      interview_id: params.interviewId || null,
      response_id: params.responseId || null,
      category: params.category,
      service: "openai",
      input_tokens: params.inputTokens,
      output_tokens: params.outputTokens,
      total_tokens: params.totalTokens,
      duration_seconds: null,
      cost_usd: cost,
      model: params.model || "gpt-5-mini",
      request_id: params.requestId || null,
      metadata,
    });

    if (error) {
      console.error("Error saving OpenAI usage:", error);
      // Don't throw - we don't want to break the main flow if logging fails
    }
  }

  /**
   * Save Retell voice usage record
   * Uses request_id (call_id) to prevent duplicate entries
   * Uses Retell API's call_cost.combined_cost for accurate pricing
   */
  static async saveVoiceUsage(params: SaveVoiceUsageParams): Promise<void> {
    const supabase = getSupabaseClient();

    // Check if we already have a voice_call record for this request_id (call_id)
    // This prevents duplicate entries when get-call is called multiple times
    if (params.requestId) {
      const { data: existing } = await supabase
        .from("api_usage")
        .select("id")
        .eq("request_id", params.requestId)
        .eq("category", "voice_call")
        .limit(1);

      if (existing && existing.length > 0) {
        console.log(`Voice usage already recorded for call ${params.requestId}, skipping duplicate`);
        return;
      }
    }

    // Use Retell API cost directly, fallback to flat rate estimate
    const totalCost = params.retellCost != null
      ? Number(params.retellCost.toFixed(6))
      : this.calculateVoiceCostFallback(params.durationSeconds);

    const { error } = await supabase.from("api_usage").insert({
      organization_id: params.organizationId || null,
      user_id: params.userId || null,
      interview_id: params.interviewId || null,
      response_id: params.responseId || null,
      category: "voice_call",
      service: "retell",
      input_tokens: null,
      output_tokens: null,
      total_tokens: null,
      duration_seconds: params.durationSeconds,
      cost_usd: totalCost,
      model: null,
      request_id: params.requestId || null,
      metadata: {
        ...params.metadata,
        costSource: params.retellCost != null ? "retell_api" : "fallback_estimate",
      },
    });

    if (error) {
      console.error("Error saving voice usage:", error);
      // Don't throw - we don't want to break the main flow if logging fails
    }
  }

  /**
   * Calculate cost for Vercel Blob storage
   */
  static calculateBlobCost(fileSizeBytes: number): number {
    const fileSizeGB = fileSizeBytes / (1024 * 1024 * 1024);

    return Number((fileSizeGB * PRICING.VERCEL_BLOB_STORAGE_PER_GB).toFixed(6));
  }

  /**
   * Save Vercel Blob upload record
   */
  static async saveBlobUploadUsage(params: SaveBlobUploadUsageParams): Promise<void> {
    const supabase = getSupabaseClient();

    const cost = this.calculateBlobCost(params.fileSizeBytes);

    const { error } = await supabase.from("api_usage").insert({
      organization_id: params.organizationId || null,
      user_id: params.userId || null,
      interview_id: null,
      response_id: null,
      category: "blob_upload",
      service: "vercel",
      input_tokens: null,
      output_tokens: null,
      total_tokens: null,
      duration_seconds: null,
      cost_usd: cost,
      model: null,
      request_id: null,
      metadata: {
        ...params.metadata,
        fileSizeBytes: params.fileSizeBytes,
        fileType: params.fileType,
      },
    });

    if (error) {
      console.error("Error saving blob upload usage:", error);
      // Don't throw - we don't want to break the main flow if logging fails
    }
  }

  /**
   * Get usage records for an organization with optional filters
   */
  static async getUsageRecords(
    organizationId: string,
    filters?: UsageFilters
  ): Promise<ApiUsageRecord[]> {
    const supabase = getSupabaseClient();

    let query = supabase
      .from("api_usage")
      .select("*")
      .eq("organization_id", organizationId)
      .order("created_at", { ascending: false });

    // Apply filters
    if (filters?.startDate) {
      query = query.gte("created_at", filters.startDate);
    }
    if (filters?.endDate) {
      query = query.lte("created_at", filters.endDate);
    }
    if (filters?.category) {
      query = query.eq("category", filters.category);
    }
    if (filters?.interviewId) {
      query = query.eq("interview_id", filters.interviewId);
    }
    if (filters?.service) {
      query = query.eq("service", filters.service);
    }

    const { data, error } = await query;

    if (error) {
      console.error("Error fetching usage records:", error);
      return [];
    }

    return data || [];
  }

  /**
   * Get usage records by user_id (fallback when organization_id is null)
   */
  static async getUsageRecordsByUser(
    userId: string,
    filters?: UsageFilters
  ): Promise<ApiUsageRecord[]> {
    const supabase = getSupabaseClient();

    let query = supabase
      .from("api_usage")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });

    // Apply filters
    if (filters?.startDate) {
      query = query.gte("created_at", filters.startDate);
    }
    if (filters?.endDate) {
      query = query.lte("created_at", filters.endDate);
    }
    if (filters?.category) {
      query = query.eq("category", filters.category);
    }
    if (filters?.interviewId) {
      query = query.eq("interview_id", filters.interviewId);
    }
    if (filters?.service) {
      query = query.eq("service", filters.service);
    }

    const { data, error } = await query;

    if (error) {
      console.error("Error fetching usage records by user:", error);
      return [];
    }

    return data || [];
  }

  /**
   * Get aggregated usage summary with category breakdown
   */
  static async getUsageSummary(
    organizationId: string,
    filters?: UsageFilters
  ): Promise<UsageSummary> {
    // First try by organization_id, then fall back to user_id
    let records = await this.getUsageRecords(organizationId, filters);

    // If no records found by org, try by user_id
    if (records.length === 0) {
      records = await this.getUsageRecordsByUser(organizationId, filters);
    }

    // Initialize category map
    const categoryMap = new Map<string, CategoryBreakdown>();

    // Aggregate by category
    for (const record of records) {
      const key = `${record.category}-${record.service}`;

      if (!categoryMap.has(key)) {
        categoryMap.set(key, {
          category: record.category,
          categoryLabel: CATEGORY_LABELS[record.category],
          service: record.service,
          count: 0,
          totalInputTokens: 0,
          totalOutputTokens: 0,
          totalTokens: 0,
          totalDurationSeconds: 0,
          totalDurationMinutes: 0,
          totalCost: 0,
        });
      }

      const breakdown = categoryMap.get(key)!;
      breakdown.count += 1;
      breakdown.totalInputTokens += record.input_tokens || 0;
      breakdown.totalOutputTokens += record.output_tokens || 0;
      breakdown.totalTokens += record.total_tokens || 0;
      breakdown.totalDurationSeconds += record.duration_seconds || 0;
      breakdown.totalCost += Number(record.cost_usd) || 0;
    }

    // Calculate minutes and totals
    const byCategory: CategoryBreakdown[] = Array.from(categoryMap.values()).map(b => ({
      ...b,
      totalDurationMinutes: Number((b.totalDurationSeconds / 60).toFixed(2)),
      totalCost: Number(b.totalCost.toFixed(6)),
    }));

    // Calculate overall totals
    const summary: UsageSummary = {
      totalCost: Number(byCategory.reduce((sum, b) => sum + b.totalCost, 0).toFixed(6)),
      totalRecords: records.length,
      totalInputTokens: byCategory.reduce((sum, b) => sum + b.totalInputTokens, 0),
      totalOutputTokens: byCategory.reduce((sum, b) => sum + b.totalOutputTokens, 0),
      totalTokens: byCategory.reduce((sum, b) => sum + b.totalTokens, 0),
      totalDurationMinutes: Number(
        byCategory.reduce((sum, b) => sum + b.totalDurationMinutes, 0).toFixed(2)
      ),
      byCategory,
    };

    return summary;
  }

  /**
   * Get usage for a specific interview
   */
  static async getUsageByInterview(interviewId: string): Promise<ApiUsageRecord[]> {
    const supabase = getSupabaseClient();

    const { data, error } = await supabase
      .from("api_usage")
      .select("*")
      .eq("interview_id", interviewId)
      .order("created_at", { ascending: true });

    if (error) {
      console.error("Error fetching usage by interview:", error);
      return [];
    }

    return data || [];
  }

  /**
   * Get total cost for a specific response (interview session)
   */
  static async getResponseCost(responseId: number): Promise<number> {
    const supabase = getSupabaseClient();

    const { data, error } = await supabase
      .from("api_usage")
      .select("cost_usd")
      .eq("response_id", responseId);

    if (error) {
      console.error("Error fetching response cost:", error);
      return 0;
    }

    return (data || []).reduce((sum, r) => sum + Number(r.cost_usd), 0);
  }
}
