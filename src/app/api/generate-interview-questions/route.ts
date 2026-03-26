import { getOpenAIClient, MODELS } from "@/lib/openai-client";
import { NextRequest, NextResponse } from "next/server";
import {
  SYSTEM_PROMPT,
  generateQuestionsPrompt,
} from "@/lib/prompts/generate-questions";
import { logger } from "@/lib/logger";
import { ApiUsageService } from "@/services/api-usage.service";
import { verifyToken, getUserById } from "@/lib/auth";

export const maxDuration = 60;

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

  logger.info("generate-interview-questions request received");

  let body: any;
  try {
    body = await req.json();
  } catch (error) {
    logger.error("Invalid JSON body for generate-interview-questions", { error });
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const openai = getOpenAIClient();

  try {
    const baseCompletion = await openai.chat.completions.create({
      model: MODELS.GPT5_MINI,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: generateQuestionsPrompt(body) },
      ],
      response_format: { type: "json_object" },
    });

    const basePromptOutput = baseCompletion.choices[0] || {};
    const content = basePromptOutput.message?.content;

    const usage = baseCompletion.usage;
    if (usage) {
      ApiUsageService.saveOpenAIUsage({
        userId: auth.userId,
        interviewId: body.interviewId,
        organizationId: auth.organizationId,
        category: "interview_creation",
        inputTokens: usage.prompt_tokens,
        outputTokens: usage.completion_tokens,
        totalTokens: usage.total_tokens,
        model: MODELS.GPT5_MINI,
        metadata: {
          questionCount: body.numberOfQuestions,
          jobRole: body.interviewName,
        },
      }).catch((err) => {
        logger.error("Failed to save API usage for question generation", { error: err });
      });
    }

    logger.info("Interview questions generated successfully", {
      inputTokens: usage?.prompt_tokens,
      outputTokens: usage?.completion_tokens,
    });

    return NextResponse.json({ response: content }, { status: 200 });
  } catch (error: any) {
    logger.error("Error generating interview questions", { error: error?.message || error });

    const message =
      process.env.NODE_ENV === "development"
        ? error?.message || "internal server error"
        : "internal server error";

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
