import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogle } from "@ai-sdk/google";
import { createGroq } from "@ai-sdk/groq";
import type { LanguageModel } from "ai";
import { API_KEY_ENV, modelFor, type AiProvider } from "./config";

/**
 * The language model for a provider. Keys are read here (server code only)
 * and only the active provider's key is required.
 */
export function getModel(provider: AiProvider, env: Record<string, string | undefined> = process.env): {
  model: LanguageModel;
  modelId: string;
} {
  const apiKey = env[API_KEY_ENV[provider]]?.trim();
  if (!apiKey) throw new Error(`${API_KEY_ENV[provider]} is not set (AI_PROVIDER=${provider})`);
  const modelId = modelFor(provider, env);
  switch (provider) {
    case "google":
      return { model: createGoogle({ apiKey })(modelId), modelId };
    case "anthropic":
      return { model: createAnthropic({ apiKey })(modelId), modelId };
    case "groq":
      return { model: createGroq({ apiKey })(modelId), modelId };
  }
}
