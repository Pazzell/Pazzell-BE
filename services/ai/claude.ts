import Anthropic from "@anthropic-ai/sdk";
import { AiError, AiProvider, AiTier, JsonRequest, timeoutFor } from "./types";

// Claude API (https://console.anthropic.com).
// ANTHROPIC_API_KEY, and optionally ANTHROPIC_MODEL (fast) and ANTHROPIC_TOPIC_MODEL (strong).

const DEFAULT_FAST_MODEL = "claude-haiku-4-5-20251001";
const DEFAULT_STRONG_MODEL = "claude-opus-5-5";

const model = (tier: AiTier): string =>
  tier === "strong"
    ? process.env.ANTHROPIC_TOPIC_MODEL || DEFAULT_STRONG_MODEL
    : process.env.ANTHROPIC_MODEL || DEFAULT_FAST_MODEL;

function failed(e: any): AiError {
  if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) {
    console.error("Claude API rejected the configured ANTHROPIC_API_KEY:", e.message);
    return new AiError("not_configured");
  }
  console.error("Claude API request failed:", e?.status || "", e?.message);
  return new AiError("unavailable");
}

// The fast model answers through a forced tool call, which every Claude model supports.
async function viaTool(client: Anthropic, request: JsonRequest) {
  let response: Anthropic.Message;
  try {
    response = await client.messages.create({
      model: model(request.tier),
      max_tokens: 8192,
      system: request.system,
      tools: [
        {
          name: request.name,
          description: request.description,
          input_schema: request.schema as Anthropic.Tool.InputSchema,
        },
      ],
      tool_choice: { type: "tool", name: request.name },
      messages: [{ role: "user", content: request.content }],
    });
  } catch (e) {
    throw failed(e);
  }
  if (response.stop_reason === "refusal") throw new AiError("refused");
  const block = response.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === "tool_use" && b.name === request.name
  );
  if (!block) {
    console.error("Claude API returned no tool call; stop_reason:", response.stop_reason);
    throw new AiError("unavailable");
  }
  return block.input;
}

// The strong model answers with structured output, thinking at medium effort.
async function viaStructuredOutput(client: Anthropic, request: JsonRequest) {
  const chosen = model(request.tier);
  let response: Anthropic.Beta.BetaMessage;
  try {
    response = await client.beta.messages.create({
      model: chosen,
      max_tokens: 16000,
      system: request.system,
      output_config: { effort: "medium", format: { type: "json_schema", schema: request.schema } },
      // If a safety classifier declines the request, the API re-runs it on the model it
      // picks for that case. Only the default model is known to accept the parameter.
      ...(chosen === DEFAULT_STRONG_MODEL
        ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const }
        : {}),
      messages: [{ role: "user", content: request.content }],
    });
  } catch (e) {
    throw failed(e);
  }
  if (response.stop_reason === "refusal") throw new AiError("refused");
  const text = response.content.find((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text");
  try {
    return JSON.parse(text?.text || "");
  } catch {
    // Cut off at max_tokens, or no text at all.
    console.error("Claude API returned no usable JSON; stop_reason:", response.stop_reason);
    throw new AiError("unavailable");
  }
}

export const claudeProvider: AiProvider = {
  name: "claude",
  keyEnv: "ANTHROPIC_API_KEY",
  isConfigured: () => Boolean(process.env.ANTHROPIC_API_KEY),
  model,
  async requestJson(request) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new AiError("not_configured");
    const client = new Anthropic({ apiKey, maxRetries: 2, timeout: timeoutFor(request.tier) });
    return request.tier === "strong"
      ? viaStructuredOutput(client, request)
      : viaTool(client, request);
  },
};
