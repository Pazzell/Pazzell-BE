# Frontend Integration Notes — Campaign Session & Live Stats (2026-07-15)

No endpoint names, methods, or payload shapes changed in this pass. This doc exists because
the fixes made today changed *when* live stats move and *why* session-start could fail — both
are things the frontend's error handling / polling assumptions should account for, even though
nothing needs to change in the request/response code itself.

All routes are mounted under `/api/v1`. Auth: `Authorization: Bearer <accessToken>` unless
marked **public**.

---

## 1. Campaign session flow (unchanged shapes — reference)

One session covers the whole funnel: 4 games + 1 video + 1 quiz. Play them in this order;
each stage's `/complete` (or `/attempt`, for quiz) requires the previous stage to be done.

| Method & Path | Body | Notes |
|---|---|---|
| `POST /sessions/start` | `{ campaignId }` | Creates a session (`status: "in_progress"`). Only works for `status: "active"` campaigns. **Now reliable on the first call** — see §3. |
| `POST /sessions/:id/games/:gameType/start` | — | `gameType` ∈ `sliding_puzzle, card_matching, spot_the_difference, word_hunt` |
| `POST /sessions/:id/games/:gameType/complete` | `{ movesTaken?, timeTakenMs? }` | Client-reported values are stored but informational only — server timestamps are authoritative for anti-cheat and scoring |
| `POST /sessions/:id/video/start` | — | Requires all 4 games completed first |
| `POST /sessions/:id/video/complete` | — | |
| `POST /sessions/:id/quiz/attempt` | `{ answers: number[] }` | Unlimited retries. Returns `{ score, allCorrect, attemptsSoFar, firstAttemptScore }` |
| `POST /sessions/:id/complete` | `{ totalMoves? }` | Finalizes the session — only place points are awarded and stats increment. **Idempotent**: calling it again on an already-completed session just returns the original result. |

**`POST /sessions/:id/complete` response:**
```json
{
  "success": true,
  "isFirstCompletion": true,
  "pointsAwarded": 7,
  "totalCompletionTimeMs": 184032,
  "totalMoves": 142,
  "voided": false,
  "flagged": false
}
```

Errors from any of these endpoints throw a 400 with a specific message (e.g. "All four games
must be completed first", "The video must be watched first") — surface these directly rather
than a generic "something went wrong," they're meant to explain exactly what's missing.

A session that sits `in_progress` for 6+ hours is now auto-marked `abandoned` by a background
job and can no longer be completed — if a returning player's old session 400s with
`"Session is abandoned, cannot be completed"`, start a new one rather than retrying the old
`sessionId`.

---

## 2. `GET /analytics/app` — **values now correct, no shape change**

**Public**, no auth required. Response shape is unchanged:

```json
{
  "success": true,
  "analytics": {
    "totalGamesPlayed": 128,
    "gamesPlayedToday": 4,
    "currentlyPlaying": 2,
    "onlineUsers": 9
  }
}
```

**What changed:** `totalGamesPlayed` and `gamesPlayedToday` previously counted a session the
instant `POST /sessions/start` was called (before any game, video, or quiz was touched). They
now only count sessions where `status: "completed"` — i.e. after `POST /sessions/:id/complete`
has actually succeeded. `gamesPlayedToday` is keyed off the session's completion time, not its
start time.

**Practical effect for the frontend:** if you poll this endpoint while a player is mid-session,
don't expect the counters to move until they hit the final Submit button. If any UI copy or
optimistic-update logic assumed "games played" ticks up on "Start Playing," that assumption no
longer holds (and, since the fix, never should have).

`currentlyPlaying` and `onlineUsers` are unaffected — they come from separate Redis presence
sets (`POST /analytics/game/start|stop`, `POST /analytics/user/online|offline`) and were never
tied to session completion.

---

## 3. Why session-start could fail on the first click

Root cause was a backend startup-ordering bug, not anything the frontend was doing wrong: the
server used to start accepting HTTP traffic before its MongoDB connection finished, so the
first request to hit a DB-backed route right after a cold start (e.g. the app waking up from
idle) could fail with a generic 500. This is fixed — the server now waits for the DB connection
before opening the port. No retry-on-first-failure workaround should be needed anymore, but it
doesn't hurt to leave one in place defensively for the rare case the DB itself is genuinely
unreachable.
