import { getOpenAIClient, MODELS } from "@/lib/openai-client";
import { NextRequest, NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { ApiUsageService } from "@/services/api-usage.service";
import {
  SYSTEM_PROMPT,
  getCommunicationAnalysisPrompt,
} from "@/lib/prompts/communication-analysis";
import { verifyToken, getUserById } from "@/lib/auth";

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

  logger.info("analyze-communication request received");

  try {
    const body = await req.json();
    const { transcript } = body;

    if (!transcript) {
      return NextResponse.json({ error: "Transcript is required" }, { status: 400 });
    }

    const openai = getOpenAIClient();

    const completion = await openai.chat.completions.create({
      model: MODELS.GPT5_MINI,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: getCommunicationAnalysisPrompt(transcript) },
      ],
      response_format: { type: "json_object" },
    });

    const analysis = completion.choices[0]?.message?.content;

    const usage = completion.usage;
    if (usage && body.interviewId) {
      ApiUsageService.saveOpenAIUsage({
        interviewId: body.interviewId,
        responseId: body.responseId,
        organizationId: auth.organizationId,
        userId: auth.userId,
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

    return NextResponse.json({ analysis: JSON.parse(analysis || "{}") }, { status: 200 });
  } catch (error) {
    logger.error("Error analyzing communication skills");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
