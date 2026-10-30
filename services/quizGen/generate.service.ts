import ErrorHandler from "../../utils/ErrorHandler";
import { redis } from "../../utils/redis";
import { cleanString, requireString, toInt } from "../../utils/validators";
import { ICardContent, TOPIC_CARD_OPTIONS } from "../../models/cardFields";
import { buildCardContent } from "../trivia/cardInput";
import { getPlan } from "../plan/plan.service";
import { getGenerateDailyLimit } from "../config/config.service";
import * as ai from "./ai";
import {
  DOCUMENT_MAX_BYTES,
  DOCUMENT_MIN_CHARS,
  DOCUMENT_TYPES,
  DocumentKind,
  cleanText,
  extractDocumentText,
} from "./extract";

// Turns a player's study material into draft definition cards. Nothing is stored here:
// the drafts go back to the player, who edits them and saves the ones they keep through
// the normal card endpoints.

export const GENERATE_DEFAULT_COUNT = 10;
export const GENERATE_MAX_COUNT = 30;
// Cards written from the owner's own description rather than a document. A team quiz on
// the biggest board uses 25, so a set this size still leaves spares for missed cells.
export const PROMPT_MAX_COUNT = 50;
export const PROMPT_TEXT_MAX = 500;
const PROMPT_TOPIC_MAX = 60;
// Text sent to the model. Longer documents are sampled evenly from start to end.
export const PROMPT_MAX_CHARS = 60_000;
const PROMPT_WINDOWS = 6;
// A quote shorter than this proves nothing ("the", "is a").
const QUOTE_MIN_LETTERS = 15;
const QUOTE_MAX_CHARS = 400;
const TITLE_MAX = 80;
// Existing questions of a topic that an admin run is told not to repeat.
export const GENERATE_AVOID_MAX = 300;

type PlanUser = { _id: any; proUntil?: Date | string | null };

export interface DraftCard extends ICardContent {
  // The sentence in the document that supports the answer; shown on the review screen only.
  // Empty for cards written from a description, which have no document to quote.
  quote: string;
}

/** Letters and digits only, so line breaks, hyphenation and curly quotes cannot hide a match. */
export const fingerprint = (value: string): string =>
  value.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");

/**
 * The text given to the model. A document within the limit is sent whole; a longer one
 * is cut into evenly spaced windows so the cards cover it from start to end.
 */
export function excerptForPrompt(text: string, maxChars = PROMPT_MAX_CHARS): string {
  if (text.length <= maxChars) return text;
  const windowSize = Math.floor(maxChars / PROMPT_WINDOWS);
  const stride = (text.length - windowSize) / (PROMPT_WINDOWS - 1);
  const parts: string[] = [];
  for (let i = 0; i < PROMPT_WINDOWS; i++) {
    const start = Math.round(i * stride);
    let part = text.slice(start, start + windowSize);
    // Drop the broken word at each cut.
    if (start > 0) part = part.replace(/^\S*\s/, "");
    if (start + windowSize < text.length) part = part.replace(/\s\S*$/, "");
    parts.push(part.trim());
  }
  return parts.join("\n\n[…]\n\n");
}

/**
 * The options for a drafted card: the right answer at a random position among the first
 * `optionCount - 1` distinct wrong answers. Null when the model gave too few.
 */
export function placeAnswer(
  correctAnswer: string,
  wrongAnswers: string[],
  optionCount: number
): { options: string[]; correctOptionIndex: number } | null {
  const seen = new Set([correctAnswer.toLowerCase()]);
  const wrongs: string[] = [];
  for (const wrong of wrongAnswers) {
    const key = wrong.toLowerCase();
    if (!wrong || seen.has(key)) continue;
    seen.add(key);
    wrongs.push(wrong);
    if (wrongs.length === optionCount - 1) break;
  }
  if (!correctAnswer || wrongs.length < optionCount - 1) return null;
  // Play shuffles the options again; this just keeps the editor from always showing it first.
  const correctOptionIndex = Math.floor(Math.random() * optionCount);
  const options = [...wrongs];
  options.splice(correctOptionIndex, 0, correctAnswer);
  return { options, correctOptionIndex };
}

/**
 * Keeps only the cards that are well formed and whose quote really is in the document.
 * A card the model cannot back with the student's own material is dropped, and so is
 * one that repeats a question in `taken`.
 */
