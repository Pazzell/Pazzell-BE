// What every AI provider offers the rest of the app: one request that answers with JSON
// matching a schema. Nothing outside services/ai knows which provider is in use.

/**
 * "fast" is the cheaper model, used where the answer is checked against a document.
 * "strong" is the most capable model, used where there is nothing to check against.
 */
export type AiTier = "fast" | "strong";

export interface JsonRequest {
  // Short snake_case name for the output, e.g. "save_trivia_cards".
  name: string;
  description: string;
  system: string;
  content: string;
  // JSON Schema for the answer. Every object lists all its properties as required and sets
  // additionalProperties: false, which the stricter providers insist on.
  schema: Record<string, unknown>;
  tier: AiTier;
}

/**
 * - not_configured: no key, or the provider rejected it. Our problem, not the player's.
 * - unavailable: the request failed or the answer was unusable. Worth retrying.
 * - refused: the model would not answer this request.
 */
export type AiErrorKind = "not_configured" | "unavailable" | "refused";

export class AiError extends Error {
  kind: AiErrorKind;

  constructor(kind: AiErrorKind, message: string = kind) {
    super(message);
    this.kind = kind;
  }
}

export interface AiProvider {
  name: string;
  // The variable that holds this provider's API key.
  keyEnv: string;
  isConfigured(): boolean;
  model(tier: AiTier): string;
  requestJson(request: JsonRequest): Promise<any>;
}

export const timeoutFor = (tier: AiTier): number => (tier === "strong" ? 180_000 : 120_000);
