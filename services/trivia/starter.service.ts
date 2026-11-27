import ErrorHandler from "../../utils/ErrorHandler";
import TriviaTopicModel from "../../models/triviaTopic.model";
import TriviaCardModel from "../../models/triviaCard.model";
import { SEED_TOPICS, SeedCard, SeedTopic } from "../../scripts/seedData";

// The built-in definition questions (scripts/seedData.ts), loadable from the admin shell.
// The seed script only fills a topic that has no cards at all; this adds whichever
// questions a topic does not have yet, so it can be run again whenever the list grows.
// It also brings starter questions loaded before cards had four options up to four,
// as long as the admin has not changed their options.

export const starterCard = ([text, correct, ...wrongs]: SeedCard, index: number) => {
  // Rotate which position holds the right answer so position is never a clue.
  const correctOptionIndex = index % (wrongs.length + 1);
  const options = [...wrongs];
  options.splice(correctOptionIndex, 0, correct);
  return { type: "definition" as const, text, options, correctOptionIndex };
};

const textKey = (text?: string) => (text || "").trim().toLowerCase();

interface HeldCard {
  _id: unknown;
  options: string[];
  correctOptionIndex: number;
}

/**
 * A starter card still as it was loaded with two options: its right answer and the
 * first wrong answer of `seed`, nothing the admin has edited.
 */
const isOldStarterCard = (held: HeldCard, [, correct, wrong]: SeedCard) =>
  held.options.length === 2 &&
  held.options[held.correctOptionIndex] === correct &&
  held.options.includes(wrong);

/**
 * The starter questions of `seed` that the topic does not hold yet (`missing`), and the
 * ones it holds as untouched two-option cards (`outdated`), with their positions.
 */
async function starterGaps(seed: SeedTopic, topicId: string | null) {
  const held = new Map<string, HeldCard>();
  if (topicId) {
    const cards = await TriviaCardModel.find({ topicId, type: "definition" })
      .select("text options correctOptionIndex")
      .lean();
    for (const card of cards) {
      const key = textKey(card.text);
      if (!held.has(key)) held.set(key, card);
    }
  }
  const missing: { card: SeedCard; index: number }[] = [];
  const outdated: { card: SeedCard; index: number; id: unknown }[] = [];
  seed.cards.forEach((card, index) => {
    const found = held.get(textKey(card[0]));
    if (!found) missing.push({ card, index });
    else if (isOldStarterCard(found, card)) outdated.push({ card, index, id: found._id });
  });
  return { missing, outdated };
}

export async function listStarterTopics() {
  const existing = await TriviaTopicModel.find({ slug: { $in: SEED_TOPICS.map((s) => s.slug) } })
    .select("slug")
    .lean();
  const idBySlug = new Map(existing.map((t) => [t.slug, String(t._id)]));
  return Promise.all(
    SEED_TOPICS.map(async (seed) => {
      const topicId = idBySlug.get(seed.slug) || null;
      const { missing, outdated } = await starterGaps(seed, topicId);
      return {
        slug: seed.slug,
        name: seed.name,
        description: seed.description,
        topicId,
        total: seed.cards.length,
        missing: missing.length,
        // Loaded with two options and not edited since: loading again gives them four.
        outdated: outdated.length,
      };
    })
  );
}

export interface StarterLoadSummary {
  created: number;
  upgraded: number;
  topics: {
    slug: string;
    name: string;
    topicId: string;
    topicCreated: boolean;
    created: number;
    upgraded: number;
  }[];
}

/**
 * Adds the starter questions that are not there yet. `slugs` picks the topics (all of
 * them when omitted); a topic that does not exist is created. Questions already in a
 * topic are matched by their text, so nothing is ever added twice; an untouched
 * two-option starter question is given the four options it has now.
 */
export async function loadStarterTopics(adminId: string, slugs?: any): Promise<StarterLoadSummary> {
  let seeds = SEED_TOPICS;
  if (slugs !== undefined && slugs !== null) {
    const known = new Set(SEED_TOPICS.map((s) => s.slug));
    if (!Array.isArray(slugs) || slugs.length === 0 || slugs.some((s) => !known.has(s))) {
      throw new ErrorHandler(
        `slugs must be a list of one or more of: ${[...known].join(", ")}`,
        400,
        "INVALID_STARTER_TOPIC"
      );
    }
    seeds = SEED_TOPICS.filter((s) => slugs.includes(s.slug));
  }

  const summary: StarterLoadSummary = { created: 0, upgraded: 0, topics: [] };
  for (const seed of seeds) {
    let topic = await TriviaTopicModel.findOne({ slug: seed.slug });
    const topicCreated = !topic;
    if (!topic) {
      topic = await TriviaTopicModel.create({
        name: seed.name,
        slug: seed.slug,
        description: seed.description,
        order: seed.order,
        createdBy: adminId,
      });
    }
    const topicId = String(topic._id);
    const { missing, outdated } = await starterGaps(seed, topicCreated ? null : topicId);
    if (missing.length) {
      await TriviaCardModel.insertMany(
        missing.map(({ card, index }) => ({ topicId, ...starterCard(card, index) }))
      );
    }
    if (outdated.length) {
      await TriviaCardModel.bulkWrite(
        outdated.map(({ card, index, id }) => {
          const { options, correctOptionIndex } = starterCard(card, index);
          return { updateOne: { filter: { _id: id }, update: { $set: { options, correctOptionIndex } } } };
        })
      );
    }
    summary.created += missing.length;
    summary.upgraded += outdated.length;
    summary.topics.push({
      slug: seed.slug,
      name: topic.name,
      topicId,
      topicCreated,
      created: missing.length,
      upgraded: outdated.length,
    });
  }
  return summary;
}
