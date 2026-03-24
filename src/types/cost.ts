export interface CostBreakdown {
  gpt: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    cost: number;
  };
  voice: {
    durationMinutes: number;
    cost: number;
  };
  total: number;
}

export interface InterviewCostData {
  id: number;
  interviewId: string;
  interviewName: string;
  candidateName: string;
  candidateEmail: string;
  date: string;
  duration: number;
  costBreakdown: CostBreakdown;
}

export interface CostSummary {
  totalCost: number;
  totalInterviews: number;
  avgCostPerInterview: number;
  gptCost: number;
  voiceCost: number;
  totalTokens: number;
  totalMinutes: number;
}

export interface CostFilters {
  startDate?: string;
  endDate?: string;
  interviewId?: string;
  minCost?: number;
  maxCost?: number;
  sortBy?: 'date' | 'cost' | 'duration';
  sortOrder?: 'asc' | 'desc';
  category?: UsageCategory;
}

// Pricing constants (per 1K tokens for OpenAI models, per minute for voice)
export const PRICING = {
  // OpenAI model pricing (per 1K tokens) — only models actively used in code
  OPENAI_MODELS: {
    "gpt-5-mini": { input: 0.00025,  output: 0.002   },  // $0.25 / $2.00 per 1M
  } as Record<string, { input: number; output: number }>,

  // Default model for cost calculation when model is unknown
  OPENAI_DEFAULT_MODEL: "gpt-5-mini",

  // Legacy flat rates (used by cost.service.ts estimated view) — matches gpt-5-mini pricing
  GPT5_INPUT_PER_1K: 0.00025,
  GPT5_OUTPUT_PER_1K: 0.002,

  // Retell Voice — cost comes from Retell API (call_cost.combined_cost)
  // This flat rate is only used as fallback when API cost is unavailable
  RETELL_VOICE_PER_MIN: 0.07,

  // OpenAI Web Search tool — per search call (flat fee)
  // gpt-5-mini: $10 / 1,000 calls = $0.01 per call
  WEB_SEARCH_PER_CALL: 0.01,  // $0.01 per call

  // Vercel Blob storage
  VERCEL_BLOB_STORAGE_PER_GB: 0.023,   // $0.023 per GB stored per month
  VERCEL_BLOB_TRANSFER_PER_GB: 0.05,   // $0.05 per GB data transfer

  // Estimated tokens per interview analytics call (fallback for legacy data)
  ESTIMATED_INPUT_TOKENS: 2000,
  ESTIMATED_OUTPUT_TOKENS: 800,
};

// Usage categories for cost tracking
export type UsageCategory =
  | "interview_creation"      // Question generation when creating interview
  | "interview_response"      // Analytics generation after interview ends
  | "insights"               // Aggregate insights generation
  | "communication_analysis" // Communication skill analysis
  | "voice_call"             // Retell voice call
  | "blob_upload"            // Vercel blob storage uploads
  | "ats_scoring"            // ATS resume scoring against job description
  | "company_finder";        // Company extraction from resumes

export type ServiceType = "openai" | "retell" | "vercel";

// Category labels for display
export const CATEGORY_LABELS: Record<UsageCategory, string> = {
  interview_creation: "Interview Creation",
  interview_response: "Interview Analytics",
  insights: "Insights Generation",
  communication_analysis: "Communication Analysis",
  voice_call: "Voice Call",
  blob_upload: "File Upload",
  ats_scoring: "ATS Scoring",
  company_finder: "Company Finder",
};

// Interface for category breakdown in summary
export interface CategoryCostBreakdown {
  category: UsageCategory;
  categoryLabel: string;
  service: ServiceType;
  count: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalTokens: number;
  totalDurationMinutes: number;
  totalCost: number;
  totalStorageBytes: number; // for blob_upload: total bytes stored across all uploads
}

// Enhanced cost summary with category breakdown
export interface EnhancedCostSummary extends CostSummary {
  byCategory: CategoryCostBreakdown[];
  // Avg cost for a single interview (voice + analytics + communication + question gen + insights)
  avgInterviewCost: number;
  totalInterviewCycles: number;
  // Avg cost per resume for ATS Scoring + Company Finder combined
  avgCostPerResumeATS: number;
  totalATSResumes: number;
  // Avg cost per resume for standalone Company Finder
  avgCostPerResumeCF: number;
  totalCFResumes: number;
  // GPT cost split: token cost vs web search call cost
  tokenCost: number;       // Pure LLM token cost (input + output)
  webSearchCost: number;   // Web search call fees ($0.01/call)
}

// Interface for API usage records
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
