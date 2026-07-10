# API Contract — Weekly System Migration

This document covers every endpoint added, changed, or removed by the weekly-system
migration (multi-game campaigns, gameplay sessions, weekly leaderboard/payouts, wallet
withdrawals, per-campaign raffles, forum). Endpoints not listed here are unchanged.

All routes are mounted under `/api/v1`. Auth: `Authorization: Bearer <accessToken>` unless
marked **public**.

---

## 1. Campaigns (brand-facing)

### `POST /brands/campaigns` — **changed**
Brand-only. Now creates a single campaign spanning all four game types.

**Content-Type:** `multipart/form-data`

| Field | Type | Notes |
|---|---|---|
| `title`, `description` | string | required |
| `brandUrl`, `campaignUrl` | string | optional |
| `image` | file | required — feeds sliding tiles + spot-the-difference |
| `video` | file | required — ~2 min, validated for duration (`video.maxDurationSeconds`, default 130s) and size (`video.maxSizeBytes`, default 100MB) |
| `words` | string or JSON array | required — bag of words for word hunt |
| `questions` | JSON array | required — **exactly 3** brand-authored questions: `{question, choices[], correctIndex}`. No AI generation. |
| `prizeDescription` | string | required |
| `prizeUnitsAvailable` | number | optional, default 1 |
| `packageId` | string | required (basic/premium, unchanged) |
| `durationWeeks` | number | required — replaces `endMonth`/`timeLimit`/`weeksToRun` |

**Removed fields:** `gameType` (singular), `endMonth`, `timeLimit`, `weeksToRun`, `passage`.

Response includes new fields: `schemaVersion: 2`, `gameTypes: [...]`, `videoDurationSeconds`,
`videoSizeBytes`, `videoMimeType`, `durationWeeks`, `weeklyPrice`.

Old (pre-migration) campaigns remain in the database as `schemaVersion: 1` with the legacy
single-`gameType` shape and continue to be served/played exactly as before via
`GET /campaigns/:id`, `POST /campaigns/:id/submit`, etc. — **do not remove that legacy client
flow**, it's still live for old campaigns until they naturally expire.

### `GET /payments/calculate-weekly-price?packageType=basic&weeks=2` — **new**
Public. Preview cost before creating a campaign.
Response: `{ pricing: { packageType, weeklyPrice, durationWeeks, totalAmount, timeLimitHours } }`.
Current weekly prices: Basic = ₦7,000/week, Premium = ₦10,000/week (config-driven, see §7).

### `GET /payments/calculate-proration` — **legacy, unused by new flow**
Still present for reference; the new campaign creation flow never calls it.

### `GET /campaigns/:campaignId/completion` — **behavior changed, same route**
Now branches internally: v2 campaigns check the session first-completion guard, legacy
campaigns check attempt history as before. Response shape unchanged:
`{ hasCompletedByCurrentUser: boolean }`. Use this before starting a session to show the
**"replay is just for fun"** warning if `true`.

---

## 2. Gameplay Sessions — **new** (v2 campaigns only)

Flow: start session → play all 4 games → watch video → answer 3 quiz questions (unlimited
retries) → complete.

| Method & Path | Body | Notes |
|---|---|---|
| `POST /sessions/start` | `{ campaignId }` | Creates a new session. Only for `schemaVersion:2` campaigns with `status:"active"`. |
| `POST /sessions/:id/games/:gameType/start` | — | `gameType` ∈ `sliding_puzzle, card_matching, spot_the_difference, word_hunt` |
| `POST /sessions/:id/games/:gameType/complete` | `{ movesTaken?, timeTakenMs? }` | Client values are stored but informational only — server timestamps are authoritative |
| `POST /sessions/:id/video/start` | — | Requires all 4 games completed first |
| `POST /sessions/:id/video/complete` | — | |
| `POST /sessions/:id/quiz/attempt` | `{ answers: number[] }` | Unlimited retries. Returns `{ score, allCorrect, attemptsSoFar, firstAttemptScore }`. First attempt's score is preserved separately for brand recall reporting even after retries. |
| `POST /sessions/:id/complete` | — | Finalizes the session. See below. |

