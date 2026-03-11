import { OpenAI } from "openai";
import { NextResponse } from "next/server";
import {
  COMPANY_FINDER_SYSTEM_PROMPT,
  generateCompanyFinderPrompt,
  generateEnrichmentPrompt,
} from "@/lib/prompts/company-finder";
import { logger } from "@/lib/logger";
import { ApiUsageService } from "@/services/api-usage.service";
import { CompanyFinderRequest, CompanyFinderAIResponse } from "@/types/company-finder";

export const maxDuration = 120;

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

  if (!process.env.OPENAI_API_KEY) {
    logger.error("OPENAI_API_KEY is not set");
    return NextResponse.json(
      { error: "OpenAI API key is not configured on the server" },
      { status: 500 }
    );
  }

  const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    maxRetries: 1,
    dangerouslyAllowBrowser: true,
  });

  try {
    // -------------------------------------------------------------------------
    // Single call: gpt-5
    // Either extract+enrich companies from resume text (normal mode),
    // or enrich a list of company names only (enrichOnly mode).
    // -------------------------------------------------------------------------
    const prompt = body.enrichOnly && body.enrichOnly.length > 0
      ? generateEnrichmentPrompt(body.enrichOnly)
      : generateCompanyFinderPrompt({ resumes: body.resumes });

    const completion = await openai.chat.completions.create({
      model: "gpt-5",
      max_completion_tokens: 65536,
      messages: [
        { role: "system", content: COMPANY_FINDER_SYSTEM_PROMPT },
        { role: "user", content: prompt },
      ],
    } as any);

    const raw = completion.choices[0]?.message?.content || "{}";

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

    const usage = completion.usage;

    // In enrichment-only mode, skip the relevance filter — all companies were already
    // deemed relevant during extraction; re-filtering without resume context is unreliable.
    const companies = (parsed.companies || [])
      .filter((c) => body.enrichOnly ? true : (c as any).isRelevant === true)
      .map((c) => {
        // Normalize countriesWorkedIn: model may return a comma-separated string instead of array
        const raw = (c as any).countriesWorkedIn;
        if (typeof raw === "string" && raw.trim()) {
          (c as any).countriesWorkedIn = raw
            .split(/,\s*/)
            .map((s: string) => s.trim())
            .filter(Boolean);
        } else if (!Array.isArray(raw)) {
          (c as any).countriesWorkedIn = [];
        }
        return c;
      });

    // Track API usage
    ApiUsageService.saveOpenAIUsage({
      userId: body.userId,
      organizationId: body.organizationId,
      category: body.category || "company_finder",
      inputTokens: usage?.prompt_tokens || 0,
      outputTokens: usage?.completion_tokens || 0,
      totalTokens: usage?.total_tokens || 0,
      model: "gpt-5",
      metadata: {
        resumeCount: body.resumes.length,
        resumeNames: body.resumes.map((r) => r.name),
      },
    }).catch((err) => {
      logger.error("Failed to save API usage for company finder", { error: err });
    });

    logger.info("Company finder completed successfully", {
      resumeCount: body.resumes.length,
      companiesFound: companies.length,
      inputTokens: usage?.prompt_tokens,
      outputTokens: usage?.completion_tokens,
    });

    return NextResponse.json({ companies }, { status: 200 });
  } catch (error: any) {
    const errorMessage = error?.message || String(error);
    console.error("Company finder error:", errorMessage);
    console.error("Full error:", JSON.stringify(error, Object.getOwnPropertyNames(error)));

    return NextResponse.json(
      { error: errorMessage || "Internal server error" },
      { status: 500 }
    );
  }
}