export async function verifyCandidates(
  candidates: ai.CardCandidate[],
  documentText: string,
  ownerId: string,
  limit: number,
  taken: string[] = [],
  optionCount: number = TOPIC_CARD_OPTIONS
): Promise<DraftCard[]> {
  const haystack = fingerprint(documentText);
  const seen = new Set<string>(taken.map(fingerprint));
  const drafts: DraftCard[] = [];

  for (const candidate of candidates) {
    if (drafts.length >= limit) break;
    const quote = candidate.quote.replace(/\s+/g, " ").trim();
    const needle = fingerprint(quote);
    if (needle.length < QUOTE_MIN_LETTERS || !haystack.includes(needle)) continue;

    const key = fingerprint(candidate.statement);
    if (!key || seen.has(key)) continue;

    const placed = placeAnswer(candidate.correctAnswer, candidate.wrongAnswers, optionCount);
    if (!placed) continue;
    let content: ICardContent;
    try {
      // The same validator the card endpoints use, so every draft can be saved as it is.
      content = await buildCardContent(
        { type: "definition", text: candidate.statement, ...placed },
        undefined,
        ownerId,
        "cards",
        undefined,
        optionCount
      );
    } catch {
      continue;
    }
    seen.add(key);
    drafts.push({ ...content, quote: quote.slice(0, QUOTE_MAX_CHARS) });
  }
  return drafts;
}

// --- Daily allowance --------------------------------------------------------------------

const usageKey = (userId: string, now = new Date()) =>
  `quizgen:${userId}:${now.toISOString().slice(0, 10)}`;

async function usedToday(userId: string): Promise<number> {
  return Number(await redis.get(usageKey(userId))) || 0;
}

const nextResetAt = (now = new Date()) =>
  new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));

async function allowance(user: PlanUser) {
  const dailyLimit = await getGenerateDailyLimit(getPlan(user).isPro);
  const used = await usedToday(String(user._id));
  return {
    dailyLimit,
    usedToday: Math.min(used, dailyLimit),
    remaining: Math.max(0, dailyLimit - used),
    resetsAt: nextResetAt(),
  };
}

/**
 * GET /custom-quizzes/generate: everything the upload screen needs. Admins writing cards
 * for a topic are `unlimited`: they have no daily allowance, so none is reported.
 */
export async function getGenerateOptions(user: PlanUser, { unlimited = false } = {}) {
  return {
    enabled: ai.isAiConfigured(),
    fileTypes: DOCUMENT_TYPES,
    maxFileBytes: DOCUMENT_MAX_BYTES,
    minCharacters: DOCUMENT_MIN_CHARS,
    count: { default: GENERATE_DEFAULT_COUNT, min: 1, max: GENERATE_MAX_COUNT },
    // Writing from a description ("50 questions about the solar system") instead of a document.
    prompt: {
      maxLength: PROMPT_TEXT_MAX,
      count: { default: GENERATE_DEFAULT_COUNT, min: 1, max: PROMPT_MAX_COUNT },
    },
    ...(unlimited ? {} : await allowance(user)),
  };
}

function parseCount(value: any, max = GENERATE_MAX_COUNT): number {
  const count = toInt(value) ?? GENERATE_DEFAULT_COUNT;
  if (!Number.isInteger(count) || count < 1 || count > max) {
    throw new ErrorHandler(
      `count must be a whole number from 1 to ${max}`,
      400,
      "INVALID_CARD_COUNT",
      { min: 1, max }
    );
  }
  return count;
}

/**
 * Cards the AI writes from its own knowledge for the owner's description. With no document
 * to quote, a second request answers each one blind and only the cards it agrees on stay.
 */
async function draftsFromPrompt(
  prompt: string,
  topic: string,
  count: number,
  ownerId: string,
  optionCount: number
): Promise<{ title?: string; cards: DraftCard[] }> {
  // A few spare cards cover the ones the checks below throw away.
  const spare = count + Math.ceil(count / 4);
  const generated = await ai.requestTopicCards(topic, prompt, spare, [], optionCount - 1);
  if (generated.declined && generated.cards.length === 0) {
    throw new ErrorHandler(generated.declined.slice(0, 300), 422, "PROMPT_REJECTED");
  }

  const seen = new Set<string>();
  const cards: DraftCard[] = [];
  for (const candidate of generated.cards) {
    const key = fingerprint(candidate.statement);
    if (!key || seen.has(key)) continue;
    const placed = placeAnswer(candidate.correctAnswer, candidate.wrongAnswers, optionCount);
    if (!placed) continue;
    try {
      const content = await buildCardContent(
        { type: "definition", text: candidate.statement, ...placed },
        undefined,
        ownerId,
        "cards",
        undefined,
        optionCount
      );
      cards.push({ ...content, quote: "" });
    } catch {
      continue;
    }
    seen.add(key);
  }

  const answers = cards.length
    ? await ai.answerCards(
        topic,
        cards.map((card) => ({ statement: card.text || "", options: card.options }))
      )
    : [];
  return {
    title: generated.title,
    cards: cards.filter((card, i) => answers[i] === card.correctOptionIndex).slice(0, count),
  };
}

