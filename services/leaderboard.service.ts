import PuzzleAttemptModel from "../models/puzzleAttempt.model";
import UserModel from "../models/user.model";
import { getWeeklyPointsAggregate } from "./points/pointsLedger.service";

export interface UnifiedLeaderboardEntry {
  userId: string;
  points: number;
  puzzlesSolved: number;
  avgCompletionTimeMs: number | null;
}

/**
 * The single source of truth for "the weekly leaderboard" — unifies legacy
 * (schemaVersion:1) campaign points from PuzzleAttemptModel with new
 * (schemaVersion:2 session completions + referral/winner-share bonuses)
 * points from PointsLedgerModel. Previously there were four independent,
 * subtly-inconsistent sort implementations across leaderboard.controller.ts,
 * prizePool.service.ts, user.controller.ts, and rewards.service.ts — this
 * replaces all of them.
 *
 * Tiebreaker (lower average completion time ranks higher) is computed ONLY
 * from first-completion records within the week: legacy attempts flagged
 * `firstTimeSolved`, and new PointsLedger `session_completion` entries (which,
 * by construction via the GameSession first-completion guard, only ever exist
 * for genuine first completions — replays never write a ledger entry).
 */
export async function getUnifiedWeeklyEntries(
  weekStart: Date,
  weekEnd: Date,
  weekKey: string
): Promise<UnifiedLeaderboardEntry[]> {
  const legacyAgg = await PuzzleAttemptModel.aggregate([
    {
      $match: {
        pointsEarned: { $gt: 0 },
        timestamp: { $gte: weekStart, $lte: weekEnd },
      },
    },
    {
      $group: {
        _id: "$userId",
        points: { $sum: "$pointsEarned" },
        puzzlesSolved: { $sum: 1 },
        firstCompletionTimeSum: {
          $sum: { $cond: ["$firstTimeSolved", "$timeTaken", 0] },
        },
        firstCompletionCount: {
          $sum: { $cond: ["$firstTimeSolved", 1, 0] },
        },
      },
    },
  ]);

  const ledgerEntries = await getWeeklyPointsAggregate(weekKey);

  const merged = new Map<
    string,
    { points: number; puzzlesSolved: number; timeSum: number; timeCount: number }
  >();

  for (const l of legacyAgg) {
    merged.set(String(l._id), {
      points: l.points,
      puzzlesSolved: l.puzzlesSolved,
      timeSum: l.firstCompletionTimeSum,
      timeCount: l.firstCompletionCount,
    });
  }

  for (const e of ledgerEntries) {
    const existing = merged.get(e.userId) || {
      points: 0,
      puzzlesSolved: 0,
      timeSum: 0,
      timeCount: 0,
    };
    existing.points += e.points;
    existing.puzzlesSolved += e.sessionCompletions;
    if (e.avgCompletionTimeMs !== null && e.sessionCompletions > 0) {
      existing.timeSum += e.avgCompletionTimeMs * e.sessionCompletions;
      existing.timeCount += e.sessionCompletions;
    }
    merged.set(e.userId, existing);
  }

  const entries: UnifiedLeaderboardEntry[] = Array.from(merged.entries()).map(
    ([userId, d]) => ({
      userId,
      points: d.points,
      puzzlesSolved: d.puzzlesSolved,
      avgCompletionTimeMs: d.timeCount > 0 ? d.timeSum / d.timeCount : null,
    })
  );

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
