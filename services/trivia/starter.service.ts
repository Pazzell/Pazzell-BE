import ErrorHandler from "../../utils/ErrorHandler";
import TriviaTopicModel from "../../models/triviaTopic.model";
import TriviaCardModel from "../../models/triviaCard.model";
import { SEED_TOPICS, SeedCard, SeedTopic } from "../../scripts/seedData";

// The built-in definition questions (scripts/seedData.ts), loadable from the admin shell.
// The seed script only fills a topic that has no cards at all; this adds whichever
// questions a topic does not have yet, so it can be run again whenever the list grows.

export const starterCard = ([text, correct, wrong]: SeedCard, index: number) => {
  // Alternate which side holds the right answer so position is never a clue.
  const correctFirst = index % 2 === 0;
  return {
    type: "definition" as const,
    text,
    options: correctFirst ? [correct, wrong] : [wrong, correct],
    correctOptionIndex: correctFirst ? 0 : 1,
  };
};

const textKey = (text?: string) => (text || "").trim().toLowerCase();

/** The starter questions of `seed` that the topic does not hold yet, with their positions. */
async function missingCards(seed: SeedTopic, topicId: string | null) {
  const held = new Set<string>();
  if (topicId) {
    const cards = await TriviaCardModel.find({ topicId, type: "definition" }).select("text").lean();
    for (const card of cards) held.add(textKey(card.text));
  }
  return seed.cards
    .map((card, index) => ({ card, index }))
    .filter(({ card }) => !held.has(textKey(card[0])));
}

export async function listStarterTopics() {
  const existing = await TriviaTopicModel.find({ slug: { $in: SEED_TOPICS.map((s) => s.slug) } })
    .select("slug")
    .lean();
  const idBySlug = new Map(existing.map((t) => [t.slug, String(t._id)]));
  return Promise.all(
    SEED_TOPICS.map(async (seed) => {
      const topicId = idBySlug.get(seed.slug) || null;
      return {
        slug: seed.slug,
        name: seed.name,
        description: seed.description,
        topicId,
        total: seed.cards.length,
        missing: (await missingCards(seed, topicId)).length,
      };
    })
  );
}

export interface StarterLoadSummary {
  created: number;
  topics: { slug: string; name: string; topicId: string; topicCreated: boolean; created: number }[];
}

/**
 * Adds the starter questions that are not there yet. `slugs` picks the topics (all of
 * them when omitted); a topic that does not exist is created. Questions already in a
 * topic are matched by their text and left alone, so nothing is ever added twice.
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

  const summary: StarterLoadSummary = { created: 0, topics: [] };
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
    const missing = await missingCards(seed, topicCreated ? null : topicId);
    if (missing.length) {
      await TriviaCardModel.insertMany(
        missing.map(({ card, index }) => ({ topicId, ...starterCard(card, index) }))
      );
    }
    summary.created += missing.length;
    summary.topics.push({
      slug: seed.slug,
      name: topic.name,
      topicId,
      topicCreated,
      created: missing.length,
    });
  }
  return summary;
}
