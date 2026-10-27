import { AiError, AiProvider, AiTier, timeoutFor } from "./types";
import { parseJson, postJson } from "./http";

// OpenAI API (https://platform.openai.com/api-keys).
// OPENAI_API_KEY, and optionally OPENAI_MODEL (fast) and OPENAI_TOPIC_MODEL (strong).

const DEFAULT_FAST_MODEL = "gpt-5-mini";
const DEFAULT_STRONG_MODEL = "gpt-5";

const model = (tier: AiTier): string =>
  tier === "strong"
    ? process.env.OPENAI_TOPIC_MODEL || DEFAULT_STRONG_MODEL
    : process.env.OPENAI_MODEL || DEFAULT_FAST_MODEL;

export const openaiProvider: AiProvider = {
  name: "openai",
  keyEnv: "OPENAI_API_KEY",
  isConfigured: () => Boolean(process.env.OPENAI_API_KEY),
  model,
  async requestJson(request) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new AiError("not_configured");

    const data = await postJson(
      "OpenAI",
      "https://api.openai.com/v1/chat/completions",
      {
        model: model(request.tier),
        // Reasoning models spend part of this on thinking.
        max_completion_tokens: 16000,
        messages: [
          { role: "system", content: request.system },
          { role: "user", content: request.content },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: request.name,
            description: request.description,
            schema: request.schema,
            strict: true,
          },
        },
      },
      {
        headers: { Authorization: `Bearer ${apiKey}` },
        timeout: timeoutFor(request.tier),
      },
      undefined,
      // No credit left on the account: 429 with code insufficient_quota (not a rate limit).
      (status, body) => status === 429 && body?.error?.code === "insufficient_quota"
    );

    const choice = data?.choices?.[0];
    if (choice?.message?.refusal) throw new AiError("refused");
    if (choice?.finish_reason === "content_filter") throw new AiError("refused");
    return parseJson("OpenAI", choice?.message?.content, choice?.finish_reason);
  },
};
