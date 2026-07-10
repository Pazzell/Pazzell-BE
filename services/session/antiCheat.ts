export type TimingVerdict = "ok" | "soft" | "hard";

/**
 * Evaluates an elapsed stage duration against configured floors.
 * hard: duration is implausibly fast even to register the stage happened at
 *   all — the session should be voided (no points/ticket/leaderboard entry).
 * soft: duration is suspiciously fast but not impossible — session still
 *   completes and earns points, but is flagged for admin review.
 */
export function evaluateTiming(
  durationMs: number,
  softFloorMs: number,
  hardFloorMs: number
): TimingVerdict {
  if (durationMs < hardFloorMs) return "hard";
  if (durationMs < softFloorMs) return "soft";
  return "ok";
}

export function evaluateVideoWatchTime(
  durationMs: number,
  videoDurationSeconds: number,
  minWatchFraction: number,
  hardWatchFraction: number
): TimingVerdict {
  const videoDurationMs = videoDurationSeconds * 1000;
  const softFloorMs = videoDurationMs * minWatchFraction;
  const hardFloorMs = videoDurationMs * hardWatchFraction;
  return evaluateTiming(durationMs, softFloorMs, hardFloorMs);
}
