import UserModel from "../models/user.model";
import { getWeeklyPointsAggregate } from "./points/pointsLedger.service";

export interface UnifiedLeaderboardEntry {
  userId: string;
  points: number;
  puzzlesSolved: number;
  avgCompletionTimeMs: number | null;
}

/**
 * The single source of truth for "the weekly leaderboard" — points from
 * PointsLedgerModel (session completions + referral/winner-share bonuses).
 * Previously there were four independent, subtly-inconsistent sort
 * implementations across leaderboard.controller.ts, prizePool.service.ts,
 * user.controller.ts, and rewards.service.ts — this replaces all of them.
 *
 * Tiebreaker (lower average completion time ranks higher) is computed from
 * `session_completion` ledger entries, which, by construction via the
 * GameSession first-completion guard, only ever exist for genuine first
 * completions — replays never write a ledger entry.
 */
export async function getUnifiedWeeklyEntries(
  weekStart: Date,
  weekEnd: Date,
  weekKey: string
): Promise<UnifiedLeaderboardEntry[]> {
  const ledgerEntries = await getWeeklyPointsAggregate(weekKey);

  const entries: UnifiedLeaderboardEntry[] = ledgerEntries.map((e) => ({
    userId: e.userId,
    points: e.points,
    puzzlesSolved: e.sessionCompletions,
    avgCompletionTimeMs: e.avgCompletionTimeMs,
  }));

  entries.sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points;
    const aTime = a.avgCompletionTimeMs ?? Infinity;
    const bTime = b.avgCompletionTimeMs ?? Infinity;
    return aTime - bTime;
  });

  return entries;
}

export async function getHiddenUserIds(): Promise<Set<string>> {
  const hiddenUsers = await UserModel.find(
    { "privacy.showOnLeaderboard": false },
    { _id: 1 }
  ).lean();
  return new Set(hiddenUsers.map((u: any) => String(u._id)));
}

/** 1-indexed rank of `userId` within the given week's leaderboard, or null if absent. */
export async function getUserWeeklyRank(
  userId: string,
  weekStart: Date,
  weekEnd: Date,
  weekKey: string
): Promise<number | null> {
  const entries = await getUnifiedWeeklyEntries(weekStart, weekEnd, weekKey);
  const idx = entries.findIndex((e) => String(e.userId) === String(userId));
  return idx === -1 ? null : idx + 1;
}
