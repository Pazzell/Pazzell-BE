// Shared shape of a trivia card. Admin topic cards, custom-quiz cards and campaign
// cards all use the same format: an image or a short definition, plus exactly two
// options with one marked correct.

export type CardType = "image" | "definition";

export interface ICardContent {
  type: CardType;
  imageUrl?: string; // set when type === "image"
  text?: string; // the definition/statement; optional caption for image cards
  options: string[]; // exactly 2
  correctOptionIndex: number; // 0 or 1
  attribution?: string; // image credit (author and licence) for pictures fetched from an API
}

export const CARD_TEXT_MAX = 300;
export const CARD_OPTION_MAX = 80;
export const CARD_ATTRIBUTION_MAX = 200;

export const cardContentFields = {
  type: { type: String, enum: ["image", "definition"], required: true },
  imageUrl: { type: String },
  text: { type: String, maxlength: CARD_TEXT_MAX },
  options: {
    type: [{ type: String, maxlength: CARD_OPTION_MAX }],
    required: true,
    validate: {
      validator: (v: string[]) => Array.isArray(v) && v.length === 2,
      message: "A card must have exactly 2 options",
    },
  },
  correctOptionIndex: { type: Number, required: true, enum: [0, 1] },
  attribution: { type: String, maxlength: CARD_ATTRIBUTION_MAX },
};
