import { getOpenAIClient, MODELS } from "@/lib/openai-client";
import { NextRequest, NextResponse } from "next/server";
import { ResponseService } from "@/services/responses.service";
import { InterviewService } from "@/services/interviews.service";
import { ApiUsageService } from "@/services/api-usage.service";
import {
  SYSTEM_PROMPT,
  createUserPrompt,
} from "@/lib/prompts/generate-insights";
import { logger } from "@/lib/logger";
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

  logger.info("generate-insights request received");
  const body = await req.json();

  const responses = await ResponseService.getAllResponses(body.interviewId);
  const interview = await InterviewService.getInterviewById(body.interviewId);

  let callSummaries = "";
  if (responses) {
    responses.forEach((response) => {
      callSummaries += response.details?.call_analysis?.call_summary;
    });
  }

  const openai = getOpenAIClient();

  try {
    const prompt = createUserPrompt(
      callSummaries,
      interview.name,
      interview.objective,
      interview.description,
    );

    const baseCompletion = await openai.chat.completions.create({
      model: MODELS.GPT5_MINI,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: prompt },
      ],
      response_format: { type: "json_object" },
    });

    const basePromptOutput = baseCompletion.choices[0] || {};
    const content = basePromptOutput.message?.content || "";
    const insightsResponse = JSON.parse(content);

    await InterviewService.updateInterview(
      { insights: insightsResponse.insights },
      body.interviewId,
    );

    // Cost tracking uses DB-sourced org/user from the interview record (most reliable)
    const usage = baseCompletion.usage;
    if (usage) {
      ApiUsageService.saveOpenAIUsage({
        interviewId: body.interviewId,
        organizationId: interview.organization_id || auth.organizationId,
        userId: interview.user_id || auth.userId,
        category: "insights",
        inputTokens: usage.prompt_tokens,
        outputTokens: usage.completion_tokens,
        totalTokens: usage.total_tokens,
        model: MODELS.GPT5_MINI,
        metadata: {
          responseCount: responses?.length || 0,
          interviewName: interview.name,
        },
      }).catch((err) => {
        logger.error("Failed to save API usage for insights generation", { error: err });
      });
    }

    logger.info("Insights generated successfully", {
      inputTokens: usage?.prompt_tokens,
      outputTokens: usage?.completion_tokens,
    });

    return NextResponse.json({ response: content }, { status: 200 });
  } catch (error) {
    logger.error("Error generating insights");
    return NextResponse.json({ error: "internal server error" }, { status: 500 });
  }
}
