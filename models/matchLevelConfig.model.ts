import mongoose, { Document, Model, Schema } from "mongoose";

export const MATCH_CATEGORIES = [
  "shapes",
  "colors",
  "letters_upper",
  "letters_lower",
  "numbers",
  "figures",
  "colored_shapes", // attribute combination: a shape in a colour
] as const;
export type MatchCategory = (typeof MATCH_CATEGORIES)[number];

export const MATCH_SIMILARITIES = ["low", "medium", "high"] as const;
export type MatchSimilarity = (typeof MATCH_SIMILARITIES)[number];

export const MATCH_VARIANTS = ["mirror", "rotation"] as const;
export type MatchVariant = (typeof MATCH_VARIANTS)[number];

// Difficulty lives entirely here. The per-question timer is NOT part of a level:
// the player picks it (within the global range) when starting an attempt.
export interface IMatchLevelConfig extends Document {
  level: number;
  order: number;
  name?: string;
  questionCount: number;
  optionCount: number; // options shown per question, including the correct one
  categories: MatchCategory[];
  similarity: MatchSimilarity; // how close distractors are to the target
  variants: MatchVariant[]; // mirrored / rotated look-alikes used as distractors
  dotCountTargets: boolean; // show a group of dots as the target, match it to a numeral
  isActive: boolean;
}

const matchLevelConfigSchema: Schema<IMatchLevelConfig> = new mongoose.Schema(
  {
    level: { type: Number, required: true, unique: true, min: 1 },
    order: { type: Number, required: true },
    name: { type: String, maxlength: 60 },
    questionCount: { type: Number, required: true, min: 1, max: 50 },
    optionCount: { type: Number, required: true, min: 2, max: 9 },
    categories: {
      type: [{ type: String, enum: MATCH_CATEGORIES }],
      required: true,
      validate: {
        validator: (v: string[]) => Array.isArray(v) && v.length > 0,
        message: "A level needs at least one category",
      },
    },
    similarity: { type: String, enum: MATCH_SIMILARITIES, default: "low" },
    variants: { type: [{ type: String, enum: MATCH_VARIANTS }], default: [] },
    dotCountTargets: { type: Boolean, default: false },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

matchLevelConfigSchema.index({ isActive: 1, order: 1 });

const MatchLevelConfigModel: Model<IMatchLevelConfig> = mongoose.model(
  "MatchLevelConfig",
  matchLevelConfigSchema
);
export default MatchLevelConfigModel;
