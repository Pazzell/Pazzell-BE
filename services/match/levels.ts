import MatchLevelConfigModel, {
  MATCH_CATEGORIES,
  MATCH_SIMILARITIES,
  MATCH_VARIANTS,
} from "../../models/matchLevelConfig.model";
import ErrorHandler from "../../utils/ErrorHandler";
import { POOLS } from "./artifacts";
import { LevelSettings, generateQuestions } from "./questionGenerator";

export interface LevelDefinition extends LevelSettings {
  order: number;
  name?: string;
  isActive: boolean;
}

/**
 * Built-in levels, used until an admin has stored level configs (and written to the
 * database by the seed script). As the level number rises the number of questions,
 * the number of options and the closeness of the distractors grow together.
 */
export const DEFAULT_LEVELS: LevelDefinition[] = [
  { level: 1, name: "First shapes", questionCount: 3, optionCount: 2, categories: ["shapes"], similarity: "low", variants: [], dotCountTargets: false },
  { level: 2, name: "Colours", questionCount: 4, optionCount: 2, categories: ["colors"], similarity: "low", variants: [], dotCountTargets: false },
  { level: 3, name: "Things", questionCount: 4, optionCount: 3, categories: ["figures"], similarity: "low", variants: [], dotCountTargets: false },
  { level: 4, name: "Shapes and colours", questionCount: 5, optionCount: 3, categories: ["shapes", "colors"], similarity: "low", variants: [], dotCountTargets: false },
  { level: 5, name: "Big letters", questionCount: 5, optionCount: 3, categories: ["letters_upper"], similarity: "medium", variants: [], dotCountTargets: false },
  { level: 6, name: "Numbers", questionCount: 6, optionCount: 4, categories: ["numbers"], similarity: "medium", variants: [], dotCountTargets: false },
  { level: 7, name: "Big and small letters", questionCount: 6, optionCount: 4, categories: ["letters_upper", "letters_lower"], similarity: "medium", variants: [], dotCountTargets: false },
  { level: 8, name: "Mix it up", questionCount: 7, optionCount: 4, categories: ["shapes", "figures", "colors"], similarity: "medium", variants: [], dotCountTargets: false },
  { level: 9, name: "Coloured shapes", questionCount: 8, optionCount: 4, categories: ["colored_shapes"], similarity: "medium", variants: [], dotCountTargets: false },
  { level: 10, name: "Count the dots", questionCount: 8, optionCount: 4, categories: ["numbers"], similarity: "medium", variants: [], dotCountTargets: true },
  { level: 11, name: "Twists and turns", questionCount: 9, optionCount: 5, categories: ["colored_shapes", "shapes"], similarity: "high", variants: ["rotation"], dotCountTargets: false },
  { level: 12, name: "Mirror, mirror", questionCount: 10, optionCount: 6, categories: ["letters_lower", "letters_upper", "numbers", "figures"], similarity: "high", variants: ["mirror"], dotCountTargets: false },
].map((l) => ({ ...l, order: l.level, isActive: true })) as LevelDefinition[];

/** Active levels in play order. Falls back to DEFAULT_LEVELS while the collection is empty. */
export async function getActiveLevels(): Promise<LevelDefinition[]> {
  const stored = await MatchLevelConfigModel.find({}).sort({ order: 1, level: 1 }).lean();
  const source: LevelDefinition[] = stored.length > 0 ? (stored as any) : DEFAULT_LEVELS;
  return source
    .filter((l) => l.isActive)
    .map((l) => ({
      level: l.level,
      order: l.order,
      name: l.name,
      questionCount: l.questionCount,
      optionCount: l.optionCount,
      categories: l.categories,
      similarity: l.similarity,
      variants: l.variants || [],
      dotCountTargets: !!l.dotCountTargets,
      isActive: true,
    }));
}

const isIntIn = (v: any, min: number, max: number) => Number.isInteger(v) && v >= min && v <= max;

