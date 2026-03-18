import { getOpenAIClient, MODELS } from "@/lib/openai-client";
import { NextResponse } from "next/server";
import {
  EXTRACTION_ONLY_SYSTEM_PROMPT,
  generateExtractionOnlyPrompt,
} from "@/lib/prompts/company-finder";
import { logger } from "@/lib/logger";
import { ApiUsageService } from "@/services/api-usage.service";

export const maxDuration = 300; // max Vercel timeout 

const MAX_RESUMES_PER_REQUEST = 10;
const MAX_RESUME_TEXT_LENGTH = 100_000;
const OPENAI_TIMEOUT_MS = 240_000; // 4 minutes timeout
const EXTRACT_MODEL = MODELS.GPT5_MINI;

export async function POST(req: Request) {
  logger.info("company-finder/extract request received");

  let body: {
    resumes: { name: string; text: string }[];
    userId?: string;
    organizationId?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  if (!body.resumes || body.resumes.length === 0) {
    return NextResponse.json({ error: "At least one resume is required" }, { status: 400 });
  }

  if (body.resumes.length > MAX_RESUMES_PER_REQUEST) {
    return NextResponse.json(
      { error: `Maximum ${MAX_RESUMES_PER_REQUEST} resumes per request` },
      { status: 400 }
    );
  }

  const resumes = body.resumes.map((r) => ({
    ...r,
    text: r.text.slice(0, MAX_RESUME_TEXT_LENGTH),
  }));

  if (!process.env.AZURE_OPENAI_API_KEY) {
    return NextResponse.json({ error: "Azure OpenAI API key is not configured" }, { status: 500 });
  }

  const openai = getOpenAIClient();

  try {
    const prompt = generateExtractionOnlyPrompt({ resumes });

    const abortController = new AbortController();
    const abortTimer = setTimeout(() => abortController.abort(), OPENAI_TIMEOUT_MS);

    let completion;
    try {
      completion = await openai.chat.completions.create(
        {
          model: EXTRACT_MODEL,
          max_completion_tokens: 16384,
          messages: [
            { role: "system", content: EXTRACTION_ONLY_SYSTEM_PROMPT },
            { role: "user", content: prompt },
          ],
        } as any,
        { signal: abortController.signal }
      );
    } finally {
      clearTimeout(abortTimer);
    }

    const raw = completion.choices[0]?.message?.content || "{}";
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    let parsed: { companies: { companyName: string; resumeName: string; context: string }[] } = {
      companies: [],
    };
    if (jsonMatch) {
      let jsonStr = jsonMatch[0];
      try {
        parsed = JSON.parse(jsonStr);
      } catch {
        jsonStr = jsonStr.replace(/,\s*([\]}])/g, "$1");
        const openBraces = (jsonStr.match(/\{/g) || []).length;
        const closeBraces = (jsonStr.match(/\}/g) || []).length;
        const openBrackets = (jsonStr.match(/\[/g) || []).length;
        const closeBrackets = (jsonStr.match(/\]/g) || []).length;
        jsonStr += "]".repeat(Math.max(0, openBrackets - closeBrackets));
        jsonStr += "}".repeat(Math.max(0, openBraces - closeBraces));
        try {
          parsed = JSON.parse(jsonStr);
        } catch (repairErr) {
          logger.error("Extract: JSON repair failed", { error: repairErr });
        }
      }
    }

    const usage = completion.usage;
    ApiUsageService.saveOpenAIUsage({
      userId: body.userId,
      organizationId: body.organizationId,
      category: "company_finder",
      inputTokens: usage?.prompt_tokens || 0,
      outputTokens: usage?.completion_tokens || 0,
      totalTokens: usage?.total_tokens || 0,
      model: EXTRACT_MODEL,
      metadata: { stage: "extraction", resumeCount: resumes.length },
    }).catch((err) => logger.error("Failed to save extract usage", { error: err }));

    logger.info("Extract completed", {
      resumeCount: resumes.length,
      companiesFound: parsed.companies?.length || 0,
    });

    return NextResponse.json({ companies: parsed.companies || [] }, { status: 200 });
  } catch (error: any) {
    const errMsg = error instanceof Error 
      ? error.message 
      : (error?.message || JSON.stringify(error) || String(error));
      
    const isTimeout = errMsg.toLowerCase().includes('abort') || errMsg.toLowerCase().includes('timeout');
    
    logger.error("Extract error", { error: errMsg, isTimeout });
    return NextResponse.json(
      { error: isTimeout ? "Request timed out, your resumes might be too massive. Try fewer resumes." : "Company extraction failed. Please try again." },
      { status: isTimeout ? 504 : 500 }
    );
  }
}
