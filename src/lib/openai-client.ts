import { AzureOpenAI, OpenAI } from "openai";

/**
 * Returns a configured AzureOpenAI client.
 * Called per-request in serverless routes (stateless, no shared singleton).
 */
export function getOpenAIClient(): AzureOpenAI {
  const apiKey = process.env.AZURE_OPENAI_API_KEY;
  const endpoint = process.env.AZURE_OPENAI_ENDPOINT;
  const apiVersion = process.env.AZURE_OPENAI_API_VERSION || "2025-01-01-preview";

  if (!apiKey) throw new Error("AZURE_OPENAI_API_KEY is not set");
  if (!endpoint) throw new Error("AZURE_OPENAI_ENDPOINT is not set");

  return new AzureOpenAI({ apiKey, endpoint, apiVersion, maxRetries: 5 });
}

/**
 * Returns a real OpenAI client (non-Azure).
 * Use ONLY for features not supported by Azure OpenAI — e.g. the Responses API
 * with the web_search tool used by the company-finder enrichment step.
 */
export function getOpenAIClientDirect(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not set");
  return new OpenAI({ apiKey, maxRetries: 3 });
}

/**
 * Azure deployment name — set AZURE_OPENAI_DEPLOYMENT_GPT5_MINI in .env
 * to match the deployment name you created in Azure AI Foundry.
 */
export const MODELS = {
  GPT5_MINI: process.env.AZURE_OPENAI_DEPLOYMENT_GPT5_MINI || "gpt-5-mini-2",
  // Alias so callers that previously used GPT5 also route to the same deployment
  GPT5:      process.env.AZURE_OPENAI_DEPLOYMENT_GPT5_MINI || "gpt-5-mini-2",
};

/**
 * Real OpenAI model names (for use with getOpenAIClientDirect).
 * These are the official model IDs, not Azure deployment names.
 */
export const DIRECT_MODELS = {
  GPT5_MINI: "gpt-5-mini",
};