**`POST /sessions/:id/complete` response:**
```json
{
  "success": true,
  "isFirstCompletion": true,
  "pointsAwarded": 7,
  "totalCompletionTimeMs": 184032,
  "voided": false,
  "flagged": false
}
```
- Idempotent: calling `/complete` again on an already-completed session returns the same
  result, never re-awards.
- `isFirstCompletion: false` (replay) → `pointsAwarded: 0`, no raffle ticket, no leaderboard
  entry. The client should never treat a replay as a "win" — check
  `GET /campaigns/:campaignId/completion` **before** starting a session to warn the player.
- `voided: true` → anti-cheat hard-void (implausible timing); no points/ticket/leaderboard
  entry regardless of first/replay.
- `flagged: true` → session completed normally (points awarded if first completion) but is
  marked for admin review (soft anti-cheat flag).

All session endpoints return `400` with a descriptive message if called out of order (e.g.
completing a game stage that was never started, or attempting the quiz before the video is
watched).

---

## 3. Leaderboard — **changed**

| Method & Path | Status |
|---|---|
| `GET /leaderboards/weekly` | **unchanged path**, rewritten internals — unifies legacy + v2 + referral/winner-share bonus points, single tiebreaker (`points desc, avgTime asc` from first-completions only) |
| `GET /leaderboards/weekly/:weekKey` | unchanged path, same rewrite |
| `GET /leaderboards/all-time` | unchanged (legacy-attempt points only for now — v2 session points not yet folded in) |
| `GET /leaderboards/monthly` | **removed** |
| `GET /leaderboards/monthly/:monthKey` | **removed** |

Weekly leaderboard entry shape (unchanged): `{ position, userId, fullName, username, avatar,
puzzlesSolved, points, avgCompletionTimeMs, avgCompletionTimeSec }`.

### `GET /user/gamer/profile` (`getGamerProfile`) — **response shape changed**
- `profile.points` no longer has `monthKey`/`puzzlePoints`/`referralPoints` — now just
  `{ weekKey, totalPoints }` (unified weekly total, same source as the public leaderboard).
- `profile.analytics.referral` no longer has `monthKey`/`pointsThisMonth`/
  `referralCountThisMonth`/`leaderboardPosition` — now `{ weekKey, totalReferrals,
  successfulReferrals, pendingReferrals, pointsThisWeek, referralCountThisWeek }`. The
  referral leaderboard itself is retired; referrals convert into points on the main weekly
  leaderboard instead.

---

## 4. Referrals — **behavior changed, no route changes**

- Referrer now earns **5 points** (was 3), credited only after the referee's **lifetime
  points reach 21** (≈3 session completions), not on the referee's first solve.
- The **+1 signup bonus point** previously given to new users on referral capture has been
  **removed** entirely.
- `GET /referrals/my-stats`, `/referrals/summary`, `/referrals/events` — unchanged routes,
  but `pointsAwarded`/summary numbers now reflect the new 5pt/21pt mechanics for referrals
  captured going forward.

---

## 5. Wallet & Withdrawals — **new**

| Method & Path | Body | Notes |
|---|---|---|
| `GET /wallet/balance` | — | `{ balance, currency }` |
| `GET /wallet/transactions?limit=50` | — | Ledger history |
| `POST /wallet/bank-accounts` | `{ accountNumber, bankCode, bankName }` | Resolves account name via Paystack before saving |
| `GET /wallet/bank-accounts` | — | |
| `DELETE /wallet/bank-accounts/:id` | — | |
| `POST /wallet/withdrawals` | `{ bankAccountId, amount, idempotencyKey }` | `idempotencyKey` **required** — client-generated, reused on retry to avoid double-withdrawal |
| `GET /wallet/withdrawals` | — | |
| `GET /wallet/withdrawals/:id` | — | |
| `POST /payments/webhook/paystack-transfer` | — | Paystack webhook, no auth |

Withdrawal status lifecycle: `pending → processing → paid` (happy path) or `→ failed`
(insufficient balance, provider error, or a `transfer.failed`/`transfer.reversed` webhook —
in all failure cases the debited amount is automatically credited back to the wallet).

Weekly top-10 cash rewards are credited to wallets automatically by the Monday scheduler job
(admin can also trigger via `POST /payouts/process`, unchanged route, now actually moves
money instead of just flipping a status field).

---

## 6. Raffles — **new**

