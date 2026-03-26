import { getOpenAIClient, MODELS } from "@/lib/openai-client";
import { NextRequest, NextResponse } from "next/server";
import {
  ATS_SYSTEM_PROMPT,
  generateATSScoringPrompt,
} from "@/lib/prompts/ats-scoring";
import { logger } from "@/lib/logger";
import { ApiUsageService } from "@/services/api-usage.service";
import { ATSAnalysisRequest, ATSAnalysisResponse } from "@/types/ats-scoring";
import { verifyToken, getUserById } from "@/lib/auth";

export const maxDuration = 300;

const MAX_RESUMES_PER_REQUEST = 10;
const MAX_JD_LENGTH = 50_000; // ~50K chars
const MAX_RESUME_TEXT_LENGTH = 100_000; // ~100K chars per resume
const OPENAI_TIMEOUT_MS = 240_000; // 4 minutes

async function extractAuth(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) return null;
  const token = authHeader.substring(7);
  const { valid, userId } = verifyToken(token);
  if (!valid || !userId) return null;
  const user = await getUserById(userId);
  if (!user || !user.organization_id) return null;
  return { userId, organizationId: user.organization_id };
}

export async function POST(req: NextRequest) {
  const auth = await extractAuth(req);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  logger.info("ats-scoring request received");

  let body: ATSAnalysisRequest;
  try {
    body = await req.json();
  } catch (error) {
    logger.error("Invalid JSON body for ats-scoring", { error });
    return NextResponse.json(
      { error: "Invalid request body" },
      { status: 400 }
    );
  }

  if (!body.jobDescription || !body.jobDescription.trim()) {
    return NextResponse.json(
      { error: "Job description is required" },
      { status: 400 }
    );
  }

  if (body.jobDescription.length > MAX_JD_LENGTH) {
    return NextResponse.json(
      { error: `Job description exceeds maximum length of ${MAX_JD_LENGTH} characters` },
      { status: 400 }
    );
  }

  if (!body.resumes || body.resumes.length === 0) {
    return NextResponse.json(
      { error: "At least one resume is required" },
      { status: 400 }
    );
  }

  if (body.resumes.length > MAX_RESUMES_PER_REQUEST) {
    return NextResponse.json(
      { error: `Maximum ${MAX_RESUMES_PER_REQUEST} resumes per request` },
      { status: 400 }
    );
  }

  // Truncate oversized resume texts to prevent token explosion
  const resumes = body.resumes.map((r) => ({
    ...r,
    text: r.text.slice(0, MAX_RESUME_TEXT_LENGTH),
  }));

  if (!process.env.AZURE_OPENAI_API_KEY) {
    logger.error("AZURE_OPENAI_API_KEY is not set");
    return NextResponse.json(
      { error: "Azure OpenAI API key is not configured on the server" },
      { status: 500 }
    );
  }

  const openai = getOpenAIClient();

  try {
    const prompt = generateATSScoringPrompt({
      jobDescription: body.jobDescription,
      resumes,
    });

    // Hard abort after timeout to prevent hanging requests
    const abortController = new AbortController();
    const abortTimer = setTimeout(() => abortController.abort(), OPENAI_TIMEOUT_MS);

    let completion;
    try {
      completion = await openai.chat.completions.create(
        {
          model: MODELS.GPT5_MINI,
          max_completion_tokens: 65536,
          messages: [
            {
              role: "system",
              content: ATS_SYSTEM_PROMPT,
            },
            {
              role: "user",
              content: prompt,
            },
          ],
        } as any,
        { signal: abortController.signal }
      );
    } finally {
      clearTimeout(abortTimer);
    }

    const raw = completion.choices[0]?.message?.content || "{}";
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    let parsed: ATSAnalysisResponse = { results: [] };
    if (jsonMatch) {
      let jsonStr = jsonMatch[0];
      try {
        parsed = JSON.parse(jsonStr);
      } catch {
        // Model may return truncated JSON — attempt to repair by closing open structures
        // Strip trailing commas before } or ]
        jsonStr = jsonStr.replace(/,\s*([\]}])/g, "$1");
        // Try to close unclosed arrays/brackets
        const openBraces = (jsonStr.match(/\{/g) || []).length;
        const closeBraces = (jsonStr.match(/\}/g) || []).length;
        const openBrackets = (jsonStr.match(/\[/g) || []).length;
        const closeBrackets = (jsonStr.match(/\]/g) || []).length;
        jsonStr += "]".repeat(Math.max(0, openBrackets - closeBrackets));
        jsonStr += "}".repeat(Math.max(0, openBraces - closeBraces));
        try {
          parsed = JSON.parse(jsonStr);
          logger.warn("ATS scoring: repaired truncated JSON successfully");
        } catch (repairErr) {
          logger.error("ATS scoring: JSON repair failed, returning partial results", { error: repairErr });
        }
      }
    }

    // Sort results by overall score (highest first)
    parsed.results.sort((a, b) => b.overallScore - a.overallScore);

    // Track API usage
    const usage = completion.usage;
    if (usage) {
      ApiUsageService.saveOpenAIUsage({
        userId: auth.userId,
        organizationId: auth.organizationId,
        interviewId: body.interviewId,
        category: "ats_scoring",
        inputTokens: usage.prompt_tokens,
        outputTokens: usage.completion_tokens,
        totalTokens: usage.total_tokens,
        model: MODELS.GPT5_MINI,
        metadata: {
          resumeCount: resumes.length,
          resumeNames: resumes.map((r) => r.name),
        },
      }).catch((err) => {
        logger.error("Failed to save API usage for ATS scoring", {
          error: err,
        });
      });
    }

    logger.info("ATS scoring completed successfully", {
      resumeCount: resumes.length,
      inputTokens: usage?.prompt_tokens,
      outputTokens: usage?.completion_tokens,
    });

    return NextResponse.json(parsed, { status: 200 });
  } catch (error: any) {
    logger.error("ATS scoring error", { error: error?.message || String(error) });

    return NextResponse.json(
      { error: "ATS analysis failed. Please try again." },
      { status: 500 }
    );
  }
}
