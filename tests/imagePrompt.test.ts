import { connectTestDB, closeTestDB } from "./setup";
import { closeRedisConnection } from "../utils/redis";
import { resetState } from "./helpers";
import TriviaCardModel from "../models/triviaCard.model";
import CustomQuizCardModel from "../models/customQuizCard.model";
import { genericImagePrompt } from "../services/trivia/imagePrompt";
import { buildCardContent } from "../services/trivia/cardInput";
import { makeImagePromptsGeneric } from "../services/trivia/imagePromptMigration";
import { IMPORT_CATEGORIES } from "../services/trivia/wikimedia";

describe("Generic picture questions", () => {
  beforeAll(connectTestDB);
  afterEach(resetState);
  afterAll(async () => {
    await closeTestDB();
    await closeRedisConnection();
  });

  it.each([
    ["Which animal is this?", "What is this?"],
    ["Which music symbol is this?", "What is this?"],
    ["which instrument is this", "What is this?"],
    ["Whose logo is this?", "What is this?"],
    ["What fruit is this?", "What is this?"],
    ["What is this dish?", "What is this?"],
    ["What is this?", "What is this?"],
    ["Who is this footballer?", "Who is this?"],
    ["Who is this musician?", "Who is this?"],
    ["Who is this?", "Who is this?"],
  ])("asks %p as %p", (from, to) => {
    expect(genericImagePrompt(from)).toBe(to);
  });

  it("leaves captions that are not an 'is this' question alone", () => {
    expect(genericImagePrompt("Found in West Africa")).toBe("Found in West Africa");
    expect(genericImagePrompt("Which animal is the largest?")).toBe("Which animal is the largest?");
    expect(genericImagePrompt(undefined)).toBeUndefined();
  });

  it("imports with a generic question for every category", () => {
    for (const category of IMPORT_CATEGORIES) {
      expect(category.prompt).toBe(category.people ? "Who is this?" : "What is this?");
    }
  });

  it("saves new and edited image cards with the generic question, but not definitions", async () => {
    const image = { type: "image" as const, imageUrl: "https://x.test/a.webp", options: ["A", "B"], correctOptionIndex: 0 };
    const edited = await buildCardContent({ text: "Who is this pastor?" }, undefined, "u1", "cards", image);
    expect(edited.text).toBe("Who is this?");

    const definition = { type: "definition" as const, text: "x", options: ["A", "B"], correctOptionIndex: 0 };
    const kept = await buildCardContent({ text: "Which animal is this?" }, undefined, "u1", "cards", definition);
    expect(kept.text).toBe("Which animal is this?");
  });

  it("rewrites existing image cards, with a dry run first", async () => {
    const card = (text: string, type = "image") => ({
      topicId: "t1", type, imageUrl: type === "image" ? "https://x.test/a.webp" : undefined,
      text, options: ["A", "B"], correctOptionIndex: 0,
    });
    await TriviaCardModel.insertMany([
      card("Which animal is this?"), card("Which animal is this?"), card("Who is this footballer?"),
      card("What is this?"), card("Which animal is this?", "definition"),
    ]);
    await CustomQuizCardModel.create({ quizId: "q1", ...card("Which plant is this?"), topicId: undefined });

    const dry = await makeImagePromptsGeneric(false);
    expect(dry.topicCards).toEqual(
      expect.arrayContaining([
        { from: "Which animal is this?", to: "What is this?", count: 2 },
        { from: "Who is this footballer?", to: "Who is this?", count: 1 },
      ])
    );
    expect(await TriviaCardModel.countDocuments({ text: "Which animal is this?" })).toBe(3);

    await makeImagePromptsGeneric(true);
    const texts = (await TriviaCardModel.find({ type: "image" }).lean()).map((c) => c.text).sort();
    expect(texts).toEqual(["What is this?", "What is this?", "What is this?", "Who is this?"]);
    expect(await TriviaCardModel.countDocuments({ type: "definition", text: "Which animal is this?" })).toBe(1);
    expect((await CustomQuizCardModel.findOne().lean())!.text).toBe("What is this?");
  });
});
