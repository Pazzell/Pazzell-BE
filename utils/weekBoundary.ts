/**
 * Single source of truth for "the week" (Monday 00:00:00.000 -> Sunday 23:59:59.999,
 * local server time). Previously duplicated in prizePool.service.ts, leaderboard.controller.ts,
 * and user.controller.ts — those now import from here instead of re-deriving it.
 */

export interface WeekBounds {
  weekStart: Date;
  weekEnd: Date;
  weekKey: string;
}

export function getWeekBounds(date: Date = new Date()): WeekBounds {
  const dayOfWeek = date.getDay();
  const daysFromMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;

  const weekStart = new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate() - daysFromMonday
  );
  weekStart.setHours(0, 0, 0, 0);

  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 6);
  weekEnd.setHours(23, 59, 59, 999);

  const weekKey = `${weekStart.toISOString().slice(0, 10)}_to_${weekEnd
    .toISOString()
    .slice(0, 10)}`;

  return { weekStart, weekEnd, weekKey };
}

export function getWeekKey(date: Date = new Date()): string {
  return getWeekBounds(date).weekKey;
}

export function parseWeekKey(weekKey: string): { weekStart: Date; weekEnd: Date } {
  const [startStr, endStr] = weekKey.split("_to_");
  const weekStart = new Date(startStr);
  weekStart.setHours(0, 0, 0, 0);
  const weekEnd = new Date(endStr);
  weekEnd.setHours(23, 59, 59, 999);
  return { weekStart, weekEnd };
}

/** The weekKey immediately preceding the current one — used by the Monday rollover job. */
export function getPreviousWeekKey(date: Date = new Date()): string {
  const { weekStart } = getWeekBounds(date);
  const prevWeekAnchor = new Date(weekStart);
  prevWeekAnchor.setDate(prevWeekAnchor.getDate() - 1); // last Sunday of prior week
  return getWeekKey(prevWeekAnchor);
}
