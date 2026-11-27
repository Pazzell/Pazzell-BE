# Legacy removal audit — Pazzell brain-training repositioning

Branch: `pazzell-brain-training` (cut from `AWS_Setup` @ `d8af93f`).

## 1. What the repo actually is

| Layer | Finding |
| --- | --- |
| Runtime | Node 20, Express 4, TypeScript (`ts-node-dev` in dev, `tsc` build), flat layout: `controllers/`, `routes/`, `models/`, `services/`, `utils/`, `middlewares/`, `tests/` |
| DB | MongoDB via Mongoose 8. String ids for cross-document references (`userId: string`), `{ timestamps: true }` everywhere. No multi-document transactions (no replica-set assumption) — idempotency is enforced with unique indexes |
| Cache | Redis (`ioredis`, `ioredis-mock` under `NODE_ENV=test`). Holds the user session JSON keyed by user id, plus online-presence sets |
| Auth | JWT access + refresh tokens (`utils/jwt.ts`), `Authorization: Bearer` header, `isAuthenticated` + `authorizeRoles(...)` in `utils/auth.ts`. Email/password with 4-digit activation code, Google sign-in through firebase-admin. Roles stored on `User.role`: `gamer`, `brand`, `admin`. Brands also have a `Brand` profile document |
| Storage | `getStorageService()` factory: Firebase Storage (default) or S3 (`STORAGE_PROVIDER=aws`). Uploads arrive through `multer.memoryStorage()` |
| Payments in | Paystack (`services/payment/paystack.service.ts`): initialize, verify, HMAC-SHA512 webhook |
| Payments out | Paystack Transfers (`services/transfer/`) for wallet withdrawals |
| Wallet | `Wallet` + append-only `WalletTransaction` ledger with unique `idempotencyKey`, `BankAccount`, `Withdrawal`, nightly reconciliation job |
| Jobs | `node-cron` in `services/scheduler/index.ts` |
| Config | `Config` collection + in-process cache with code defaults (`services/config/config.service.ts`), admin-editable via `/admin/config` |
| Email | Nodemailer/SendGrid or SES behind `getEmailService()` |
| Deploy | Dockerfile (runs `npm run dev`), CircleCI stub that only checks out |
| Tests | Jest + ts-jest + supertest + mongodb-memory-server |

Baseline before any change: `7 of 17` test suites failing (auth, app, error middleware,
db util, gameSession, puzzle, leaderboard). Those failures are pre-existing.

## 2. Data safety — backup and rollback note

**No collection is dropped and no destructive migration is run by this work.** Removing a
Mongoose model only removes the code; the collection and every document in it stay in MongoDB.

Legacy collections left untouched in the database:

`gamesessions`, `leaderboards`, `pointsledgers`, `puzzlecampaigns`, `packages`, `payouts`,
`raffledraws`, `raffletickets`, `referrals`, `referralevents`, `winnersharesubmissions`,
`transactions` (old campaign payment records), `tickets`, `meetings`.

Legacy fields left on existing documents but no longer in the schema (Mongoose ignores them):
`users.analytics`, `users.puzzlesSolved`, `users.privacy`, `users.notifications.referralBonusAlerts`,
`users.notifications.leaderboardUpdates`, `brands.campaigns`, `brands.analytics`.

Legacy `configs` rows (`pricing.*`, `payout.*`, `raffle.*`, `referral.*`, `points.*`, `forum.*`,
`video.*`, `anticheat.*`, `campaign.quizQuestionCount`) are left in place and ignored.

Before anyone decides to drop those collections later:

1. Back up: `mongodump --uri "$DB_URI" --out ./backup-$(date +%F)` (or per collection with
   `--collection <name>`). Verify with `mongorestore --dryRun`.
2. Drop only after the backup is verified and the new build has run in production for a
   full billing cycle (30 days), since `transactions` and `payouts` are financial history.
3. Rollback of the code: `git checkout AWS_Setup`. Because nothing was dropped or rewritten,
   the old build runs against the same database unchanged. New collections created by this
   branch are additive and are ignored by the old code.
4. Rollback of a drop: `mongorestore --uri "$DB_URI" --nsInclude "<db>.<collection>" ./backup-<date>`.

The only write to existing documents is additive: new `User` fields (`proUntil`,
`nonCampaignPlaysSinceCampaign`) default on read, and `Brand` gains `logoUrl` / `websiteUrl`.

## 3. Removed