export interface GenerateInput {
  file?: { buffer: Buffer; originalname?: string };
  text?: any;
  // A description of the questions to write, used instead of a document.
  prompt?: any;
  // What the questions are about when writing from a description, e.g. the quiz title.
  topic?: any;
  count?: any;
  // Admin runs: no daily allowance is checked or used.
  unlimited?: boolean;
  // Questions that already exist where the cards are going; they are not written again.
  avoid?: string[];
  // Options per card: 2 for General Trivia topics (the default), 4 for custom quizzes.
  optionCount?: number;
}

export async function generateDraftCards(user: PlanUser, input: GenerateInput) {
  const userId = String(user._id);
  if (!ai.isAiConfigured()) {
    throw new ErrorHandler(
      "Generating trivia from a document is not available yet",
      503,
      "AI_NOT_CONFIGURED"
    );
  }
  const fromPrompt =
    !input.file?.buffer?.length && typeof input.prompt === "string" && input.prompt.trim() !== "";
  const count = parseCount(input.count, fromPrompt ? PROMPT_MAX_COUNT : GENERATE_MAX_COUNT);

  let kind: DocumentKind = "text";
  let text = "";
  let prompt = "";
  let topic = "";
  if (fromPrompt) {
    prompt = requireString(input.prompt, "prompt", PROMPT_TEXT_MAX);
    // The quiz title when there is one; otherwise the description says it all.
    topic = cleanString(input.topic, PROMPT_TOPIC_MAX) || prompt.slice(0, PROMPT_TOPIC_MAX);
  } else if (input.file?.buffer?.length) {
    ({ kind, text } = await extractDocumentText(input.file.buffer));
  } else if (typeof input.text === "string" && input.text.trim()) {
    if (Buffer.byteLength(input.text) > DOCUMENT_MAX_BYTES) {
      throw new ErrorHandler("The text is too long (maximum 10MB)", 400, "DOCUMENT_TOO_LARGE");
    }
    text = cleanText(input.text);
  } else {
    throw new ErrorHandler(
      'Upload a document in the "document" field, send its text as "text", or describe the questions in "prompt"',
      400,
      "DOCUMENT_REQUIRED"
    );
  }
  if (!fromPrompt && text.length < DOCUMENT_MIN_CHARS) {
    throw new ErrorHandler(
      `The document has too little text to write questions from (at least ${DOCUMENT_MIN_CHARS} characters are needed)`,
      400,
      "DOCUMENT_TOO_SHORT",
      { characters: text.length, minCharacters: DOCUMENT_MIN_CHARS }
    );
  }

  // Take today's slot before the paid request, so parallel uploads cannot exceed the limit.
  const key = input.unlimited ? null : usageKey(userId);
  if (key) {
    const dailyLimit = await getGenerateDailyLimit(getPlan(user).isPro);
    const used = await redis.incr(key);
    if (used === 1) await redis.expire(key, 2 * 24 * 60 * 60);
    if (used > dailyLimit) {
      await redis.decr(key);
      throw new ErrorHandler(
        `You have used today's ${dailyLimit} AI generation${dailyLimit === 1 ? "" : "s"}. Try again tomorrow.`,
        429,
        "GENERATION_LIMIT_REACHED",
        { dailyLimit, resetsAt: nextResetAt(), isPro: getPlan(user).isPro }
      );
    }
  }
  const avoid = input.avoid || [];
  const optionCount = input.optionCount ?? TOPIC_CARD_OPTIONS;

  let drafts: DraftCard[];
  let title: string | undefined;
  const excerpt = fromPrompt ? "" : excerptForPrompt(text);
  try {
    if (fromPrompt) {
      const written = await draftsFromPrompt(prompt, topic, count, userId, optionCount);
      drafts = written.cards;
      title = written.title?.slice(0, TITLE_MAX);
    } else {
      // A few spare cards cover the ones the checks below throw away.
      const spare = count + Math.ceil(count / 4);
      const generated = await ai.requestCards(excerpt, spare, avoid, optionCount - 1);
      drafts = await verifyCandidates(generated.cards, text, userId, count, avoid, optionCount);
      title = generated.title?.slice(0, TITLE_MAX);
    }
    if (drafts.length === 0) {
      throw new ErrorHandler(
        fromPrompt
          ? "No reliable questions could be written for this. Try describing it differently."
          : "No questions could be written from this document. Try one with more explanatory text.",
        422,
        "NO_CARDS_GENERATED"
      );
    }
  } catch (e) {
    // A failed attempt does not cost the player one of today's documents.
    if (key) await redis.decr(key);
    throw e;
  }

  return {
    suggestedTitle: title || null,
    cards: drafts,
    requested: count,
    // What the cards were written from: a document, or the owner's description.
    prompt: fromPrompt ? prompt : null,
    document: fromPrompt
      ? null
      : {
          name: input.file?.originalname || null,
          kind,
          characters: text.length,
          // True when the document was longer than what is read in one go and was sampled.
          sampled: excerpt.length < text.length,
        },
    ...(input.unlimited ? {} : { usage: await allowance(user) }),
  };
}
