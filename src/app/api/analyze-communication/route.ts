import { getOpenAIClient, MODELS } from "@/lib/openai-client";
import { NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { ApiUsageService } from "@/services/api-usage.service";
import {
  SYSTEM_PROMPT,
  getCommunicationAnalysisPrompt,
} from "@/lib/prompts/communication-analysis";

export async function POST(req: Request) {
  logger.info("analyze-communication request received");

  try {
    const body = await req.json();
    const { transcript } = body;

    if (!transcript) {

      return NextResponse.json(
        { error: "Transcript is required" },
        { status: 400 },
      );
    }

    const openai = getOpenAIClient();

    const completion = await openai.chat.completions.create({
      model: MODELS.GPT5_MINI,
      messages: [
        {
          role: "system",
          content: SYSTEM_PROMPT,
        },
        {
          role: "user",
          content: getCommunicationAnalysisPrompt(transcript),
        },
      ],
      response_format: { type: "json_object" },
    });

    const analysis = completion.choices[0]?.message?.content;

    // Track API usage with real token counts
    const usage = completion.usage;
    if (usage && body.interviewId) {
      ApiUsageService.saveOpenAIUsage({
        interviewId: body.interviewId,
        responseId: body.responseId,
        organizationId: body.organizationId,
        userId: body.userId,
        category: "communication_analysis",
        inputTokens: usage.prompt_tokens,
        outputTokens: usage.completion_tokens,
        totalTokens: usage.total_tokens,
        model: MODELS.GPT5_MINI,
        requestId: body.callId,
      }).catch((err) => {
        logger.error("Failed to save API usage for communication analysis", { error: err });
      });
    }

    logger.info("Communication analysis completed successfully", {
      inputTokens: usage?.prompt_tokens,
      outputTokens: usage?.completion_tokens,
    });

    return NextResponse.json(
      { analysis: JSON.parse(analysis || "{}") },
      { status: 200 },
    );
  } catch (error) {
    logger.error("Error analyzing communication skills");


    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