### Routes
| Mount | File |
| --- | --- |
| `/leaderboards/*` | `routes/leaderboard.route.ts` |
| `/referrals/*` | `routes/referral.route.ts` |
| `/raffles/*` | `routes/raffle.route.ts` |
| `/sessions/*` (4-game + video + quiz funnel) | `routes/session.route.ts` |
| `/packages*` | `routes/package.route.ts` |
| `/campaigns*` (old puzzle campaigns, AI question generation) | `routes/campaign.route.ts` (replaced) |
| `/brands`, `/brands/campaigns`, `/brands/analytics` | `routes/brand.route.ts` (replaced) |
| `/payments/calculate-weekly-price`, `/payments/initialize`, `/payments/verify/:reference`, `/payments/transactions`, `/campaigns/:id/budget`, `/prize-pools/weekly/summary`, `/payouts/*`, `/platform/earnings` | `routes/payment.route.ts` (replaced) |
| `/forum/winner-submissions*` | part of `routes/forum.route.ts` |
| `/admin/clear-all-data`, `/gamers`, `/profile/privacy` | part of `routes/user.route.ts` |
| `/meetings*` (never mounted in `app.ts`) | `routes/meeting.route.ts` |

### Controllers
`leaderboard`, `referral`, `raffle`, `session`, `package`, `payout`, `campaign` (old), `brand` (old),
`payment` (old), `ticket` (no route), `meeting` (unmounted), `asset` (only used by `ticket`).

### Services and utils
`services/leaderboard.service.ts`, `services/prizePool.service.ts`, `services/raffle.service.ts`,
`services/referral.service.ts`, `services/points/`, `services/session/` (game session + anti-cheat),
`services/video/` (ffprobe validation), `services/queue/` (SQS payment queue) and
`services/notification/` (SNS publish) — both were only ever called by the old campaign payment
flow — `utils/scheduler.ts`, `utils/weekBoundary.ts`, `utils/zoom.ts`,
`utils/jimpTypes.ts`, `scripts/fix-s3-urls.ts` (one-off, targets `puzzlecampaigns`).

### Models (code only; collections stay, see section 2)
`gameSession`, `leaderboard`, `pointsLedger`, `puzzleCampaign`, `package`, `payout`, `raffleDraw`,
`raffleTicket`, `referral`, `referralEvent`, `winnerShareSubmission`, `transaction`, `ticket`, `meeting`.

### Jobs
Weekly payout + raffle rollover (Monday 00:00), hourly old-campaign expiry and abandoned-session sweep.

### Config keys
`pricing.basic.weeklyPrice`, `pricing.premium.weeklyPrice`, `payout.*`, `raffle.eligibilityFloorCap`,
`referral.*`, `points.sessionCompletionPoints`, `forum.winnerShareBonusPoints`,
`campaign.quizQuestionCount`, `video.*`, `anticheat.*`.

### Env vars (no longer read)
`AI_PROVIDER`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `PAYMENT_QUEUE_PROVIDER`,
`AWS_SQS_PAYMENT_QUEUE_URL`, `AWS_SQS_PAYMENT_DLQ_URL`, `NOTIFICATION_PROVIDER`,
`AWS_SNS_PAYMENT_TOPIC_ARN`, `AWS_SNS_CAMPAIGN_TOPIC_ARN`.
Already unread before this work (safe to delete from `.env`): `DEFAULT_PAYMENT_GATEWAY`,
`INTERSWITCH_*`, `NEXT_PUBLIC_GOOGLE_CLIENT_ID`, `SECRET_TOKEN`, `VERIFICATION_TOKEN`,
`Pazzell_Open_Api_Key`, `AWS_SQS_PAYMENT_DLQ_URL`.

### Dependencies
Removed: `ffprobe-static`, `@aws-sdk/client-sqs`, `@aws-sdk/client-sns`, `jimp` (unused),
`firebase` (client SDK, unused; `firebase-admin` stays).
Added: `sharp` (image validation, resize, WEBP) and `express-rate-limit`.

### Tests
Removed: `antiCheat`, `gameSession.service`, `leaderboard`, `prizePool.service`, `puzzle`,
`raffle.service`, `referral.service`.
Rewritten for the new product: `scheduler`, `auth`, `analytics.controller`, `utils/db`, and the
winner-share half of `forum.service`. `wallet.service` is unchanged and still passes.

