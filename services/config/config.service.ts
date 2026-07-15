import ConfigModel from "../../models/config.model";

/**
 * Default values used when a key is missing from the DB (fresh install,
 * or a key that was never explicitly seeded/overridden by an admin).
 * Keep this in sync with the keys documented in the migration plan.
 */
export const CONFIG_DEFAULTS: Record<string, any> = {
  "pricing.basic.weeklyPrice": 7000, // NGN
  "pricing.premium.weeklyPrice": 10000, // NGN
  "payout.playerSharePercent": 50,
  "payout.platformSharePercent": 50,
  "payout.rankDistribution": [
    { position: 1, percentage: 20 },
    { position: 2, percentage: 15 },
    { position: 3, percentage: 10 },
    { position: 4, percentage: 7.875 },
    { position: 5, percentage: 7.875 },
    { position: 6, percentage: 7.875 },
    { position: 7, percentage: 7.875 },
    { position: 8, percentage: 7.875 },
    { position: 9, percentage: 7.875 },
    { position: 10, percentage: 7.875 },
  ],
  "raffle.eligibilityFloorCap": 3,
  "referral.pointsThreshold": 21,
  "referral.referrerBonusPoints": 5,
  "points.sessionCompletionPoints": 7,
  "forum.winnerShareBonusPoints": 5,
  "campaign.quizQuestionCount": 3,
  "video.maxDurationSeconds": 130, // ~2 minutes + small buffer
  "video.maxSizeBytes": 10 * 1024 * 1024, // 10MB
  "anticheat.softFloorMs": {
    sliding_puzzle: 3000,
    card_matching: 3000,
    spot_the_difference: 3000,
    word_hunt: 3000,
    video: 0, // set per-campaign at read time (fraction of videoDurationSeconds)
    quiz: 1000,
  },
  "anticheat.hardFloorMs": {
    sliding_puzzle: 500,
    card_matching: 500,
    spot_the_difference: 500,
    word_hunt: 500,
    video: 0,
    quiz: 200,
  },
  "anticheat.videoMinWatchFraction": 0.8, // below this fraction of video length watched -> soft flag
  "anticheat.videoHardWatchFraction": 0.2, // below this fraction -> hard void
};

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

export async function getAllConfig(): Promise<Record<string, any>> {
  const cache = await ensureCache();
  const merged: Record<string, any> = { ...CONFIG_DEFAULTS };
  for (const [k, v] of cache.entries()) merged[k] = v;
  return merged;
}

// Typed convenience getters -------------------------------------------------

export const getWeeklyPrice = async (
  packageType: "basic" | "premium"
): Promise<number> => getConfigValue<number>(`pricing.${packageType}.weeklyPrice`);

export const getPayoutSplit = async (): Promise<{
  playerSharePercent: number;
  platformSharePercent: number;
}> => ({
  playerSharePercent: await getConfigValue<number>("payout.playerSharePercent"),
  platformSharePercent: await getConfigValue<number>(
    "payout.platformSharePercent"
  ),
});

export const getRankDistribution = async (): Promise<
  { position: number; percentage: number }[]
> => getConfigValue("payout.rankDistribution");

export const getRaffleEligibilityFloorCap = async (): Promise<number> =>
  getConfigValue<number>("raffle.eligibilityFloorCap");

export const getReferralPointsThreshold = async (): Promise<number> =>
  getConfigValue<number>("referral.pointsThreshold");

export const getReferrerBonusPoints = async (): Promise<number> =>
  getConfigValue<number>("referral.referrerBonusPoints");

export const getSessionCompletionPoints = async (): Promise<number> =>
  getConfigValue<number>("points.sessionCompletionPoints");

export const getWinnerShareBonusPoints = async (): Promise<number> =>
  getConfigValue<number>("forum.winnerShareBonusPoints");

export const getQuizQuestionCount = async (): Promise<number> =>
  getConfigValue<number>("campaign.quizQuestionCount");

export const getVideoLimits = async (): Promise<{
  maxDurationSeconds: number;
  maxSizeBytes: number;
}> => ({
  maxDurationSeconds: await getConfigValue<number>("video.maxDurationSeconds"),
  maxSizeBytes: await getConfigValue<number>("video.maxSizeBytes"),
});

export const getAntiCheatFloors = async (): Promise<{
  softFloorMs: Record<string, number>;
  hardFloorMs: Record<string, number>;
  videoMinWatchFraction: number;
  videoHardWatchFraction: number;
}> => ({
  softFloorMs: await getConfigValue("anticheat.softFloorMs"),
  hardFloorMs: await getConfigValue("anticheat.hardFloorMs"),
  videoMinWatchFraction: await getConfigValue<number>(
    "anticheat.videoMinWatchFraction"
  ),
  videoHardWatchFraction: await getConfigValue<number>(
    "anticheat.videoHardWatchFraction"
  ),
});
