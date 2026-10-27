import { AiError, AiProvider, JsonRequest } from "./types";
import { claudeProvider } from "./claude";
import { openaiProvider } from "./openai";
import { geminiProvider } from "./gemini";

export * from "./types";

// Picks the AI provider from the environment. AI_PROVIDER names one (claude, openai or
// gemini); when it is empty, the first provider in this list whose key is set is used.
// To add a provider, implement AiProvider in its own file and list it here.

const PROVIDERS: AiProvider[] = [claudeProvider, openaiProvider, geminiProvider];

const ALIASES: Record<string, string> = {
  anthropic: "claude",
  chatgpt: "openai",
  gpt: "openai",
  google: "gemini",
};

let warnedAbout = "";

export function activeProvider(): AiProvider | null {
  const chosen = (process.env.AI_PROVIDER || "").trim().toLowerCase();
  if (!chosen) return PROVIDERS.find((provider) => provider.isConfigured()) || null;

  const name = ALIASES[chosen] || chosen;
  const provider = PROVIDERS.find((p) => p.name === name) || null;
  if (warnedAbout !== chosen) {
    warnedAbout = chosen;
    if (!provider) {
      console.error(
        `AI_PROVIDER="${chosen}" is not supported; use one of ${PROVIDERS.map((p) => p.name).join(", ")}`
      );
    } else if (!provider.isConfigured()) {
      console.error(`AI_PROVIDER is "${provider.name}" but ${provider.keyEnv} is not set`);
    }
  }
  return provider;
}

export const isAiConfigured = (): boolean => Boolean(activeProvider()?.isConfigured());

/** One request to the configured provider that must answer with JSON matching the schema. */
export async function requestJson(request: JsonRequest): Promise<any> {
  const provider = activeProvider();
  if (!provider?.isConfigured()) throw new AiError("not_configured");
  return provider.requestJson(request);
}
