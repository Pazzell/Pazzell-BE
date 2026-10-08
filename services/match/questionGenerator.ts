import {
  POOLS,
  DOTS_MAX,
  getArtifact,
  baseIdOf,
  similarBaseIds,
  attributeSiblings,
  variantSuffixes,
} from "./artifacts";
import { MatchCategory, MatchSimilarity, MatchVariant } from "../../models/matchLevelConfig.model";

export interface LevelSettings {
  level: number;
  questionCount: number;
  optionCount: number;
  categories: MatchCategory[];
  similarity: MatchSimilarity;
  variants: MatchVariant[];
  dotCountTargets: boolean;
}

export interface GeneratedQuestion {
  targetId: string; // artifact shown at the top
  optionIds: string[]; // shuffled; contains correctOptionId exactly once
  correctOptionId: string;
}

type Rng = () => number;

function shuffle<T>(items: readonly T[], rng: Rng): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Every variant id of a base artifact, for the variant kinds the level enables. */
function variantsOf(baseId: string, kinds: MatchVariant[]): string[] {
  const base = getArtifact(baseId);
  if (!base || kinds.length === 0) return [];
  return variantSuffixes(base, kinds).map((suffix) => `${baseId}@${suffix}`);
}

/**
 * Distractors for `correctId`, closest look-alikes first according to the level's
 * similarity setting:
 *   low    — other artifacts of the same category
 *   medium — commonly confused artifacts first (similar shapes, colours, letters, ...)
 *   high   — rotated/mirrored copies and attribute siblings first (a red triangle vs a
 *            blue triangle vs a red circle), then the medium set
 * Any shortfall is filled from the level's other categories (mixed categories).
 */
function buildDistractors(
  correctId: string,
  category: MatchCategory,
  settings: LevelSettings,
  needed: number,
  rng: Rng
): string[] {
  const correctBase = baseIdOf(correctId);
  const base = getArtifact(correctBase)!;
  const pool = POOLS[category];
  const allowed = new Set(settings.categories.flatMap((c) => POOLS[c]));

  const tiers: string[][] = [];
  if (settings.similarity === "high") {
    // Other orientations of the very same artifact, including the plain one.
    const sameArtifact = [correctBase, ...variantsOf(correctBase, settings.variants)];
    tiers.push(shuffle([...sameArtifact, ...attributeSiblings(base)], rng));
  }
  if (settings.similarity !== "low") {
    tiers.push(shuffle(similarBaseIds(base).filter((id) => allowed.has(id)), rng));
  }
  tiers.push(shuffle(pool, rng));
  tiers.push(shuffle([...allowed].filter((id) => !pool.includes(id)), rng));

  const chosen: string[] = [];
  for (const tier of tiers) {
    for (const id of tier) {
      if (chosen.length === needed) return chosen;
      if (id !== correctId && !chosen.includes(id)) chosen.push(id);
    }
  }
  return chosen;
}

/**
 * Builds the questions for one attempt at a level. Guarantees, for every question:
 * the correct option appears exactly once, all options are distinct, and no two
 * questions in the attempt are the same.
 */
export function generateQuestions(
  settings: LevelSettings,
  rng: Rng = Math.random
): GeneratedQuestion[] {
  const questions: GeneratedQuestion[] = [];
  const usedTargets = new Set<string>();
  const usedSignatures = new Set<string>();
  const categoryOrder = shuffle(settings.categories, rng);

  let guard = 0;
  while (questions.length < settings.questionCount && guard < settings.questionCount * 50) {
    guard++;
    const category = categoryOrder[guard % categoryOrder.length];

    // Prefer a target not yet used in this attempt; reuse only once the pool is spent.
    const pool = shuffle(POOLS[category], rng);
    let correctId = pool.find((id) => !usedTargets.has(id)) || pool[0];
    let targetId = correctId;

    if (category === "numbers" && settings.dotCountTargets) {
      // Show a group of dots; the player matches it to the numeral.
      const countable = pool.filter((id) => {
        const value = getArtifact(id)!.attributes.value!;
        return value >= 1 && value <= DOTS_MAX;
      });
      correctId = countable.find((id) => !usedTargets.has(id)) || countable[0];
      targetId = `dots:${getArtifact(correctId)!.attributes.value}`;
    } else if (settings.variants.length > 0 && rng() < 0.5) {
      // Sometimes the target itself is a rotated/mirrored variant.
      const variants = variantsOf(correctId, settings.variants);
      if (variants.length > 0) {
        correctId = variants[Math.floor(rng() * variants.length)];
        targetId = correctId;
      }
    }

    const distractors = buildDistractors(
      correctId,
      category,
      settings,
      settings.optionCount - 1,
      rng
    );
    if (distractors.length < settings.optionCount - 1) continue;

    const optionIds = shuffle([correctId, ...distractors], rng);
    const signature = `${targetId}|${[...optionIds].sort().join(",")}`;
    if (usedSignatures.has(signature)) continue;

    usedSignatures.add(signature);
    usedTargets.add(baseIdOf(correctId));
    questions.push({ targetId, optionIds, correctOptionId: correctId });
  }

  if (questions.length < settings.questionCount) {
    throw new Error(
      `Level ${settings.level} cannot produce ${settings.questionCount} distinct questions`
    );
  }
  return questions;
}
