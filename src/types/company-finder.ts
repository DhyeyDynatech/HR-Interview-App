// ---------- AI Response Types ----------

export type CompanyType = "service_provider" | "service_consumer" | "unknown";

export interface ExtractedCompany {
  companyName: string;
  companyType: CompanyType;
  companyInfo: string;
  headquarters: string;
  foundedYear: string;
  countriesWorkedIn: string[];
  technologies: string[];
  relevantDomains: string[];
  context: string;
}

// Intermediate type returned by Step 1 extraction.
// Only resume-derived fields — companyName, resumeName, context.
// All other fields are filled by Step 2 web search.
export interface ExtractedCompanyRaw {
  companyName: string;
  resumeName?: string;
  technologies?: string[];
  context: string;
  // Fields filled by Step 2 web search:
  isRelevant?: boolean;
  companyType?: CompanyType;
  companyInfo?: string;
  headquarters?: string;
  foundedYear?: string;
  countriesWorkedIn?: string[];
  relevantDomains?: string[];
}

export interface CompanyFinderAIResponse {
  companies: ExtractedCompanyRaw[];
}

// ---------- Aggregated Result (after dedup across resumes) ----------

export interface AggregatedCompany {
  companyName: string;
  companyType: CompanyType;
  companyInfo?: string;
  headquarters?: string;
  foundedYear?: string;
  countriesWorkedIn?: string[];
  technologies: string[];
  relevantDomains: string[];
  sourceResumes: string[];
  frequency: number;
  contexts: string[];
  scannedAt?: string;
}

// ---------- API Request/Response ----------

export interface CompanyFinderRequest {
  resumes: { name: string; text: string }[];
  userId?: string;
  organizationId?: string;
  category?: "company_finder" | "ats_scoring";
  // Enrichment-only mode: skip extraction and just enrich these company names
  enrichOnly?: string[];
}

export interface CompanyFinderResponse {
  companies: ExtractedCompany[];
}

// ---------- Extraction-Only (Stage A) ----------

export interface ExtractedCompanyName {
  companyName: string;
  resumeName: string;
  context: string;
}

export interface ExtractionOnlyResponse {
  companies: ExtractedCompanyName[];
}

// ---------- Company Cache (Stage B) ----------

export interface CachedCompany {
  companyName: string;
  normalizedKey: string;
  companyType: CompanyType;
  companyInfo?: string;
  headquarters?: string;
  foundedYear?: string;
  countriesWorkedIn?: string[];
  isRelevant?: boolean;
  enrichedAt: string;
}

export interface CacheLookupResponse {
  cached: CachedCompany[];
  misses: string[];
}

// ---------- Client-Side Parsed Resume ----------

export interface CFParsedResume {
  name: string;
  text: string;
  file: File;
}

// ---------- Scan Persistence (Supabase) ----------

export interface CFScanCard {
  id: string;
  name: string;
  companyCount: number;
  resumeCount: number;
  createdAt: string;
}

export interface CFScanDetail {
  id: string;
  name: string;
  results: AggregatedCompany[];
  resumeNames: string[];
  resumeUrls?: Record<string, string>;
}
