import { getOpenAIClientDirect, DIRECT_MODELS } from "@/lib/openai-client";
import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { normalizeCompanyKey } from "@/lib/normalize-company-key";
import {
  COMPANY_FINDER_SYSTEM_PROMPT,
  generateCompanyFinderPrompt,
  generateEnrichmentPrompt,
} from "@/lib/prompts/company-finder";
import { logger } from "@/lib/logger";
import { ApiUsageService } from "@/services/api-usage.service";
import { CompanyFinderRequest, CompanyFinderAIResponse } from "@/types/company-finder";

export const maxDuration = 300;

const MAX_RESUMES_PER_REQUEST = 10;
const MAX_RESUME_TEXT_LENGTH = 100_000; // ~100K chars per resume
const MAX_ENRICH_COMPANIES = 50;
const OPENAI_TIMEOUT_MS = 290_000; // ~5 minutes — web search needs more time

const CF_MODEL = DIRECT_MODELS.GPT5_MINI;

export async function POST(req: Request) {
  logger.info("company-finder request received");

  let body: CompanyFinderRequest;
  try {
    body = await req.json();
  } catch (error) {
    logger.error("Invalid JSON body for company-finder", { error });
    return NextResponse.json(
      { error: "Invalid request body" },
      { status: 400 }
    );
  }

  if (!body.enrichOnly && (!body.resumes || body.resumes.length === 0)) {
    return NextResponse.json(
      { error: "At least one resume is required" },
      { status: 400 }
    );
  }

  if (!body.enrichOnly && body.resumes && body.resumes.length > MAX_RESUMES_PER_REQUEST) {
    return NextResponse.json(
      { error: `Maximum ${MAX_RESUMES_PER_REQUEST} resumes per request` },
      { status: 400 }
    );
  }

  if (body.enrichOnly && body.enrichOnly.length > MAX_ENRICH_COMPANIES) {
    return NextResponse.json(
      { error: `Maximum ${MAX_ENRICH_COMPANIES} companies per enrichment request` },
      { status: 400 }
    );
  }

  // Truncate oversized resume texts
  const resumes = (body.resumes || []).map((r) => ({
    ...r,
    text: r.text.slice(0, MAX_RESUME_TEXT_LENGTH),
  }));

  if (!process.env.OPENAI_API_KEY) {
    logger.error("OPENAI_API_KEY is not set");
    return NextResponse.json(
      { error: "OpenAI API key is not configured on the server" },
      { status: 500 }
    );
  }

  const openai = getOpenAIClientDirect();

  try {
    // -------------------------------------------------------------------------
    // Responses API with web_search tool for real-time company enrichment
    // -------------------------------------------------------------------------
    const prompt = body.enrichOnly && body.enrichOnly.length > 0
      ? generateEnrichmentPrompt(body.enrichOnly)
      : generateCompanyFinderPrompt({ resumes });

    // Hard abort after timeout to prevent hanging requests
    const abortController = new AbortController();
    const abortTimer = setTimeout(() => abortController.abort(), OPENAI_TIMEOUT_MS);

    let response;
    try {
      response = await openai.responses.create(
        {
          model: CF_MODEL,
          instructions: COMPANY_FINDER_SYSTEM_PROMPT,
          tools: [{ type: "web_search" as any }],
          input: prompt,
          max_output_tokens: 65536,
        } as any,
        { signal: abortController.signal }
      );
    } finally {
      clearTimeout(abortTimer);
    }

    const raw = (response as any).output_text || "{}";

    // Safely extract JSON in case the model wraps output in markdown fences
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    let parsed: CompanyFinderAIResponse = { companies: [] };
    if (jsonMatch) {
      let jsonStr = jsonMatch[0];
      try {
        parsed = JSON.parse(jsonStr);
      } catch {
        // Attempt repair on truncated JSON
        jsonStr = jsonStr.replace(/,\s*([\]}])/g, "$1");
        const openBraces = (jsonStr.match(/\{/g) || []).length;
        const closeBraces = (jsonStr.match(/\}/g) || []).length;
        const openBrackets = (jsonStr.match(/\[/g) || []).length;
        const closeBrackets = (jsonStr.match(/\]/g) || []).length;
        jsonStr += "]".repeat(Math.max(0, openBrackets - closeBrackets));
        jsonStr += "}".repeat(Math.max(0, openBraces - closeBraces));
        try {
          parsed = JSON.parse(jsonStr);
          logger.info("Company finder: repaired truncated JSON successfully");
        } catch (repairErr) {
          logger.error("Company finder: JSON repair failed", { error: repairErr });
        }
      }
    }

    const usage = (response as any).usage;

    // In enrichment-only mode, skip the relevance filter — all companies were already
    // deemed relevant during extraction; re-filtering without resume context is unreliable.
    const companies = (parsed.companies || [])
      .filter((c) => body.enrichOnly ? true : (c as any).isRelevant !== false)
      .map((c) => {
        // Normalize countriesWorkedIn: model may return a comma-separated string instead of array
        const rawField = (c as any).countriesWorkedIn;
        if (typeof rawField === "string" && rawField.trim()) {
          (c as any).countriesWorkedIn = rawField
            .split(/,\s*/)
            .map((s: string) => s.trim())
            .filter(Boolean);
        } else if (!Array.isArray(rawField)) {
          (c as any).countriesWorkedIn = [];
        }
        return c;
      });

    // Track API usage
    ApiUsageService.saveOpenAIUsage({
      userId: body.userId,
      organizationId: body.organizationId,
      category: body.category || "company_finder",
      inputTokens: usage?.input_tokens || 0,
      outputTokens: usage?.output_tokens || 0,
      totalTokens: (usage?.input_tokens || 0) + (usage?.output_tokens || 0),
      model: CF_MODEL,
      metadata: {
        resumeCount: resumes.length,
        resumeNames: resumes.map((r) => r.name),
      },
    }).catch((err) => {
      logger.error("Failed to save API usage for company finder", { error: err });
    });

    // Auto-save ALL enriched companies to cache (fire-and-forget)
    // We cache regardless of isRelevant so we never web-search the same company twice.
    const allEnrichedCompanies = parsed.companies || [];
    if (allEnrichedCompanies.length > 0) {
      try {
        const supabase = createClient(
          process.env.NEXT_PUBLIC_SUPABASE_URL!,
          process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
        );
        const now = new Date().toISOString();
        // Deduplicate by normalized company name before upserting
        const seen = new Set<string>();
        const cacheRows = allEnrichedCompanies
          .filter((c: any) => {
            const key = c.companyName.toLowerCase().trim().replace(/\s+/g, " ");
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
          })
          .map((c: any) => ({
            company_name: c.companyName,
            normalized_key: normalizeCompanyKey(c.companyName),
            company_type: c.companyType || "unknown",
            company_info: c.companyInfo || null,
            headquarters: c.headquarters || null,
            founded_year: c.foundedYear || null,
            countries_worked_in: c.countriesWorkedIn || [],
            is_relevant: c.isRelevant ?? false,
            enriched_at: now,
            created_at: now,
          }));
        supabase
          .from("company_cache")
          .upsert(cacheRows, { onConflict: "normalized_key" })
          .then(({ error: cacheErr }) => {
            if (cacheErr) logger.error("Auto-cache upsert failed", { error: cacheErr });
            else logger.info("Auto-cached companies", { count: cacheRows.length });
          });
      } catch (cacheErr) {
        logger.error("Auto-cache error", { error: cacheErr });
      }
    }

    logger.info("Company finder completed successfully", {
      resumeCount: resumes.length,
      companiesFound: companies.length,
      inputTokens: usage?.input_tokens,
      outputTokens: usage?.output_tokens,
    });

    return NextResponse.json({ companies }, { status: 200 });
  } catch (error: any) {
    const errMsg = error?.message || error?.error?.message || JSON.stringify(error) || String(error);
    const isTimeout = errMsg.includes('abort') || errMsg.includes('timeout') || errMsg.includes('ETIMEDOUT');
    logger.error("Company finder error", { error: errMsg, isTimeout });

    return NextResponse.json(
      { error: isTimeout ? "Request timed out. Try with fewer resumes." : "Company analysis failed. Please try again." },
      { status: isTimeout ? 504 : 500 }
    );
  }
}