/**
 * Validates an admin-supplied level config and returns the clean settings. A timer is
 * never accepted here: the per-question time is chosen by the player, not the level.
 */
export function validateLevelInput(input: any, level: number): LevelDefinition {
  if (input === null || typeof input !== "object") {
    throw new ErrorHandler("A level config object is required", 400);
  }
  if ("timerSeconds" in input || "timeLimit" in input || "timer" in input) {
    throw new ErrorHandler(
      "Levels do not have a timer. The player chooses the per-question time.",
      400,
      "TIMER_NOT_IN_LEVEL_CONFIG"
    );
  }
  if (!isIntIn(level, 1, 999)) throw new ErrorHandler("level must be a positive integer", 400);
  if (!isIntIn(input.questionCount, 1, 50)) {
    throw new ErrorHandler("questionCount must be an integer between 1 and 50", 400);
  }
  if (!isIntIn(input.optionCount, 2, 9)) {
    throw new ErrorHandler("optionCount must be an integer between 2 and 9", 400);
  }
  if (
    !Array.isArray(input.categories) ||
    input.categories.length === 0 ||
    input.categories.some((c: any) => !(MATCH_CATEGORIES as readonly string[]).includes(c))
  ) {
    throw new ErrorHandler(
      `categories must be a non-empty list of: ${MATCH_CATEGORIES.join(", ")}`,
      400
    );
  }
  const similarity = input.similarity ?? "low";
  if (!(MATCH_SIMILARITIES as readonly string[]).includes(similarity)) {
    throw new ErrorHandler(`similarity must be one of: ${MATCH_SIMILARITIES.join(", ")}`, 400);
  }
  const variants = input.variants ?? [];
  if (
    !Array.isArray(variants) ||
    variants.some((v: any) => !(MATCH_VARIANTS as readonly string[]).includes(v))
  ) {
    throw new ErrorHandler(`variants may only contain: ${MATCH_VARIANTS.join(", ")}`, 400);
  }
  const categories = Array.from(new Set<string>(input.categories)) as LevelDefinition["categories"];
  const dotCountTargets = input.dotCountTargets === true;
  if (dotCountTargets && !categories.includes("numbers")) {
    throw new ErrorHandler('dotCountTargets needs the "numbers" category', 400);
  }
  if (input.order !== undefined && !isIntIn(input.order, 1, 9999)) {
    throw new ErrorHandler("order must be a positive integer", 400);
  }
  if (input.name !== undefined && (typeof input.name !== "string" || input.name.length > 60)) {
    throw new ErrorHandler("name must be a string of at most 60 characters", 400);
  }

  const definition: LevelDefinition = {
    level,
    order: input.order ?? level,
    name: input.name,
    questionCount: input.questionCount,
    optionCount: input.optionCount,
    categories,
    similarity,
    variants: Array.from(new Set(variants)) as LevelDefinition["variants"],
    dotCountTargets,
    isActive: input.isActive !== false,
  };

  const poolSize = new Set(categories.flatMap((c) => POOLS[c])).size;
  if (definition.optionCount > poolSize) {
    throw new ErrorHandler("optionCount is larger than the artifacts available in these categories", 400);
  }
  // Prove the config is playable before it is saved.
  try {
    generateQuestions(definition);
  } catch {
    throw new ErrorHandler(
      "These settings cannot produce that many distinct questions. Lower questionCount or add categories.",
      400
    );
  }
  return definition;
}

/** Copies DEFAULT_LEVELS into the collection the first time an admin edits levels. */
export async function ensureLevelsStored(): Promise<void> {
  const count = await MatchLevelConfigModel.estimatedDocumentCount();
  if (count > 0) return;
  try {
    await MatchLevelConfigModel.insertMany(DEFAULT_LEVELS, { ordered: false });
  } catch (e: any) {
    // A concurrent request stored them first.
    if (e.code !== 11000 && !e.writeErrors) throw e;
  }
}