### Docs
`API_CONTRACT_WEEKLY_MIGRATION.md`, `API_DOCUMENTATION.md`, `API_TESTING_GUIDE.md`,
`DAILY_PRIZE_TABLE.md`, `PAYMENT_SYSTEM.md`, `PAYMENT_SYSTEM_WALKTHROUGH.md`, `REFERRAL_API.md`,
`FRONTEND_INTEGRATION_NOTES.md`, `docs/FRONTEND_INTEGRATION.md` (replaced by
`docs/frontend-integration.md`), `docs/postman_collection.json`.

### Pages
None. This repository is API-only; the only HTML is the welcome page in `app.ts`, which is kept and retitled.

## 4. Kept unchanged

- Auth: `routes/auth.route.ts`, `utils/auth.ts` guards, `utils/jwt.ts`, activation and reset mails.
- Wallet: `models/wallet`, `walletTransaction`, `bankAccount`, `withdrawal`, `routes/wallet.route.ts`,
  `controllers/wallet.controller.ts`, `services/transfer/*`, the nightly reconciliation job,
  the Paystack transfer webhook.
- Storage, email and notification factories; `aws/awsClients.ts` (minus the SQS client).
- `Config` model and `/admin/config` routes (keys replaced).
- Forum threads, posts, likes, flags and moderation (not on the removal list; only the
  winner-share reward flow is removed).
- Error handling (`CatchAsyncError`, `ErrorMiddleware`), Redis and DB utils.

## 5. Changed

| Item | Change |
| --- | --- |
| `models/user.model.ts` | Drop reward-economy fields from the schema; add `proUntil`, `nonCampaignPlaysSinceCampaign`. Stored player role stays `gamer` (this is the spec's `user` role) so no role migration is needed |
| `models/brand.model.ts` | Add `logoUrl`, `websiteUrl`; drop `campaigns`, `analytics` from the schema. Brand stays a role plus an attached profile document, as it already is |
| `utils/auth.ts` | `isAuthenticated` still validates the session in Redis but role and plan are re-read from MongoDB on every request, so a cached session can never grant a stale role or Pro status. Removes the `console.log` of the Authorization header |
| `controllers/auth.controller.ts` | Referral capture at signup removed |
| `controllers/user.controller.ts` | Profile responses no longer carry points, leaderboard position or referral stats; they carry the plan instead |
| `controllers/analytics.controller.ts` | "Games played" counts completed Match and Trivia attempts |
| `services/wallet/wallet.service.ts` | Adds `creditWallet(userId, amount, reason)`; ledger reason gains `reward` (`weekly_payout` stays valid for historical rows) |
| `services/payment/paystack.service.ts` | Generic metadata, configurable currency, signature checked against the raw request body with a timing-safe compare |
| `services/config/config.service.ts` | New keys: timer range, Match default timer, card-count bounds, interruption threshold, Pro and campaign price/duration/currency |
| `services/scheduler/index.ts` | New jobs: campaign expiry, Pro-expiry quiz locking, wallet reconciliation |
| `middlewares/error.ts`, `utils/ErrorHandler.ts` | Errors can carry a machine-readable `code` and `details` (`CAMPAIGN_REQUIRED`, `UPGRADE_REQUIRED`, …) |
| `app.ts` | New routers, raw-body capture for webhooks, JSON body limit 50mb → 1mb, welcome page retitled and served on `/` only (unknown paths now 404) |
| `controllers/wallet.controller.ts` | One hardening: the withdrawal `idempotencyKey` lookup is scoped to the caller and must be a string (it previously could return another user's withdrawal) |
| `firebaseConfig.ts` | Initialised only when the service-account variables are set, so the app boots without Firebase when S3 is the storage provider; bucket name via `FIREBASE_STORAGE_BUCKET` |
| `tests/setup.ts`, `jest.config.js`, `tests/env.ts` | Suite pinned to in-memory services, run serially (parallel mongod start-up was the cause of most of the red baseline) |
| `README.md`, `.env.example` | Rewritten for the new product |

## 6. Things found during recon that are outside this change

Reported, not silently changed:

1. `credentials.txt`, `secrets.txt`, `firebase.txt` and `paystack-recovery-codes.txt` are listed in
   `.gitignore` but are **tracked in git**. They should be removed from the index and the
   secrets rotated.
2. `POST /auth/google` accepts `{ email, googleId }` with no `idToken` and logs the caller in as
   that email. Anyone can sign in as any existing account.
3. `dist/` (stale compiled output of the old product) is committed.
4. `POST /refresh` and `/registration`, `/activate-user`, `/login` in `routes/user.route.ts` are an
   older duplicate of the `/auth/*` flow.
