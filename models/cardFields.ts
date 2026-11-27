// Shared shape of a trivia card. Admin topic cards, custom-quiz cards and campaign
// cards all use the same format: an image or a short definition, plus options with one
// marked correct. Every new card has 4 options; cards saved before that keep the 2 they
// were written with and still play.

export type CardType = "image" | "definition";

export interface ICardContent {
  type: CardType;
  imageUrl?: string; // set when type === "image"
  text?: string; // the definition/statement; optional caption for image cards
  options: string[]; // 4 (2 on older cards)
  correctOptionIndex: number; // an index into options
  attribution?: string; // image credit (author and licence) for pictures fetched from an API
}

export const CARD_TEXT_MAX = 300;
export const CARD_OPTION_MAX = 80;
export const CARD_ATTRIBUTION_MAX = 200;
export const CARD_OPTIONS_MIN = 2;
export const CARD_OPTIONS_MAX = 4;
// Options a new card must have, on every kind of card. CARD_OPTIONS_MIN stays at 2 so
// cards saved before the move to four options still load and play.
export const CARD_OPTIONS = 4;

export const cardContentFields = {
  type: { type: String, enum: ["image", "definition"], required: true },
  imageUrl: { type: String },
  text: { type: String, maxlength: CARD_TEXT_MAX },
  options: {
    type: [{ type: String, maxlength: CARD_OPTION_MAX }],
    required: true,
    validate: {
      validator: (v: string[]) =>
        Array.isArray(v) && v.length >= CARD_OPTIONS_MIN && v.length <= CARD_OPTIONS_MAX,
      message: `A card must have ${CARD_OPTIONS_MIN} to ${CARD_OPTIONS_MAX} options`,
    },
  },
  correctOptionIndex: { type: Number, required: true, min: 0, max: CARD_OPTIONS_MAX - 1 },
  attribution: { type: String, maxlength: CARD_ATTRIBUTION_MAX },
};
