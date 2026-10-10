// Per-question clock rules.
//
// A question's clock starts when the server first serves it (servedAt) and runs for the
// player's chosen timerSeconds (deadlineAt). A submission is accepted until
// deadlineAt + the network grace window; anything later is a timeout. The client's
// clock and any client-sent timestamps are never used.

export const deadlineFrom = (servedAt: Date, timerSeconds: number): Date =>
  new Date(servedAt.getTime() + timerSeconds * 1000);

export const isPastDeadline = (deadlineAt: Date, now: Date, graceMs: number): boolean =>
  now.getTime() > deadlineAt.getTime() + graceMs;

export const remainingMs = (deadlineAt: Date, now: Date): number =>
  Math.max(0, deadlineAt.getTime() - now.getTime());

// Attempts left open this long are closed as abandoned by the scheduler.
export const STALE_ATTEMPT_MS = 6 * 60 * 60 * 1000;
