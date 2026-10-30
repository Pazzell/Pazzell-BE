import ErrorHandler from "../../utils/ErrorHandler";
import {
  CARD_OPTION_MAX,
  CARD_TEXT_MAX,
  ICardContent,
  TOPIC_CARD_OPTIONS,
} from "../../models/cardFields";
import { ImageFolder, resolveImage } from "../upload/image.service";
import { toInt } from "../../utils/validators";
import { genericImagePrompt } from "./imagePrompt";

// One validator for every kind of trivia card (admin topic, custom quiz, campaign):
// an image or a short definition, `count` options (2 for topics and campaigns, 4 for
// custom quizzes), one of them marked correct.

function parseOptions(raw: any, count: number): string[] {
  let value = raw;
  if (typeof value === "string") {
    // multipart forms send the array as a JSON string
    try {
      value = JSON.parse(value);
    } catch {
      throw new ErrorHandler(`options must be an array of ${count} strings`, 400, "INVALID_CARD");
    }
  }
  if (!Array.isArray(value) || value.length !== count) {
    throw new ErrorHandler(`A card must have exactly ${count} options`, 400, "INVALID_CARD");
  }
  const options = value.map((o) => (typeof o === "string" ? o.trim() : ""));
  if (options.some((o) => !o || o.length > CARD_OPTION_MAX)) {
    throw new ErrorHandler(
      `Each option must be 1 to ${CARD_OPTION_MAX} characters`,
      400,
      "INVALID_CARD"
    );
  }
  if (new Set(options.map((o) => o.toLowerCase())).size !== options.length) {
    throw new ErrorHandler(
      count === 2 ? "The two options must be different" : "The options must all be different",
      400,
      "INVALID_CARD"
    );
  }
  return options;
}

/**
 * Builds validated card content from a request body (JSON or multipart) and an optional
 * uploaded file. When `existing` is given this is an update: omitted fields keep their
 * current values, and the merged card is validated as a whole. New options must number
 * `optionCount`; an existing card whose options are not sent keeps the ones it has.
 */
export async function buildCardContent(
  body: any,
  file: { buffer: Buffer } | undefined,
  ownerId: string,
  folder: ImageFolder,
  existing?: ICardContent,
  optionCount: number = TOPIC_CARD_OPTIONS
): Promise<ICardContent> {
  const input = body || {};
  const type = input.type ?? existing?.type;
  if (type !== "image" && type !== "definition") {
    throw new ErrorHandler('type must be "image" or "definition"', 400, "INVALID_CARD");
  }

  let text: string | undefined = existing?.text;
  if (input.text !== undefined) {
    if (typeof input.text !== "string" || input.text.trim().length > CARD_TEXT_MAX) {
      throw new ErrorHandler(
        `text must be at most ${CARD_TEXT_MAX} characters`,
        400,
        "INVALID_CARD"
      );
    }
    text = input.text.trim() || undefined;
  }

  const uploaded = await resolveImage(file, input.imageUrl, ownerId, folder);
  const imageUrl = type === "image" ? uploaded ?? existing?.imageUrl : undefined;

  if (type === "definition" && !text) {
    throw new ErrorHandler("A definition card needs text", 400, "INVALID_CARD");
  }
  if (type === "image" && !imageUrl) {
    throw new ErrorHandler("An image card needs an image", 400, "INVALID_CARD");
  }

  const options =
    input.options !== undefined ? parseOptions(input.options, optionCount) : existing?.options;
  if (!options) {
    throw new ErrorHandler(`A card must have exactly ${optionCount} options`, 400, "INVALID_CARD");
  }

  const correctOptionIndex =
    input.correctOptionIndex !== undefined
      ? toInt(input.correctOptionIndex)
      : existing?.correctOptionIndex;
  if (
    correctOptionIndex === undefined ||
    !Number.isInteger(correctOptionIndex) ||
    correctOptionIndex < 0 ||
    correctOptionIndex >= options.length
  ) {
    throw new ErrorHandler(
      `correctOptionIndex must be from 0 to ${options.length - 1}`,
      400,
      "INVALID_CARD"
    );
  }

  // A picture question asks "Who is this?" or "What is this?", never a narrower version.
  if (type === "image") text = genericImagePrompt(text);

  return { type, imageUrl, text, options: [...options], correctOptionIndex };
}

export const BULK_CARD_LIMIT = 100;

/** Validates a bulk JSON payload ({ cards: [...] }); reports the first failing row. */
export async function buildBulkCards(
  body: any,
  ownerId: string,
  folder: ImageFolder,
  optionCount: number = TOPIC_CARD_OPTIONS
): Promise<ICardContent[]> {
  const rows = body?.cards;
  if (!Array.isArray(rows) || rows.length === 0 || rows.length > BULK_CARD_LIMIT) {
    throw new ErrorHandler(
      `cards must be an array of 1 to ${BULK_CARD_LIMIT} cards`,
      400,
      "INVALID_CARD"
    );
  }
  const cards: ICardContent[] = [];
  for (let i = 0; i < rows.length; i++) {
    try {
      cards.push(await buildCardContent(rows[i], undefined, ownerId, folder, undefined, optionCount));
    } catch (e: any) {
      throw new ErrorHandler(`Card ${i + 1}: ${e.message}`, 400, e.code || "INVALID_CARD", {
        index: i,
      });
    }
  }
  return cards;
}

/** A card as its editor (admin, quiz owner, brand) sees it: answer included. */
export const editorCard = (card: any) => ({
  id: String(card._id),
  type: card.type,
  imageUrl: card.imageUrl || null,
  text: card.text || null,
  options: card.options,
  correctOptionIndex: card.correctOptionIndex,
  attribution: card.attribution || null,
  createdAt: card.createdAt,
  updatedAt: card.updatedAt,
});
