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
  // Per-question countdown range, shared by topics, custom quizzes and campaigns.
  "game.timerMinSeconds": 1,
  "game.timerMaxSeconds": 15,
  // Network grace added to every question deadline before a submit counts as late.
  "game.submitGraceMs": envNumber("GAME_SUBMIT_GRACE_MS", 1000),
  // Timer a setup screen starts on, and a new custom quiz's default.
  "trivia.defaultTimerSeconds": 5,
  "trivia.minCards": 5,
  "trivia.maxCards": 30,
  // Share of a session's cards that are image cards; the rest are definitions.
  "trivia.imagePercent": envNumber("TRIVIA_IMAGE_PERCENT", 70),
  "customQuiz.freeLimit": 1,
  "customQuiz.minCardsToPublish": 5,
  // Documents a player may turn into trivia per day (each one is a paid AI request).
  "customQuiz.generateDailyLimitFree": envNumber("QUIZ_GENERATE_DAILY_LIMIT_FREE", 3),
  "customQuiz.generateDailyLimitPro": envNumber("QUIZ_GENERATE_DAILY_LIMIT_PRO", 20),
  // AI generated trivias a Pro player may have written per day (two paid AI requests each).
  "aiTrivia.generateDailyLimit": envNumber("AI_TRIVIA_DAILY_LIMIT", 10),
  "campaign.minCardsToPublish": 5,
  "campaign.interruptionThreshold": envNumber("CAMPAIGN_INTERRUPTION_THRESHOLD", 10),
  "campaign.priceAmount": envNumber("CAMPAIGN_PRICE_AMOUNT", 15000),
  "campaign.durationDays": envNumber("CAMPAIGN_DURATION_DAYS", 30),
  "pro.priceAmount": envNumber("PRO_PRICE_AMOUNT", 1500),
  "pro.durationDays": envNumber("PRO_DURATION_DAYS", 30),
  "payments.currency": (process.env.PAYMENT_CURRENCY || "NGN").toUpperCase(),
  // What a completed quiz needs to earn 1 point (see services/points/points.service.ts).
  "points.minCards": 20,
  "points.minScorePercent": 100,
  "points.dailyCap": 5,
  "points.practiceEarns": false,
  // When true, a set of questions earns once; replaying a set that has earned gives nothing.
  "points.setEarnsOnce": true,
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
    case "trivia.defaultTimerSeconds":
      return Number.isInteger(value) &&
        value >= CONFIG_DEFAULTS["game.timerMinSeconds"] &&
        value <= CONFIG_DEFAULTS["game.timerMaxSeconds"]
        ? null
        : "must be an integer within the global timer range";
    case "game.submitGraceMs":
      return Number.isInteger(value) && value >= 0 && value <= 5000
        ? null
        : "must be an integer between 0 and 5000";
    case "trivia.imagePercent":
      return Number.isInteger(value) && value >= 0 && value <= 100
        ? null
        : "must be an integer between 0 and 100";
    case "points.minScorePercent":
      return Number.isInteger(value) && value >= 1 && value <= 100
        ? null
        : "must be an integer between 1 and 100";
    case "points.practiceEarns":
    case "points.setEarnsOnce":
      return typeof value === "boolean" ? null : "must be true or false";
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

// Prices this product once stored as defaults: first in US dollars, then as their naira
// conversion. Both were replaced by the round naira prices above.
const RETIRED_PRICE_DEFAULTS: Record<string, number[]> = {
  "pro.priceAmount": [1, 1330.21],
  "campaign.priceAmount": [10, 13302.07],
};

/**
 * Brings a database that still holds a retired default price (the seed script stores the
 * defaults, and a stored value wins over the code) to the current naira prices. A price
 * an admin has set to anything else is left alone, and so is the currency in that case.
 * Returns the keys it changed.
 */
export async function migrateRetiredPricing(): Promise<string[]> {
  const keys = ["payments.currency", ...Object.keys(RETIRED_PRICE_DEFAULTS)];
  const rows = await ConfigModel.find({ key: { $in: keys } }).lean();
  const stored = new Map<string, any>(rows.map((row) => [row.key, row.value]));

  const priceKeys = Object.keys(RETIRED_PRICE_DEFAULTS);
  const retired = priceKeys.filter((key) => RETIRED_PRICE_DEFAULTS[key].includes(stored.get(key)));
  const custom = priceKeys.filter((key) => stored.has(key) && !retired.includes(key));

  const changed: string[] = [];
  const set = async (key: string) => {
    await ConfigModel.updateOne({ key }, { $set: { value: CONFIG_DEFAULTS[key] } });
    changed.push(key);
  };

  if (stored.get("payments.currency") === "USD") {
    if (custom.length > 0) {
      console.warn(
        `Stored payments.currency is USD with custom prices (${custom.join(", ")}); left unchanged. ` +
          "Set the currency and prices at /admin/config."
      );
      return changed;
    }
    await set("payments.currency");
  }
  for (const key of retired) {
    if (stored.get(key) !== CONFIG_DEFAULTS[key]) await set(key);
  }
  if (changed.length > 0) _cache = null;
  return changed;
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

export const getDefaultTimerSeconds = async (): Promise<number> =>
  getConfigValue<number>("trivia.defaultTimerSeconds");

export const getTriviaCardBounds = async (): Promise<{
  minCards: number;
  maxCards: number;
}> => ({
  minCards: await getConfigValue<number>("trivia.minCards"),
  maxCards: await getConfigValue<number>("trivia.maxCards"),
});

export const getTriviaImagePercent = async (): Promise<number> =>
  getConfigValue<number>("trivia.imagePercent");

export const getCustomQuizFreeLimit = async (): Promise<number> =>
  getConfigValue<number>("customQuiz.freeLimit");

export const getCustomQuizMinCards = async (): Promise<number> =>
  getConfigValue<number>("customQuiz.minCardsToPublish");

export const getGenerateDailyLimit = async (isPro: boolean): Promise<number> =>
  getConfigValue<number>(
    isPro ? "customQuiz.generateDailyLimitPro" : "customQuiz.generateDailyLimitFree"
  );

export const getAiTriviaDailyLimit = async (): Promise<number> =>
  getConfigValue<number>("aiTrivia.generateDailyLimit");

export const getCampaignMinCards = async (): Promise<number> =>
  getConfigValue<number>("campaign.minCardsToPublish");

export const getInterruptionThreshold = async (): Promise<number> =>
  getConfigValue<number>("campaign.interruptionThreshold");

export interface PointsRules {
  minCards: number;
  minScorePercent: number;
  dailyCap: number;
  practiceEarns: boolean;
  setEarnsOnce: boolean;
}

export const getPointsRules = async (): Promise<PointsRules> => ({
  minCards: await getConfigValue<number>("points.minCards"),
  minScorePercent: await getConfigValue<number>("points.minScorePercent"),
  dailyCap: await getConfigValue<number>("points.dailyCap"),
  practiceEarns: await getConfigValue<boolean>("points.practiceEarns"),
  setEarnsOnce: await getConfigValue<boolean>("points.setEarnsOnce"),
});

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
