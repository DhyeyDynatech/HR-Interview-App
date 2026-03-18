import { getOpenAIClient, MODELS } from "@/lib/openai-client";
import { NextResponse } from "next/server";
import {
  SYSTEM_PROMPT,
  generateQuestionsPrompt,
} from "@/lib/prompts/generate-questions";
import { logger } from "@/lib/logger";
import { ApiUsageService } from "@/services/api-usage.service";

export const maxDuration = 60;

export async function POST(req: Request, res: Response) {
  logger.info("generate-interview-questions request received");

  let body: any;
  try {
    body = await req.json();
  } catch (error) {
    logger.error("Invalid JSON body for generate-interview-questions", {
      error,
    });
    return NextResponse.json(
      { error: "Invalid request body" },
      { status: 400 },
    );
  }

  const openai = getOpenAIClient();

  try {
    const baseCompletion = await openai.chat.completions.create({
      model: MODELS.GPT5_MINI,
      messages: [
        {
          role: "system",
          content: SYSTEM_PROMPT,
        },
        {
          role: "user",
          content: generateQuestionsPrompt(body),
        },
      ],
      response_format: { type: "json_object" },
    });

    const basePromptOutput = baseCompletion.choices[0] || {};
    const content = basePromptOutput.message?.content;

    // Track API usage with real token counts
    const usage = baseCompletion.usage;
    if (usage) {
      ApiUsageService.saveOpenAIUsage({
        userId: body.userId,
        interviewId: body.interviewId,
        organizationId: body.organizationId,
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

    return NextResponse.json(
      {
        response: content,
      },
      { status: 200 },
    );
  } catch (error: any) {
    logger.error("Error generating interview questions", {
      error: error?.message || error,
    });

    const message =
      process.env.NODE_ENV === "development"
        ? error?.message || "internal server error"
        : "internal server error";

    return NextResponse.json(
      { error: message },
      { status: 500 },
    );
  }
}