| Method & Path | Notes |
|---|---|
| `GET /raffles/campaign/:campaignId/current` | **public** — this week's ticket count, eligibility floor, and draw status for a campaign |
| `GET /raffles/my-tickets` | Authenticated player's tickets across all campaigns + `eligibleThisWeek` flag |
| `POST /raffles/:campaignId/draw` | admin — triggers a draw for the current (or `{weekKey}` body-specified) week; also runs automatically every Monday |
| `PATCH /raffles/:drawId/fulfillment` | brand/admin — `{ fulfillmentStatus, fulfillmentNotes? }`, brand manages prize shipping/delivery status |
| `GET /raffles/:drawId/verify` | **public** — recomputes the winner from the stored seed + ticket snapshot; `verification.valid` confirms no tampering |

- 1 ticket per player per campaign, earned only on first completion (never replays).
- Eligibility floor: a player needs ≥N distinct campaign completions that week to have a
  banked ticket count in a draw, where N = min(3, number of active v2 campaigns that week).
  Tickets still bank below the floor — they just aren't eligible until it's met.
- Exactly 1 winner per campaign per week (when eligible entries exist).

---

## 7. Admin Config — **new**

| Method & Path | Notes |
|---|---|
| `GET /admin/config` | admin — all effective config values (DB overrides merged over defaults) |
| `PUT /admin/config/:key` | admin — `{ value, description? }` |

Key values relevant to the frontend: `pricing.basic.weeklyPrice`, `pricing.premium.weeklyPrice`,
`payout.playerSharePercent` / `payout.platformSharePercent` (default 50/50, may move to 60/40),
`payout.rankDistribution`, `raffle.eligibilityFloorCap` (default 3), `referral.pointsThreshold`
(default 21), `referral.referrerBonusPoints` (default 5), `points.sessionCompletionPoints`
(default 7), `forum.winnerShareBonusPoints` (default 5), `campaign.quizQuestionCount` (default 3),
`video.maxDurationSeconds`, `video.maxSizeBytes`.

---

## 8. Forum — **new**

| Method & Path | Body | Notes |
|---|---|---|
| `POST /forum/threads` | `{ title, category? }` | |
| `GET /forum/threads` | — | |
| `POST /forum/threads/:id/posts` | `{ body, imageUrls? }` | |
| `GET /forum/threads/:id/posts` | — | excludes `moderationStatus: "removed"` posts |
| `POST /forum/posts/:id/like` | — | idempotent |
| `DELETE /forum/posts/:id/like` | — | idempotent |
| `POST /forum/posts/:id/flag` | `{ reason }` | |
| `GET /forum/moderation/flags?status=open` | — | admin |
| `PATCH /forum/moderation/flags/:id` | `{ status, hidePost? }` | admin — `status` ∈ `resolved, dismissed` |
| `POST /forum/winner-submissions` | `{ campaignId, postUrl, claimedLikeCount? }` | Winner submits their social share for verification |
| `GET /forum/winner-submissions/mine` | — | |
| `GET /forum/winner-submissions?status=` | — | admin |
| `POST /forum/winner-submissions/:id/verify` | `{ adminNotes? }` | admin — credits 5 bonus points (config-driven) into the currently-open week |
| `POST /forum/winner-submissions/:id/reject` | `{ adminNotes? }` | admin |

Winner-share submission status lifecycle: `submitted → verified` or `submitted → rejected`
(terminal either way — a rejected submission can't later be verified and vice versa).

---

## 9. Removed Endpoints

- `GET /leaderboards/monthly`, `GET /leaderboards/monthly/:monthKey`
- `GET /prize-pools/daily/:date`, `POST /prize-pools/daily/calculate`
- `GET /prize-table/today`, `GET /prize-table/date/:date`
- `GET /puzzles`, `GET /puzzles/:id`, `POST /puzzles/:id/submit` (were already dead/unmounted before this migration)

## 10. Config-Driven Values Frontends Should Not Hardcode

Several numbers frontends may be tempted to hardcode are now admin-adjustable via §7 and can
change without a deploy: weekly prices, the 50/50 player/platform split, top-10 rank
distribution %, the 21-point referral threshold, the 7pt session-completion award, the 3
quiz-question count, and the raffle eligibility floor cap. Where practical, fetch these from
`GET /admin/config` (or a public subset endpoint, if one is added later) rather than
hardcoding them client-side.
