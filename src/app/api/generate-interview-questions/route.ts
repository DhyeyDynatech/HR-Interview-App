import { NextRequest, NextResponse } from "next/server";
import {
  SYSTEM_PROMPT,
  generateQuestionsPrompt,
} from "@/lib/prompts/generate-questions";
import { logger } from "@/lib/logger";
import { ApiUsageService } from "@/services/api-usage.service";
import { verifyToken } from "@/lib/auth";

export const maxDuration = 60;

function extractAuth(request: NextRequest): { userId: string } | null {
  const authHeader = request.headers.get("authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) return null;
  const token = authHeader.substring(7);
  const { valid, userId } = verifyToken(token);
  if (!valid || !userId) return null;
  return { userId };
}

export async function POST(req: NextRequest) {
  const auth = extractAuth(req);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch (error) {
    logger.error("Invalid JSON body for generate-interview-questions");
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const organizationId = body.organizationId as string | undefined;
  if (!organizationId) {
    return NextResponse.json({ error: "organizationId is required" }, { status: 400 });
  }

  const apiKey    = process.env.AZURE_OPENAI_API_KEY?.trim() ?? "";
  const endpoint  = process.env.AZURE_OPENAI_ENDPOINT?.trim().replace(/\/$/, "") ?? "";
  const apiVersion = process.env.AZURE_OPENAI_API_VERSION?.trim() ?? "2024-12-01-preview";
  const deployment = process.env.AZURE_OPENAI_DEPLOYMENT_GPT5_MINI?.trim() ?? "gpt-5-mini-2";

  const url = `${endpoint}/openai/deployments/${deployment}/chat/completions?api-version=${apiVersion}`;

  logger.info("generate-interview-questions request received");

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "api-key": apiKey,
      },
      body: JSON.stringify({
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: generateQuestionsPrompt(body) },
        ],
        max_completion_tokens: 4096,
        response_format: { type: "json_object" },
      }),
    });

    const data = await res.json();

    if (!res.ok) {
      logger.error("Azure OpenAI error", {
        status: res.status,
        code: data?.error?.code,
        message: data?.error?.message,
      });
      return NextResponse.json({ error: data?.error?.message || "Azure OpenAI error" }, { status: 500 });
    }

    const content = data.choices?.[0]?.message?.content ?? null;
    const usage   = data.usage;

    if (usage) {
      ApiUsageService.saveOpenAIUsage({
        userId: auth.userId,
        interviewId: body.interviewId,
        organizationId,
        category: "interview_creation",
        inputTokens: usage.prompt_tokens,
        outputTokens: usage.completion_tokens,
        totalTokens: usage.total_tokens,
        model: deployment,
        metadata: {
          questionCount: body.numberOfQuestions,
          jobRole: body.interviewName,
        },
      }).catch((err) => {
        logger.error("Failed to save API usage for question generation");
      });
    }

    logger.info("Interview questions generated successfully", {
      inputTokens: usage?.prompt_tokens,
      outputTokens: usage?.completion_tokens,
    });

    return NextResponse.json({ response: content }, { status: 200 });
  } catch (error: any) {
    logger.error("Error generating interview questions", {
      message: error?.message,
      stack: error?.stack?.split("\n")[0],
    });

    return NextResponse.json({ error: "internal server error" }, { status: 500 });
  }
}
