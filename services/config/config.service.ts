import ConfigModel from "../../models/config.model";

const envNumber = (name: string, fallback: number): number => {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
};

/**
 * Default values used when a key is missing from the DB (fresh install,
 * or a key that was never explicitly overridden by an admin).
 * Precedence: admin override in the Config collection > env var > the literal here.
 */
export const CONFIG_DEFAULTS: Record<string, any> = {
  // Per-question countdown range, shared by Match, topics, custom quizzes and campaigns.
  "game.timerMinSeconds": 1,
  "game.timerMaxSeconds": 7,
  // Network grace added to every question deadline before a submit counts as late.
  "game.submitGraceMs": envNumber("GAME_SUBMIT_GRACE_MS", 1000),
  "match.defaultTimerSeconds": 5,
  "trivia.minCards": 5,
  "trivia.maxCards": 30,
  "customQuiz.freeLimit": 1,
  "customQuiz.minCardsToPublish": 5,
  "campaign.minCardsToPublish": 5,
  "campaign.interruptionThreshold": envNumber("CAMPAIGN_INTERRUPTION_THRESHOLD", 10),
  "campaign.priceAmount": envNumber("CAMPAIGN_PRICE_AMOUNT", 13302.07),
  "campaign.durationDays": envNumber("CAMPAIGN_DURATION_DAYS", 30),
  "pro.priceAmount": envNumber("PRO_PRICE_AMOUNT", 1330.21),
  "pro.durationDays": envNumber("PRO_DURATION_DAYS", 30),
  "payments.currency": (process.env.PAYMENT_CURRENCY || "NGN").toUpperCase(),
};

// The timer range is one global constant pair; it is exposed for reading but
// is not editable through the admin API.
export const READ_ONLY_CONFIG_KEYS = new Set([
  "game.timerMinSeconds",
  "game.timerMaxSeconds",
]);

const isPositiveInt = (v: any) => Number.isInteger(v) && v > 0;
const isPositiveNumber = (v: any) => typeof v === "number" && Number.isFinite(v) && v > 0;

/** Returns an error message when `value` is not acceptable for `key`, otherwise null. */
export function validateConfigValue(key: string, value: any): string | null {
  switch (key) {
    case "match.defaultTimerSeconds":
      return Number.isInteger(value) &&
        value >= CONFIG_DEFAULTS["game.timerMinSeconds"] &&
        value <= CONFIG_DEFAULTS["game.timerMaxSeconds"]
        ? null
        : "must be an integer within the global timer range";
    case "game.submitGraceMs":
      return Number.isInteger(value) && value >= 0 && value <= 5000
        ? null
        : "must be an integer between 0 and 5000";
    case "campaign.priceAmount":
    case "pro.priceAmount":
      return isPositiveNumber(value) ? null : "must be a positive number";
    case "payments.currency":
      return typeof value === "string" && /^[A-Z]{3}$/.test(value)
        ? null
        : "must be a 3-letter uppercase currency code";
    default:
      return isPositiveInt(value) ? null : "must be a positive integer";
  }
}

let _cache: Map<string, any> | null = null;
let _loadingPromise: Promise<Map<string, any>> | null = null;

async function loadCache(): Promise<Map<string, any>> {
  const rows = await ConfigModel.find({}).lean();
  const map = new Map<string, any>();
  for (const row of rows) {
    map.set(row.key, row.value);
  }
  return map;
}

/**
 * Loads all Config rows into an in-process cache. Missing keys fall back to
 * CONFIG_DEFAULTS so a fresh/empty DB never crashes a scheduled job.
 */
export async function initConfigCache(): Promise<void> {
  _cache = await loadCache();
}

/** Drops the in-process cache (used by tests that wipe the DB between cases). */
export function resetConfigCache(): void {
  _cache = null;
  _loadingPromise = null;
}

async function ensureCache(): Promise<Map<string, any>> {
  if (_cache) return _cache;
  if (!_loadingPromise) {
    _loadingPromise = loadCache().then((map) => {
      _cache = map;
      _loadingPromise = null;
      return map;
    });
  }
  return _loadingPromise;
}

export async function getConfigValue<T = any>(key: string): Promise<T> {
  if (READ_ONLY_CONFIG_KEYS.has(key)) return CONFIG_DEFAULTS[key] as T;
  const cache = await ensureCache();
  if (cache.has(key)) return cache.get(key) as T;
  if (key in CONFIG_DEFAULTS) return CONFIG_DEFAULTS[key] as T;
  throw new Error(`Config key "${key}" has no stored value and no default`);
}

/** Admin write path: upserts the value, then invalidates/reloads the cache. */
export async function setConfigValue(
  key: string,
  value: any,
  updatedBy?: string,
  description?: string
): Promise<void> {
  await ConfigModel.findOneAndUpdate(
    { key },
    { key, value, updatedBy, ...(description ? { description } : {}) },
    { upsert: true, new: true }
  );
  _cache = null; // force reload on next access
}

/** Effective settings: only keys the current product knows about (legacy rows are ignored). */
export async function getAllConfig(): Promise<Record<string, any>> {
  const merged: Record<string, any> = {};
  for (const key of Object.keys(CONFIG_DEFAULTS)) {
    merged[key] = await getConfigValue(key);
  }
  return merged;
}

// Typed convenience getters -------------------------------------------------

export interface TimerRange {
  minSeconds: number;
  maxSeconds: number;
}

export const getTimerRange = (): TimerRange => ({
  minSeconds: CONFIG_DEFAULTS["game.timerMinSeconds"],
  maxSeconds: CONFIG_DEFAULTS["game.timerMaxSeconds"],
});

/** True only for an integer number of seconds inside the global range. */
export const isValidTimerSeconds = (value: any): value is number => {
  const { minSeconds, maxSeconds } = getTimerRange();
  return Number.isInteger(value) && value >= minSeconds && value <= maxSeconds;
};

export const getSubmitGraceMs = async (): Promise<number> =>
  getConfigValue<number>("game.submitGraceMs");

export const getMatchDefaultTimerSeconds = async (): Promise<number> =>
  getConfigValue<number>("match.defaultTimerSeconds");

export const getTriviaCardBounds = async (): Promise<{
  minCards: number;
  maxCards: number;
}> => ({
  minCards: await getConfigValue<number>("trivia.minCards"),
  maxCards: await getConfigValue<number>("trivia.maxCards"),
});

export const getCustomQuizFreeLimit = async (): Promise<number> =>
  getConfigValue<number>("customQuiz.freeLimit");

export const getCustomQuizMinCards = async (): Promise<number> =>
  getConfigValue<number>("customQuiz.minCardsToPublish");

export const getCampaignMinCards = async (): Promise<number> =>
  getConfigValue<number>("campaign.minCardsToPublish");

export const getInterruptionThreshold = async (): Promise<number> =>
  getConfigValue<number>("campaign.interruptionThreshold");

export interface Pricing {
  amount: number;
  currency: string;
  durationDays: number;
}

export const getProPricing = async (): Promise<Pricing> => ({
  amount: await getConfigValue<number>("pro.priceAmount"),
  currency: await getConfigValue<string>("payments.currency"),
  durationDays: await getConfigValue<number>("pro.durationDays"),
});

export const getCampaignPricing = async (): Promise<Pricing> => ({
  amount: await getConfigValue<number>("campaign.priceAmount"),
  currency: await getConfigValue<string>("payments.currency"),
  durationDays: await getConfigValue<number>("campaign.durationDays"),
});
