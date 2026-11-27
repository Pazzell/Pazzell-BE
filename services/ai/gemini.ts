import { AiError, AiProvider, AiTier, timeoutFor } from "./types";
import { parseJson, postJson } from "./http";

// Google Gemini API (https://aistudio.google.com/apikey).
// GEMINI_API_KEY, and optionally GEMINI_MODEL (fast) and GEMINI_TOPIC_MODEL (strong).

const DEFAULT_FAST_MODEL = "gemini-2.5-flash";
const DEFAULT_STRONG_MODEL = "gemini-2.5-pro";

const BLOCKED = new Set(["SAFETY", "PROHIBITED_CONTENT", "BLOCKLIST", "SPII", "RECITATION"]);

const model = (tier: AiTier): string =>
  tier === "strong"
    ? process.env.GEMINI_TOPIC_MODEL || DEFAULT_STRONG_MODEL
    : process.env.GEMINI_MODEL || DEFAULT_FAST_MODEL;

export const geminiProvider: AiProvider = {
  name: "gemini",
  keyEnv: "GEMINI_API_KEY",
  isConfigured: () => Boolean(process.env.GEMINI_API_KEY),
  model,
  async requestJson(request) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new AiError("not_configured");

    const data = await postJson(
      "Gemini",
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
        model(request.tier)
      )}:generateContent`,
      {
        systemInstruction: { parts: [{ text: request.system }] },
        contents: [{ role: "user", parts: [{ text: request.content }] }],
        generationConfig: {
          maxOutputTokens: 16000,
          responseMimeType: "application/json",
          responseJsonSchema: request.schema,
        },
      },
      {
        headers: { "x-goog-api-key": apiKey },
        timeout: timeoutFor(request.tier),
      },
      // An unknown key answers 400 with reason API_KEY_INVALID.
      (status, body) =>
        status === 401 || status === 403 || JSON.stringify(body || "").includes("API_KEY_INVALID")
    );

    if (data?.promptFeedback?.blockReason) throw new AiError("refused");
    const candidate = data?.candidates?.[0];
    if (BLOCKED.has(candidate?.finishReason)) throw new AiError("refused");
    const text = (candidate?.content?.parts || [])
      .filter((part: any) => !part.thought && typeof part.text === "string")
      .map((part: any) => part.text)
      .join("");
    return parseJson("Gemini", text, candidate?.finishReason);
  },
};
