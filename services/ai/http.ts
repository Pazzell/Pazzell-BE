import axios from "axios";
import { AiError } from "./types";

// Shared by the providers that are called over plain HTTP (the Claude provider uses its SDK,
// which retries by itself).

const RETRIES = 2;
const retryable = (status?: number) =>
  !status || status === 408 || status === 409 || status === 429 || status >= 500;

/**
 * POSTs `body` and returns the response data. Retries rate limits, server errors and
 * network failures. A rejected key becomes not_configured; anything else unavailable.
 */
export async function postJson(
  provider: string,
  url: string,
  body: unknown,
  config: { headers: Record<string, string>; timeout: number },
  isKeyRejected: (status: number, data: any) => boolean = (status) =>
    status === 401 || status === 403
): Promise<any> {
  for (let attempt = 0; ; attempt++) {
    try {
      return (await axios.post(url, body, config)).data;
    } catch (e: any) {
      const status: number | undefined = e?.response?.status;
      const data = e?.response?.data;
      if (status && isKeyRejected(status, data)) {
        console.error(`${provider} API rejected the configured API key:`, JSON.stringify(data));
        throw new AiError("not_configured");
      }
      // A timed out request already used the whole wait; the player retries instead.
      const timedOut = e?.code === "ECONNABORTED" || e?.code === "ETIMEDOUT";
      if (attempt < RETRIES && !timedOut && retryable(status)) {
        await new Promise((resolve) => setTimeout(resolve, 1000 * 2 ** attempt));
        continue;
      }
      console.error(`${provider} API request failed:`, status || "", data ? JSON.stringify(data) : e?.message);
      throw new AiError("unavailable");
    }
  }
}

export function parseJson(provider: string, text: string | undefined, reason: unknown): any {
  try {
    return JSON.parse(text || "");
  } catch {
    // Cut off at the token limit, or no text at all.
    console.error(`${provider} API returned no usable JSON; finish reason:`, reason);
    throw new AiError("unavailable");
  }
}
