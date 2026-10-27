import axios from "axios";
import { activeProvider, isAiConfigured, requestJson, JsonRequest } from "../services/ai";
import * as ai from "../services/quizGen/ai";

// The provider is chosen from the environment on every call, so each test sets only the
// variables it needs and the originals (all empty, see tests/env.ts) are put back after.
const KEYS = ["AI_PROVIDER", "ANTHROPIC_API_KEY", "OPENAI_API_KEY", "GEMINI_API_KEY"];

const REQUEST: JsonRequest = {
  name: "save_answers",
  description: "Saves the answers.",
  system: "System prompt",
  content: "User content",
  schema: { type: "object", properties: {}, required: [], additionalProperties: false },
  tier: "strong",
};

describe("AI provider", () => {
  const saved: Record<string, string | undefined> = {};
  let post: jest.SpyInstance;

  beforeEach(() => {
    for (const key of KEYS) saved[key] = process.env[key];
    post = jest.spyOn(axios, "post");
    jest.spyOn(console, "error").mockImplementation(() => undefined);
  });
  afterEach(() => {
    for (const key of KEYS) process.env[key] = saved[key];
    jest.restoreAllMocks();
  });

  describe("choosing", () => {
    it("is unconfigured with no key", () => {
      expect(activeProvider()).toBeNull();
      expect(isAiConfigured()).toBe(false);
    });

    it("uses the first provider whose key is set when AI_PROVIDER is empty", () => {
      process.env.GEMINI_API_KEY = "g";
      expect(activeProvider()?.name).toBe("gemini");
      process.env.OPENAI_API_KEY = "o";
      expect(activeProvider()?.name).toBe("openai");
      process.env.ANTHROPIC_API_KEY = "a";
      expect(activeProvider()?.name).toBe("claude");
    });

    it("uses the provider AI_PROVIDER names, aliases included", () => {
      process.env.ANTHROPIC_API_KEY = "a";
      process.env.GEMINI_API_KEY = "g";
      process.env.AI_PROVIDER = "Google";
      expect(activeProvider()?.name).toBe("gemini");
      process.env.AI_PROVIDER = "anthropic";
      expect(activeProvider()?.name).toBe("claude");
    });

    it("is unconfigured when the named provider has no key, even if another has one", async () => {
      process.env.AI_PROVIDER = "openai";
      process.env.ANTHROPIC_API_KEY = "a";
      expect(isAiConfigured()).toBe(false);
      await expect(requestJson(REQUEST)).rejects.toMatchObject({ kind: "not_configured" });
    });

    it("is unconfigured for an unknown provider", () => {
      process.env.AI_PROVIDER = "mystery";
      process.env.ANTHROPIC_API_KEY = "a";
      expect(isAiConfigured()).toBe(false);
    });
  });

  describe("OpenAI", () => {
    beforeEach(() => {
      process.env.AI_PROVIDER = "openai";
      process.env.OPENAI_API_KEY = "sk-test";
    });

    it("asks for strict JSON and returns the parsed answer", async () => {
      post.mockResolvedValue({
        data: { choices: [{ finish_reason: "stop", message: { content: '{"answers":[]}' } }] },
      });
      await expect(requestJson(REQUEST)).resolves.toEqual({ answers: [] });
      const [url, body, config] = post.mock.calls[0];
      expect(url).toBe("https://api.openai.com/v1/chat/completions");
      expect(body.model).toBe("gpt-5");
      expect(body.messages[0]).toEqual({ role: "system", content: "System prompt" });
      expect(body.response_format.json_schema).toMatchObject({ name: "save_answers", strict: true });
      expect(config.headers.Authorization).toBe("Bearer sk-test");
    });

    it("reports a refusal", async () => {
      post.mockResolvedValue({ data: { choices: [{ message: { refusal: "No." } }] } });
      await expect(requestJson(REQUEST)).rejects.toMatchObject({ kind: "refused" });
    });

    it("treats a rejected key as unconfigured", async () => {
      post.mockRejectedValue({ response: { status: 401, data: { error: "bad key" } } });
      await expect(requestJson(REQUEST)).rejects.toMatchObject({ kind: "not_configured" });
      expect(post).toHaveBeenCalledTimes(1);
    });

    it("retries a server error, then gives up", async () => {
      jest.spyOn(global, "setTimeout").mockImplementation(((fn: () => void) => {
        fn();
        return 0;
      }) as any);
      post.mockRejectedValue({ response: { status: 500, data: {} } });
      await expect(requestJson(REQUEST)).rejects.toMatchObject({ kind: "unavailable" });
      expect(post).toHaveBeenCalledTimes(3);
    });
  });

  describe("Gemini", () => {
    beforeEach(() => {
      process.env.AI_PROVIDER = "gemini";
      process.env.GEMINI_API_KEY = "g-test";
    });

    it("asks for JSON matching the schema and skips thought parts", async () => {
      post.mockResolvedValue({
        data: {
          candidates: [
            {
              finishReason: "STOP",
              content: { parts: [{ thought: true, text: "thinking" }, { text: '{"answers":' }, { text: "[]}" }] },
            },
          ],
        },
      });
      await expect(requestJson({ ...REQUEST, tier: "fast" })).resolves.toEqual({ answers: [] });
      const [url, body, config] = post.mock.calls[0];
      expect(url).toContain("/models/gemini-2.5-flash:generateContent");
      expect(body.generationConfig.responseJsonSchema).toBe(REQUEST.schema);
      expect(body.systemInstruction.parts[0].text).toBe("System prompt");
      expect(config.headers["x-goog-api-key"]).toBe("g-test");
    });

    it("reports a blocked prompt as a refusal", async () => {
      post.mockResolvedValue({ data: { promptFeedback: { blockReason: "SAFETY" } } });
      await expect(requestJson(REQUEST)).rejects.toMatchObject({ kind: "refused" });
    });

    it("treats an invalid key as unconfigured", async () => {
      post.mockRejectedValue({
        response: { status: 400, data: { error: { details: [{ reason: "API_KEY_INVALID" }] } } },
      });
      await expect(requestJson(REQUEST)).rejects.toMatchObject({ kind: "not_configured" });
    });

    it("reports a cut off answer as unavailable", async () => {
      post.mockResolvedValue({
        data: { candidates: [{ finishReason: "MAX_TOKENS", content: { parts: [{ text: '{"answ' }] } }] },
      });
      await expect(requestJson(REQUEST)).rejects.toMatchObject({ kind: "unavailable" });
    });
  });

  describe("trivia requests", () => {
    beforeEach(() => {
      process.env.AI_PROVIDER = "openai";
      process.env.OPENAI_API_KEY = "sk-test";
    });

    const answer = (content: unknown) => ({
      data: { choices: [{ finish_reason: "stop", message: { content: JSON.stringify(content) } }] },
    });

    it("reads cards from a document through any provider", async () => {
      post.mockResolvedValue(
        answer({
          title: " Cells ",
          cards: [{ statement: "Q?", correctAnswer: "A", wrongAnswer: "B", quote: "A is so." }],
        })
      );
      await expect(ai.requestCards("Some document", 1)).resolves.toEqual({
        title: "Cells",
        cards: [{ statement: "Q?", correctAnswer: "A", wrongAnswer: "B", quote: "A is so." }],
      });
      expect(post.mock.calls[0][1].model).toBe("gpt-5-mini");
    });

    it("turns a refused document into no cards", async () => {
      post.mockResolvedValue({ data: { choices: [{ message: { refusal: "No." } }] } });
      await expect(ai.requestCards("Some document", 1)).resolves.toEqual({ title: undefined, cards: [] });
    });

    it("turns a refused topic into PROMPT_REJECTED", async () => {
      post.mockResolvedValue({ data: { choices: [{ message: { refusal: "No." } }] } });
      await expect(ai.requestTopicCards("Topic", "Prompt", 3)).rejects.toMatchObject({
        statusCode: 422,
        code: "PROMPT_REJECTED",
      });
    });

    it("turns a failed request into AI_UNAVAILABLE", async () => {
      post.mockRejectedValue({ response: { status: 400, data: {} } });
      await expect(ai.answerCards("Topic", [{ statement: "Q?", options: ["A", "B"] }])).rejects.toMatchObject({
        statusCode: 502,
        code: "AI_UNAVAILABLE",
      });
    });
  });
});
