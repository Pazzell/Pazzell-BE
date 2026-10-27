# Pazzell API

Backend for Pazzell: image and short-definition trivia across many topics.

- **Trivia** — pick a topic, a timer and a number of cards; an optional practice mode points
  at the correct option. Image cards can be imported from Wikimedia by an admin.
- **Custom trivia** — quizzes users create and share by link. Cards can be written by hand or
  drafted with AI (Claude, OpenAI or Gemini) from a description or an uploaded document, then reviewed.
- **Brand campaigns** — sponsored trivia that freemium players play periodically.
- **Freemium and Pro** player tiers.
- **Wallet** — withdraw-only; holds rewards and pays them out to a bank account.

There are no points, leaderboards, rankings, ads, prize draws or referral rewards.

## Documentation

| Document | For |
| --- | --- |
| [`docs/frontend-integration.md`](docs/frontend-integration.md) | Every endpoint, request/response shapes, error codes, state machines, the artifact registry |
| [`docs/legacy-removal-audit.md`](docs/legacy-removal-audit.md) | What was removed, kept and changed in the repositioning, with the data backup and rollback note |
| [`EMAIL_CONFIGURATION.md`](EMAIL_CONFIGURATION.md) | Email provider setup |
| [`.env.example`](.env.example) | All environment variables |

## Stack

Node 20, Express 4, TypeScript, MongoDB (Mongoose 8), Redis (sessions and presence), JWT auth,
Paystack (payments in and bank transfers out), S3 or Firebase Storage for images, `sharp` for
image processing, `node-cron` for scheduled jobs, Jest + supertest + mongodb-memory-server.

## Getting started

```bash
npm install
cp .env.example .env      # then fill it in
npm run seed              # example topics, settings, an admin and a sample brand
npm run dev               # http://localhost:4000
```

| Script | Does |
| --- | --- |
| `npm run dev` | Start with reload |
| `npm run build` / `npm start` | Compile to `dist/` and run |
| `npm test` | Run the test suite (in-memory MongoDB and Redis; no external service is touched) |
| `npm run typecheck` | Type-check without emitting |
| `npm run seed` | Idempotent seed; inserts only what is missing |

The seed prints the generated admin and brand passwords once, unless `SEED_ADMIN_PASSWORD` /
`SEED_BRAND_PASSWORD` are set. It refuses to run with `NODE_ENV=production` unless
`SEED_CONFIRM=yes`.

## Project layout

```
app.ts, server.ts        Express app and startup
routes/                  One router per area, mounted under /api/v1
controllers/             HTTP handlers
services/
  config/                Settings store (admin-editable, with code/env defaults)
  plan/                  getPlan(), Pro activation, and policy.ts (all Pro-gated rules)
  payment/               Paystack client and idempotent payment confirmation
  trivia/                The session engine shared by topics, custom quizzes and campaigns
  customQuiz/            Freemium quiz locking
  quizGen/               Draft cards from an uploaded document (text extraction + prompts)
  ai/                    AI providers (Claude, OpenAI, Gemini), chosen by AI_PROVIDER
  campaign/              Activation, expiry, rotation and the interruption gate
  wallet/, transfer/     Ledger and bank withdrawals
  upload/, storage/      Image validation/processing and storage providers
  scheduler/             Cron jobs
models/                  Mongoose models
scripts/seed.ts          Seed script
tests/                   Jest suites
```

## How the main rules are enforced

- **Roles.** `gamer` (the player), `brand` and `admin`. `isAuthenticated` re-reads the user from
  MongoDB on every request, so role and plan can never be stale. Admin routes sit behind
  `authorizeRoles("admin")` on the server.
- **Pro.** `User.proUntil` (UTC). A player is Pro while `proUntil > now`, computed by
  `getPlan()` on every request. Price and duration come from settings. Every Pro-gated rule is in
  `services/plan/policy.ts`.
- **Payments.** Pro and campaigns are paid through Paystack only. Each checkout has a `Payment`
  record. Confirmation comes from the signed webhook and/or server-side verification and is
  idempotent: a webhook delivered twice never extends Pro twice or activates a campaign twice.
  The amount and currency reported by the gateway must match the record.
- **Quiz integrity.** The server holds the correct answer and the deadline for every question.
  The client never receives the answer before a question is settled (except in practice mode,
  where the player asked for it to be marked), and late submissions are timeouts.
  Each question's clock starts when the server first serves it; a refresh resumes the same
  question with the time that is left.
- **Timer.** One global range, 1 to 15 seconds, for every game. It is chosen by the player and is
  not part of any topic or campaign.
- **Campaign gate.** A freemium player who has completed N non-campaign trivias must complete a
  campaign trivia before starting another. Starting one while a campaign is owed returns
  `403 CAMPAIGN_REQUIRED` with the campaign to play.
- **Campaign window.** A campaign goes live when its payment is confirmed and ends exactly the
  configured number of days later. Delivery always checks the end date, so a late job can never
  cause an ended campaign to be served.
- **Wallet.** Withdraw-only. `creditWallet(userId, amount, reason)` in
  `services/wallet/wallet.service.ts` is the entry point for future reward features. Nothing in
  gameplay calls it yet.

## Scheduled jobs

| When | Job |
| --- | --- |
| Every 10 minutes and at startup | End campaigns past their window; lock the extra quizzes of expired Pro accounts |
| Hourly | Close trivia sessions left open for more than 6 hours |
| 03:00 daily | Reconcile wallet balances against the ledger |

All three are sweeps. The rules they apply are also enforced on read.

## Webhooks to register with Paystack

- Charges: `{API_ORIGIN}/api/v1/payments/webhook/paystack`
- Transfers (withdrawals): `{API_ORIGIN}/api/v1/payments/webhook/paystack-transfer`

## Deployment notes

- Rate limiters keep their counters in process memory. With more than one instance, back them
  with a shared store.
- Set `TRUST_PROXY` when running behind a load balancer.
- Legacy collections from the previous product are left in the database untouched; see the audit
  for the list and the backup procedure before dropping any of them.
