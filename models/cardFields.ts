// Shared shape of a trivia card. Admin topic cards, custom-quiz cards and campaign
// cards all use the same format: an image or a short definition, plus options with one
// marked correct. Topic and campaign cards have 2 options; custom quiz cards have 4
// (older custom quiz cards may still have 2).

export type CardType = "image" | "definition";

export interface ICardContent {
  type: CardType;
  imageUrl?: string; // set when type === "image"
  text?: string; // the definition/statement; optional caption for image cards
  options: string[]; // 2 to 4
  correctOptionIndex: number; // an index into options
  attribution?: string; // image credit (author and licence) for pictures fetched from an API
}

export const CARD_TEXT_MAX = 300;
export const CARD_OPTION_MAX = 80;
export const CARD_ATTRIBUTION_MAX = 200;
export const CARD_OPTIONS_MIN = 2;
export const CARD_OPTIONS_MAX = 4;
// Options a new card must have: General Trivia topics and campaigns keep two, custom
// quizzes (broadcast, team and personal) have four.
export const TOPIC_CARD_OPTIONS = 2;
export const QUIZ_CARD_OPTIONS = 4;

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
