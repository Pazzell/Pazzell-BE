import ErrorHandler from "../../utils/ErrorHandler";
import { redis } from "../../utils/redis";
import { toInt } from "../../utils/validators";
import { ICardContent } from "../../models/cardFields";
import { buildCardContent } from "../trivia/cardInput";
import { getPlan } from "../plan/plan.service";
import { getGenerateDailyLimit } from "../config/config.service";
import * as claude from "./claude";
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
// Text sent to the model. Longer documents are sampled evenly from start to end.
export const PROMPT_MAX_CHARS = 60_000;
const PROMPT_WINDOWS = 6;
// A quote shorter than this proves nothing ("the", "is a").
const QUOTE_MIN_LETTERS = 15;
const QUOTE_MAX_CHARS = 400;
const TITLE_MAX = 80;

type PlanUser = { _id: any; proUntil?: Date | string | null };

export interface DraftCard extends ICardContent {
  // The sentence in the document that supports the answer; shown on the review screen only.
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
 * Keeps only the cards that are well formed and whose quote really is in the document.
 * A card the model cannot back with the student's own material is dropped.
 */
export async function verifyCandidates(
  candidates: claude.CardCandidate[],
  documentText: string,
  ownerId: string,
  limit: number
): Promise<DraftCard[]> {
  const haystack = fingerprint(documentText);
  const seen = new Set<string>();
  const drafts: DraftCard[] = [];

  for (const candidate of candidates) {
    if (drafts.length >= limit) break;
    const quote = candidate.quote.replace(/\s+/g, " ").trim();
    const needle = fingerprint(quote);
    if (needle.length < QUOTE_MIN_LETTERS || !haystack.includes(needle)) continue;

    const key = fingerprint(candidate.statement);
    if (!key || seen.has(key)) continue;

    // The correct answer goes first or second at random; play shuffles the options again.
    const correctOptionIndex = Math.random() < 0.5 ? 0 : 1;
    const options =
      correctOptionIndex === 0
        ? [candidate.correctAnswer, candidate.wrongAnswer]
        : [candidate.wrongAnswer, candidate.correctAnswer];
    let content: ICardContent;
    try {
      // The same validator the card endpoints use, so every draft can be saved as it is.
      content = await buildCardContent(
        { type: "definition", text: candidate.statement, options, correctOptionIndex },
        undefined,
        ownerId,
        "cards"
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

/** GET /custom-quizzes/generate: everything the upload screen needs. */
export async function getGenerateOptions(user: PlanUser) {
  return {
    enabled: claude.isAiConfigured(),
    fileTypes: DOCUMENT_TYPES,
    maxFileBytes: DOCUMENT_MAX_BYTES,
    minCharacters: DOCUMENT_MIN_CHARS,
    count: { default: GENERATE_DEFAULT_COUNT, min: 1, max: GENERATE_MAX_COUNT },
    ...(await allowance(user)),
  };
}

function parseCount(value: any): number {
  const count = toInt(value) ?? GENERATE_DEFAULT_COUNT;
  if (!Number.isInteger(count) || count < 1 || count > GENERATE_MAX_COUNT) {
    throw new ErrorHandler(
      `count must be a whole number from 1 to ${GENERATE_MAX_COUNT}`,
      400,
      "INVALID_CARD_COUNT",
      { min: 1, max: GENERATE_MAX_COUNT }
    );
  }
  return count;
}

export interface GenerateInput {
  file?: { buffer: Buffer; originalname?: string };
  text?: any;
  count?: any;
}

export async function generateDraftCards(user: PlanUser, input: GenerateInput) {
  const userId = String(user._id);
  if (!claude.isAiConfigured()) {
    throw new ErrorHandler(
      "Generating trivia from a document is not available yet",
      503,
      "AI_NOT_CONFIGURED"
    );
  }
  const count = parseCount(input.count);

  let kind: DocumentKind = "text";
  let text: string;
  if (input.file?.buffer?.length) {
    ({ kind, text } = await extractDocumentText(input.file.buffer));
  } else if (typeof input.text === "string" && input.text.trim()) {
    if (Buffer.byteLength(input.text) > DOCUMENT_MAX_BYTES) {
      throw new ErrorHandler("The text is too long (maximum 10MB)", 400, "DOCUMENT_TOO_LARGE");
    }
    text = cleanText(input.text);
  } else {
    throw new ErrorHandler(
      'Upload a document in the "document" field, or send its text as "text"',
      400,
      "DOCUMENT_REQUIRED"
    );
  }
  if (text.length < DOCUMENT_MIN_CHARS) {
    throw new ErrorHandler(
      `The document has too little text to write questions from (at least ${DOCUMENT_MIN_CHARS} characters are needed)`,
      400,
      "DOCUMENT_TOO_SHORT",
      { characters: text.length, minCharacters: DOCUMENT_MIN_CHARS }
    );
  }

  // Take today's slot before the paid request, so parallel uploads cannot exceed the limit.
  const dailyLimit = await getGenerateDailyLimit(getPlan(user).isPro);
  const key = usageKey(userId);
  const used = await redis.incr(key);
  if (used === 1) await redis.expire(key, 2 * 24 * 60 * 60);
  if (used > dailyLimit) {
    await redis.decr(key);
    throw new ErrorHandler(
      `You have used today's ${dailyLimit} document${dailyLimit === 1 ? "" : "s"}. Try again tomorrow.`,
      429,
      "GENERATION_LIMIT_REACHED",
      { dailyLimit, resetsAt: nextResetAt(), isPro: getPlan(user).isPro }
    );
  }

  let drafts: DraftCard[];
  let title: string | undefined;
  const prompt = excerptForPrompt(text);
  try {
    // A few spare cards cover the ones the checks below throw away.
    const generated = await claude.requestCards(prompt, count + Math.ceil(count / 4));
    drafts = await verifyCandidates(generated.cards, text, userId, count);
    title = generated.title?.slice(0, TITLE_MAX);
    if (drafts.length === 0) {
      throw new ErrorHandler(
        "No questions could be written from this document. Try one with more explanatory text.",
        422,
        "NO_CARDS_GENERATED"
      );
    }
  } catch (e) {
    // A failed attempt does not cost the player one of today's documents.
    await redis.decr(key);
    throw e;
  }

  return {
    suggestedTitle: title || null,
    cards: drafts,
    requested: count,
    document: {
      name: input.file?.originalname || null,
      kind,
      characters: text.length,
      // True when the document was longer than what is read in one go and was sampled.
      sampled: prompt.length < text.length,
    },
    usage: await allowance(user),
  };
}
