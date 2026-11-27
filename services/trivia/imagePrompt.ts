// Picture questions ask in one generic way: "Who is this?" for a person and "What is this?"
// for anything else, never "Which animal is this?" or "Who is this footballer?". Captions
// that say something else (a hint, a credit) are left as they are.

export const PERSON_PROMPT = "Who is this?";
export const THING_PROMPT = "What is this?";

const WHO = /^who\s+is\s+(this|that)\b[^?]*\??$/i;
const WHICH_OR_WHAT = /^(which|what)(\s+[^?]+?)?\s+is\s+(this|that)\??$/i;
const WHAT_THING = /^what\s+is\s+(this|that)\s+[^?]+\??$/i;
const WHOSE = /^whose\s+[^?]+?\s+is\s+(this|that)\??$/i;

/** The generic form of an image card's caption, or the caption unchanged. */
export function genericImagePrompt(text: string | undefined): string | undefined {
  if (text === undefined) return text;
  const caption = text.trim();
  if (WHO.test(caption)) return PERSON_PROMPT;
  if (WHICH_OR_WHAT.test(caption) || WHAT_THING.test(caption) || WHOSE.test(caption)) {
    return THING_PROMPT;
  }
  return text;
}
