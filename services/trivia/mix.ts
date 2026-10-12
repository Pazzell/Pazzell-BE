import { CardType } from "../../models/cardFields";

export function shuffle<T>(items: readonly T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Picks `count` cards for a session, aiming for `imagePercent` image cards and the rest
 * definitions. When one type runs short the other fills the gap, so a session is never
 * smaller than asked just because of the mix. The result is in random order.
 */
export function pickMixedCards<T extends { type: CardType }>(
  cards: readonly T[],
  count: number,
  imagePercent: number
): T[] {
  const images = shuffle(cards.filter((c) => c.type === "image"));
  const definitions = shuffle(cards.filter((c) => c.type !== "image"));
  const total = Math.max(0, Math.min(count, cards.length));
  const percent = Math.max(0, Math.min(100, imagePercent));

  let imageCount = Math.min(images.length, Math.round((total * percent) / 100));
  const definitionCount = Math.min(definitions.length, total - imageCount);
  imageCount = Math.min(images.length, total - definitionCount);

  return shuffle([...images.slice(0, imageCount), ...definitions.slice(0, definitionCount)]);
}
