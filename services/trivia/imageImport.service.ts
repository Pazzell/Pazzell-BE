import ErrorHandler from "../../utils/ErrorHandler";
import { assertObjectId, toInt } from "../../utils/validators";
import { CARD_OPTION_MAX } from "../../models/cardFields";
import TriviaTopicModel, { ITriviaTopic } from "../../models/triviaTopic.model";
import TriviaCardModel from "../../models/triviaCard.model";
import { storeImage } from "../upload/image.service";
import { shuffle } from "./mix";
import * as wikimedia from "./wikimedia";
import { CommonsImage, ImportCategory, WikidataEntity } from "./wikimedia";

// Fills a trivia topic with image cards fetched from Wikidata / Wikimedia Commons.
// Each picture is downloaded once and stored in our own storage like an admin upload.

export const IMPORT_SOURCE = "wikidata";
export const IMPORT_DEFAULT_COUNT = 20;
export const IMPORT_MAX_COUNT = 50;
const DOWNLOAD_CONCURRENCY = 3;
const ARTIST_MAX = 80;

/** Only licences that allow reuse with (at most) attribution and share-alike. */
export const isAllowedLicense = (license: string): boolean =>
  /^(cc0|cc[ -]by(-sa)?( \d|$)|public domain|pd\b)/i.test(license.trim());

export function buildAttribution(image: CommonsImage): string {
  const artist =
    image.artist.length > ARTIST_MAX ? `${image.artist.slice(0, ARTIST_MAX - 1)}…` : image.artist;
  return [artist, image.license, "Wikimedia Commons"].filter(Boolean).join(" · ");
}

const displayLabel = (label: string) => label.charAt(0).toUpperCase() + label.slice(1);

/**
 * A wrong option for `entity`: another entry of the same category, of the same gender
 * when the category is people (otherwise the picture alone gives the answer away).
 */
export function pickDistractor(
  entity: WikidataEntity,
  pool: readonly WikidataEntity[],
  people: boolean
): string | undefined {
  const others = pool.filter(
    (other) =>
      other.id !== entity.id &&
      other.label.toLowerCase() !== entity.label.toLowerCase() &&
      other.label.length <= CARD_OPTION_MAX
  );
  const sameGender = people ? others.filter((other) => other.gender === entity.gender) : [];
  const choice = shuffle(sameGender.length ? sameGender : others)[0];
  return choice ? displayLabel(choice.label) : undefined;
}

/** Alternates between the lists (first of each, second of each, ...), dropping repeats. */
export function interleaveEntities(lists: WikidataEntity[][]): WikidataEntity[] {
  const seen = new Set<string>();
  const merged: WikidataEntity[] = [];
  const longest = Math.max(0, ...lists.map((list) => list.length));
  for (let i = 0; i < longest; i++) {
    for (const list of lists) {
      const entity = list[i];
      if (!entity || seen.has(entity.id)) continue;
      seen.add(entity.id);
      merged.push(entity);
    }
  }
  return merged;
}

async function resolveTopic(
  category: ImportCategory,
  topicId: any,
  adminId: string
): Promise<ITriviaTopic> {
  if (topicId !== undefined && topicId !== null && topicId !== "") {
    const topic = await TriviaTopicModel.findById(assertObjectId(topicId, "topic id"));
    if (!topic) throw new ErrorHandler("Topic not found", 404, "TOPIC_NOT_FOUND");
    return topic;
  }
  const existing = await TriviaTopicModel.findOne({ slug: category.topicSlug });
  if (existing) return existing;
  return TriviaTopicModel.create({
    name: category.topicName,
    slug: category.topicSlug,
    description: category.topicDescription,
    createdBy: adminId,
  });
}

export interface ImportSummary {
  category: string;
  topic: { id: string; name: string; slug: string };
  requested: number;
  created: number;
  skipped: { unusableLicense: number; imageFailed: number; noWrongOption: number };
}

