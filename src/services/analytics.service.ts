"use server";

import { getOpenAIClient, MODELS } from "@/lib/openai-client";
import { ResponseService } from "@/services/responses.service";
import { InterviewService } from "@/services/interviews.service";
import { ApiUsageService } from "@/services/api-usage.service";
import { getUserById } from "@/lib/auth";
import { Question } from "@/types/interview";
import { Analytics } from "@/types/response";
import {
  getInterviewAnalyticsPrompt,
  SYSTEM_PROMPT,
} from "@/lib/prompts/analytics";

// Hard ceiling on the analytics OpenAI call so a stalled request can never hang
// the caller (recruiter response view, voice-live/save-call, dashboard poll)
// indefinitely. Configurable via env — mirrors the OPENAI_TIMEOUT_MS pattern
// used by the ATS-scoring and company-finder routes. Falls back to 2 minutes.
const ANALYTICS_OPENAI_TIMEOUT_MS =
  Number(process.env.OPENAI_ANALYTICS_TIMEOUT_MS) || 120_000;

export const generateInterviewAnalytics = async (payload: {
  callId: string;
  interviewId: string;
  transcript: string;
}) => {
  const { callId, interviewId, transcript } = payload;

  try {
    const response = await ResponseService.getResponseByCallId(callId);
    const interview = await InterviewService.getInterviewById(interviewId);

    if (!response) {
      throw new Error("Response not found");
    }

    if (!interview) {
      throw new Error("Interview not found");
    }

    if (response.analytics) {
      return { analytics: response.analytics as Analytics, status: 200 };
    }

    const interviewTranscript = transcript || response.details?.transcript;
    const questions = interview?.questions || [];
    const mainInterviewQuestions = questions
      .map((q: Question, index: number) => `${index + 1}. ${q.question}`)
      .join("\n");

    const openai = getOpenAIClient();

    const prompt = getInterviewAnalyticsPrompt(
      interviewTranscript,
      mainInterviewQuestions,
    );

    // Hard abort after the timeout so a stalled Azure request fails fast
    // instead of hanging every caller. The OpenAI SDK's own retries (maxRetries)
    // are per-attempt; this signal bounds total wall-clock.
    const abortController = new AbortController();
    const abortTimer = setTimeout(
      () => abortController.abort(),
      ANALYTICS_OPENAI_TIMEOUT_MS,
    );

    let baseCompletion;
    try {
      baseCompletion = await openai.chat.completions.create(
        {
          model: MODELS.GPT5_MINI,
          messages: [
            {
              role: "system",
              content: SYSTEM_PROMPT,
            },
            {
              role: "user",
              content: prompt,
            },
          ],
          response_format: { type: "json_object" },
        },
        { signal: abortController.signal },
      );
    } finally {
      clearTimeout(abortTimer);
    }

    const basePromptOutput = baseCompletion.choices[0] || {};
    const content = basePromptOutput.message?.content || "";
    const analyticsResponse = JSON.parse(content);

    analyticsResponse.mainInterviewQuestions = questions.map(
      (q: Question) => q.question,
    );

    // Track API usage with real token counts
    const usage = baseCompletion.usage;
    if (usage) {
      // Resolve organizationId — fallback to user lookup if interview has NULL org_id
      let orgId = interview.organization_id;
      if (!orgId && interview.user_id) {
        try {
          const userRec = await getUserById(interview.user_id);
          orgId = userRec?.organization_id || undefined;
        } catch {
          /* best effort */
        }
      }

      ApiUsageService.saveOpenAIUsage({
        interviewId: interviewId,
        responseId: response.id,
        organizationId: orgId,
        userId: interview.user_id,
        category: "interview_response",
        inputTokens: usage.prompt_tokens,
        outputTokens: usage.completion_tokens,
        totalTokens: usage.total_tokens,
        model: MODELS.GPT5_MINI,
        requestId: callId,
        metadata: {
          candidateName: response.name,
          candidateEmail: response.email,
        },
      }).catch((err) => {
        console.error(
          "Failed to save API usage for analytics generation:",
          err,
        );
      });
    }

    return { analytics: analyticsResponse, status: 200 };
  } catch (error) {
    console.error("Error in OpenAI request:", error);

    return { error: "internal server error", status: 500 };
  }
};
