import mongoose from "mongoose";
import ErrorHandler from "./ErrorHandler";

export const isObjectId = (value: any): value is string =>
  typeof value === "string" && mongoose.isValidObjectId(value) && value.length === 24;

/** Throws a 404 for a malformed id so lookups never reach Mongo with attacker-shaped input. */
export function assertObjectId(value: any, label = "id"): string {
  if (!isObjectId(value)) throw new ErrorHandler(`Invalid ${label}`, 404);
  return value;
}

/** Trimmed string within `max` chars, or undefined when the input is empty/not a string. */
export function cleanString(value: any, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (trimmed.length > max) {
    throw new ErrorHandler(`Text is too long (maximum ${max} characters)`, 400);
  }
  return trimmed;
}

export function requireString(value: any, label: string, max: number): string {
  const cleaned = cleanString(value, max);
  if (!cleaned) throw new ErrorHandler(`${label} is required`, 400);
  return cleaned;
}

/**
 * Brand / call-to-action links: absolute http(s) URLs only. Rejects javascript:,
 * data:, protocol-relative and credential-bearing URLs. Returns the normalised href.
 */
export function parseHttpUrl(value: any, label = "URL"): string {
  if (typeof value !== "string" || !value.trim() || value.length > 2048) {
    throw new ErrorHandler(`${label} must be a valid http(s) URL`, 400);
  }
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new ErrorHandler(`${label} must be a valid http(s) URL`, 400);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new ErrorHandler(`${label} must use http or https`, 400);
  }
  if (url.username || url.password || !url.hostname.includes(".")) {
    throw new ErrorHandler(`${label} must be a valid http(s) URL`, 400);
  }
  return url.href;
}

/** Integer parsed from JSON or multipart text; undefined when absent, NaN-safe. */
export function toInt(value: any): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isInteger(n) ? n : NaN;
}