export async function importImageCards(
  adminId: string,
  input: { category?: any; count?: any; topicId?: any; country?: any }
): Promise<ImportSummary> {
  const category = wikimedia.getImportCategory(input?.category);
  if (!category) {
    throw new ErrorHandler(
      `category must be one of: ${wikimedia.IMPORT_CATEGORIES.map((c) => c.key).join(", ")}`,
      400,
      "INVALID_IMPORT_CATEGORY"
    );
  }
  const count = toInt(input?.count) ?? IMPORT_DEFAULT_COUNT;
  if (Number.isNaN(count) || count < 1 || count > IMPORT_MAX_COUNT) {
    throw new ErrorHandler(
      `count must be a whole number from 1 to ${IMPORT_MAX_COUNT}`,
      400,
      "INVALID_IMPORT_COUNT"
    );
  }
  // Only people are narrowed by country; everything else is fetched worldwide.
  const scopes = category.people ? wikimedia.resolveCountryScopes(input?.country) : [undefined];
  if (!scopes) {
    throw new ErrorHandler(
      `country must be "mixed", "worldwide", a Wikidata id (e.g. "Q1033") or one of: ${Object.keys(
        wikimedia.IMPORT_COUNTRIES
      ).join(", ")}`,
      400,
      "INVALID_IMPORT_COUNTRY"
    );
  }

  const topic = await resolveTopic(category, input?.topicId, adminId);
  const topicId = String(topic._id);
  const imported = new Set<string>(
    (await TriviaCardModel.distinct("sourceRef", { topicId, source: IMPORT_SOURCE })).map(String)
  );

  // Entries come back most famous first, so reading past the ones already imported
  // makes every run continue where the previous one stopped.
  const limit = imported.size + count * 3 + 10;
  const lists = await Promise.allSettled(
    scopes.map((countryId) => wikimedia.fetchEntities(category, limit, countryId))
  );
  if (lists.every((list) => list.status === "rejected")) {
    throw new ErrorHandler(
      "The image source did not respond. Please try again in a moment.",
      502,
      "IMPORT_SOURCE_UNAVAILABLE"
    );
  }
  // A mixed import still goes ahead on one list when the other query fails.
  const entities = interleaveEntities(
    lists.flatMap((list) => (list.status === "fulfilled" ? [list.value] : []))
  );
  const fresh = entities.filter(
    (entity) => !imported.has(entity.id) && entity.label.length <= CARD_OPTION_MAX
  );

  const summary: ImportSummary = {
    category: category.key,
    topic: { id: topicId, name: topic.name, slug: topic.slug },
    requested: count,
    created: 0,
    skipped: { unusableLicense: 0, imageFailed: 0, noWrongOption: 0 },
  };

  let images: Map<string, CommonsImage>;
  try {
    images = await wikimedia.fetchCommonsImages(fresh.map((entity) => entity.fileName));
  } catch {
    throw new ErrorHandler(
      "The image source did not respond. Please try again in a moment.",
      502,
      "IMPORT_SOURCE_UNAVAILABLE"
    );
  }

  const importOne = async (entity: WikidataEntity): Promise<void> => {
    const image = images.get(entity.fileName);
    if (!image || !isAllowedLicense(image.license)) {
      summary.skipped.unusableLicense++;
      return;
    }
    const wrong = pickDistractor(entity, entities, category.people);
    if (!wrong) {
      summary.skipped.noWrongOption++;
      return;
    }
    let imageUrl: string;
    try {
      const buffer = await wikimedia.downloadImage(image.url);
      imageUrl = (await storeImage({ buffer }, adminId, "cards")).url;
    } catch {
      summary.skipped.imageFailed++;
      return;
    }
    const correctOptionIndex = Math.random() < 0.5 ? 0 : 1;
    const correct = displayLabel(entity.label);
    try {
      await TriviaCardModel.create({
        topicId,
        type: "image",
        imageUrl,
        text: category.prompt,
        options: correctOptionIndex === 0 ? [correct, wrong] : [wrong, correct],
        correctOptionIndex,
        attribution: buildAttribution(image),
        source: IMPORT_SOURCE,
        sourceRef: entity.id,
      });
      summary.created++;
    } catch (e: any) {
      // Two imports of the same category running at once: the other one got there first.
      if (e.code !== 11000) throw e;
    }
  };

  let next = 0;
  while (next < fresh.length && summary.created < count) {
    const batch = fresh.slice(next, next + Math.min(DOWNLOAD_CONCURRENCY, count - summary.created));
    next += batch.length;
    await Promise.all(batch.map(importOne));
  }
  return summary;
}
