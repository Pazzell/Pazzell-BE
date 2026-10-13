# Pazzell API — frontend integration guide

Everything the frontend needs to build trivia (image and short-definition questions across
topics), custom trivia, brand campaigns, Pro and the wallet screens. This document describes the API as implemented on the
`pazzell-brain-training` branch.

- [1. Conventions](#1-conventions)
- [2. Global settings and the timer](#2-global-settings-and-the-timer)
- [3. Auth, profile and roles](#3-auth-profile-and-roles)
- [4. Plans, Pro and payments](#4-plans-pro-and-payments)
- [5. Match (removed)](#5-match-removed)
- [6. Trivia sessions](#6-trivia-sessions-topics-custom-quizzes-and-campaigns)
- [7. Custom trivia](#7-custom-trivia)
- [8. Brand campaigns](#8-brand-campaigns)
- [9. Admin](#9-admin)
- [10. Uploads](#10-uploads)
- [11. Wallet](#11-wallet)
- [12. Error codes](#12-error-codes)
- [13. Rate limits](#13-rate-limits)
- [14. Environment variables](#14-environment-variables)
- [15. What was removed](#15-what-was-removed)

---

## 1. Conventions

| | |
| --- | --- |
| Base URL | `{API_ORIGIN}/api/v1` |
| Auth | `Authorization: Bearer <accessToken>` on every route marked **Auth** |
| Bodies | JSON (`Content-Type: application/json`), or `multipart/form-data` where a file is sent |
| Ids | 24-character hex strings |
| Dates | ISO 8601, UTC |
| Success | `{ "success": true, ... }` |

**Errors** always look like this. `code` and `details` are present on the errors listed in
[section 12](#12-error-codes); branch on `code`, never on `message`.

```json
{ "success": false, "message": "Play a sponsored trivia to keep going.", "code": "CAMPAIGN_REQUIRED", "details": { } }
```

Two auth failures have a different shape (kept from the existing API):

| Situation | Status | Body |
| --- | --- | --- |
| No `Authorization` header | 401 | `{ "error": "Authentication Failed" }` |
| Invalid/expired token, or logged out | 400 | `{ "success": false, "message": "..." }` |
| Wrong role | 403 | `{ "success": false, "message": "Role: gamer is not allowed to access this resource" }` |

A resource that belongs to someone else returns **404**, not 403, so ids cannot be probed.

**The server is authoritative.** Scores, timestamps, plan status, counters and correct answers
are never read from the client. Sending them has no effect.

---

## 2. Global settings and the timer

### `GET /settings/game` — public

```json
{
  "success": true,
  "settings": {
    "timer": { "minSeconds": 1, "maxSeconds": 15, "defaultSeconds": 5 },
    "trivia": { "minCards": 5, "maxCards": 30 },
    "customQuiz": { "freeLimit": 1, "minCardsToPublish": 5 },
    "pro": { "amount": 1500, "currency": "NGN", "durationDays": 30 },
    "campaign": { "amount": 15000, "currency": "NGN", "durationDays": 30, "interruptionThreshold": 10 }
  }
}
```

Fetch this once at startup and build the setup screens from it. Do not hard-code prices.
`timer.defaultSeconds` is the value the timer picker starts on (it was `matchDefaultSeconds`).

### The timer rule (applies to every game)

- One global range: **1 to 15 seconds per question**, whole seconds only. It is the same for
  every topic, every custom trivia and every campaign. There is no per-topic range and no
  "timer off".
- The player (or parent) picks the value before starting. The server rejects anything else with
  `400 INVALID_TIMER` and `details: { "minSeconds": 1, "maxSeconds": 15 }`. `0`, `16`, `2.5` and
  `"5"` (a string) are all rejected.
- The clock for a question starts on the **server** the first time that question is fetched.
  Every question response carries `deadlineAt`, `remainingMs` and `serverTime`. Drive the
  countdown from `remainingMs` (or `deadlineAt - serverTime`), not from the device clock.
- A submission that arrives after `deadlineAt` plus a 1 second network grace is recorded as
  `timeout`, whatever option was sent.
- `timeout` is a failed question. Show the same red signal as a wrong answer, then move on.

---

## 3. Auth, profile and roles

Unchanged from the existing API. Roles are `gamer` (the player — the product's "user" role),
`brand` and `admin`. Admin routes are enforced on the server.

| Method | Path | Auth | Notes |
| --- | --- | --- | --- |
| POST | `/auth/gamer/register` | – | `{ firstName, lastName?, email, password }` → `201 { activationToken }`; a 4-digit code is emailed |
| POST | `/auth/brand/register` | – | `{ name, email, password, companyName }` → `201 { activationToken }` |
| POST | `/auth/user/activate` | – | `{ activation_token, activation_code }` → `{ user, accessToken, refreshToken }` |
| POST | `/auth/user/resend-activation` | – | `{ email }` |
| POST | `/auth/login` | – | `{ email, password }` → `{ user, accessToken, refreshToken }` |
| POST | `/auth/google` | – | `{ idToken }` (Firebase ID token) → `{ user, accessToken, refreshToken }` |
| POST | `/auth/logout` | Auth | |
| POST | `/auth/forgot-password` | – | `{ email }` |
| POST | `/auth/reset-password` | – | `{ token, new_password }` |
| POST | `/refresh` | cookie | Uses the `refresh_token` cookie → `{ accessToken }` |
| GET | `/me` | Auth | `{ user, plan }` |
| GET | `/profile/gamer` | Auth (gamer) | `{ profile }` with `profile.plan` |
| PUT | `/profile/gamer` | Auth (gamer) | multipart: `firstName`, `lastName`, `username`, file `avatar` |
| GET | `/profile/brand` | Auth (brand) | `{ profile }` with `brandDetails { companyName, logoUrl, websiteUrl, verified, totalCampaigns }` |
| PUT | `/profile/brand` | Auth (brand) | multipart: `name`, `companyName`, `websiteUrl` (http/https), file `avatar` (the brand logo) |
| PATCH | `/profile/change-password` | Auth | `{ currentPassword, newPassword }` |
| PATCH | `/profile/notifications` | Auth | `{ emailNotifications?, newCampaignAlerts?, weeklyDigest? }` |
| DELETE | `/profile/account` | Auth | `{ password }` |

`GET /me` response:

```json
{
  "success": true,
  "user": { "_id": "…", "email": "ada@example.com", "role": "gamer", "username": "ada", "avatar": "…",
            "isVerified": true, "proUntil": null, "nonCampaignPlaysSinceCampaign": 3 },
  "plan": { "tier": "freemium", "isPro": false, "proUntil": null }
}
```

Always read the tier from `plan` (computed on the server on every request). Do not compute it
from `user.proUntil` on the client.

**Share-link return:** when a logged-out visitor opens `/q/:slug`, keep the slug (for example
in the `next` query parameter or session storage), send them through login or sign-up, then
navigate back to `/q/:slug`. Nothing on the server is needed for this.

Presence endpoints (optional): `POST /analytics/user/online`, `POST /analytics/user/offline`,
`POST /analytics/game/start { game? }`, `POST /analytics/game/stop` (all Auth), and public
`GET /analytics/app` → `{ analytics: { totalGamesPlayed, gamesPlayedToday, currentlyPlaying, onlineUsers } }`.

---

## 4. Plans, Pro and payments

- Two tiers: **freemium** (default) and **pro**.
- Pro costs the configured price (default 1,500 NGN) for the configured duration (default 30 days)
  starting from the payment time. Renewing while still Pro adds the duration to the current
  `proUntil`; renewing after expiry starts from the new payment time.
- Pro benefits: never interrupted by campaign trivia, and unlimited custom trivias.
- Payment is made **only** through the payment gateway (Paystack). The wallet is never used to
  pay for anything.

### `GET /plan/me` — Auth

```json
{
  "success": true,
  "plan": { "tier": "pro", "isPro": true, "proUntil": "2026-11-05T09:12:44.000Z" },
  "pricing": { "amount": 1500, "currency": "NGN", "durationDays": 30 },
  "campaignGate": { "required": false, "counter": 4, "threshold": 10, "campaign": null },
  "history": [ { "paidAt": "…", "startsAt": "…", "endsAt": "…", "paymentId": "…" } ]
}
```

### `POST /plan/pro/checkout` — Auth

Body: `{ "idempotencyKey": "optional-client-generated-uuid" }`. Sending the same key again
returns the same checkout (`200`) instead of creating a second one.

```json
{
  "success": true,
  "checkout": {
    "authorizationUrl": "https://checkout.paystack.com/abc123",
    "reference": "pz_pro_5f0c…",
    "payment": { "id": "…", "purpose": "pro", "amount": 1500, "currency": "NGN", "durationDays": 30,
                 "reference": "pz_pro_5f0c…", "status": "pending", "paidAt": null }
  }
}
```

Redirect the browser to `authorizationUrl`. Paystack returns the user to
`{FRONTEND_URL}/payment/verify?reference=<reference>`.

### `GET /payments/verify/:reference` — Auth (the paying user only)

Call this on the return page. It verifies with the gateway on the server and applies the
purchase. It is safe to call repeatedly and safe alongside the webhook.

```json
{
  "success": true,
  "payment": { "id": "…", "purpose": "pro", "status": "success", "paidAt": "2026-10-06T09:12:44.000Z", "…": "…" },
  "plan": { "tier": "pro", "isPro": true, "proUntil": "2026-11-05T09:12:44.000Z" },
  "campaign": null
}
```

`payment.status` is `pending`, `success` or `failed`. While it is `pending`, poll every few
seconds. For a campaign payment, `campaign` is `{ id, status, startsAt, endsAt }`.

### `GET /payments/mine` — Auth

`{ payments: [ { id, purpose, campaignId, amount, currency, durationDays, reference, status, paidAt, createdAt } ] }`

### `POST /payments/webhook/paystack` — called by Paystack

Not for the frontend. Verified with the `x-paystack-signature` header. Processing is idempotent:
a webhook delivered twice never extends Pro twice or activates a campaign twice.

### Pro checkout state machine

```
            POST /plan/pro/checkout
 (none) ───────────────────────────────▶ pending ──(gateway declines)──▶ failed
                                           │
              webhook  or  GET /payments/verify/:reference
                                           ▼
                                        success ──▶ proUntil extended (once) ──▶ plan.tier = "pro"
```

---

## 5. Match (removed)

The Match game no longer exists. Every `/match/*` and `/admin/match/*` route returns `404`, and
the `match.defaultTimerSeconds` setting is now `trivia.defaultTimerSeconds`. Remove the Match
screens, the level map and the admin level editor. The game is trivia only: image and
short-definition questions for topics, custom quizzes and brand campaigns (sections 6 to 8).

---

## 6. Trivia sessions (topics, custom quizzes and campaigns)

One session engine runs all three. The source differs; the flow and the rules are identical.

There is **no study step**. Starting a session goes straight into the quiz. The setup screen has
three choices: the timer, the number of cards, and a **Practice** toggle. With practice on, every
question arrives with its correct option identified, and the client points at it (a hand
pointer or marker). With practice off nothing is marked. Everything else is the same in both
modes: the player taps an option, the server scores it, and the result counts as usual.

| `sourceType` | Identify it with | Who can play |
| --- | --- | --- |
| `topic` | `sourceId` (topic id) | Any logged-in user |
| `custom` | `slug` (share link) — or `sourceId` for the owner | Anyone logged in with the link; the owner at any time |
| `campaign` | `sourceId` (campaign id) | Any logged-in user while the campaign is running |

### 6.1 Endpoints

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| GET | `/trivia/topics` | Auth | Active topics that have cards, in alphabetical order |
| GET | `/trivia/topics/:id` | Auth | One topic |
| POST | `/trivia/sessions` | Auth | Start (or resume) a session |
| GET | `/trivia/sessions/:id` | Auth | Session state, for resuming |
| GET | `/trivia/sessions/:id/question` | Auth | Current question (answer marked only in practice) |
| POST | `/trivia/sessions/:id/answer` | Auth | Submit an answer |
| GET | `/trivia/sessions/:id/result` | Auth | Result |
| POST | `/trivia/sessions/:id/abandon` | Auth | Leave without a result |

#### `GET /trivia/topics`

```json
{ "success": true, "topics": [
  { "id": "6702…", "name": "Football", "slug": "football", "description": "Rules, positions…",
    "coverImageUrl": null, "cardCount": 20,
    "cardCountBounds": { "available": 20, "min": 5, "max": 20 } }
] }
```

`cardCountBounds` is what the "number of cards" picker must offer: at least 5 (or all cards when
a topic has fewer than 5), at most the cards available, capped globally at `trivia.maxCards`.

#### `POST /trivia/sessions`

```json
{ "sourceType": "topic", "sourceId": "6702…", "timerSeconds": 5, "cardCount": 10, "practice": true }
```

`practice` is optional and defaults to `false`. It must be a boolean (`400 INVALID_PRACTICE`
otherwise).

For a shared custom quiz send `{ "sourceType": "custom", "slug": "…", … }`. `timerSeconds` and
`cardCount` may be omitted for a custom quiz, in which case the creator's defaults are used.

```json
{ "success": true, "resumed": false,
  "session": {
    "id": "6703…", "status": "quiz",
    "source": { "type": "topic", "id": "6702…", "title": "Football" },
    "isPreview": false, "practice": true, "timerSeconds": 5, "cardCount": 10, "currentIndex": 0,
    "brand": null, "startedAt": "…", "completedAt": null } }
```

- **One active session per user per topic/quiz/campaign.** If one is already in progress it is
  returned with `200` and `"resumed": true`; the body you sent is ignored, including
  `practice`. Read `session.practice`, `timerSeconds` and `currentIndex` from the response
  rather than from the setup form. To change the settings the player must finish or abandon it.
- `session.status` is `quiz`, `completed` or `abandoned`. `quizStartedAt` is gone
  (`startedAt` is when the quiz began).
- `session.brand` is filled for campaigns (see 8.4).
- `isPreview: true` means an owner/brand test play: it is never counted anywhere.

Errors: `403 CAMPAIGN_REQUIRED` (see 8.3), `400 INVALID_TIMER`, `400 INVALID_PRACTICE`, `400 INVALID_CARD_COUNT`
(`details: { available, min, max }`), `400 NO_CARDS`, `404 TOPIC_NOT_FOUND`,
`404 QUIZ_NOT_FOUND`, `404 CAMPAIGN_NOT_AVAILABLE`, `400 INVALID_SOURCE`.

**Card mix.** The player chooses the share of picture cards: send `imagePercent` (a whole
number from 0, short definitions only, to 100, pictures only) when starting; anything else is
`400 INVALID_IMAGE_PERCENT`. Without it the session uses the topic's own share if an admin set
one (section 9), otherwise the `trivia.imagePercent` setting (70). When a source has too few
cards of one type, the other type fills the gap, so the session always has the number of cards
asked for. `session.imagePercent` is what the player sent (`null` if nothing), so "play again"
can repeat it.

Topics (`GET /trivia/topics`, `/trivia/topics/:id`), the owner's quiz view
(`GET /custom-quizzes/:id`, `/preview`) and the share-link play info carry what the picker
needs:

```json
"cardMix": { "imageCards": 20, "definitionCards": 44, "defaultImagePercent": 70 }
```

Show the picker only when both counts are above zero, and start it on `defaultImagePercent`.

#### `GET /trivia/sessions/:id/question`

```json
{ "success": true, "completed": false,
  "question": {
    "index": 0, "total": 10, "type": "image", "imageUrl": "https://…/a1b2.webp",
    "text": "Which animal is this?",
    "attribution": "Markus Trienke · CC BY-SA 2.0 · Wikimedia Commons",
    "options": [ { "index": 0, "text": "Monkey" }, { "index": 1, "text": "Dog" } ],
    "correctOptionIndex": 1,
    "timerSeconds": 5, "servedAt": "…", "deadlineAt": "…", "remainingMs": 5000, "serverTime": "…" } }
```

- **Practice:** `correctOptionIndex` is the `index` of the right option. It is present only when
  the session was started with `practice: true`. Put the hand pointer or marker on that option.
  When the field is absent, show no marker. Never guess it on the client.
- Outside practice there is no answer, no card id and nothing to infer one from. The cards and
  the two options of each card are in random order.
- `attribution` is the image credit for a picture fetched from an API, or `null`. When it is
  set, show it as small text with the image (the picture's licence requires it).
- `type` is `image` (show `imageUrl`; `text` is an optional caption) or `definition` (show
  `text`; `imageUrl` is `null`).
- **Refresh-safe:** calling it again returns the same question with the remaining time. A
  refresh never gives a retry and never restarts the clock.
- If time has already run out, the server fails that question and returns the next one.
- After the last question: `{ "completed": true, "result": {…} }`.

#### `POST /trivia/sessions/:id/answer`

Body: `{ "questionIndex": 0, "optionIndex": 1 }` where `optionIndex` is the `index` of the
chosen option as displayed (0 or 1). Send it as soon as the player taps an option.

```json
{ "success": true, "questionIndex": 0, "outcome": "correct", "correctOptionIndex": 1,
  "completed": false, "nextQuestionIndex": 1, "result": null }
```

`outcome`: `correct` → confetti; `wrong` or `timeout` → red shake. This is the same with
practice on or off: in practice a player can still tap the wrong option or run out of time, and
it is scored the same way. Then fetch the next question. Forward only: no going back, no skipping (`409 NOT_CURRENT_QUESTION`), no
editing (a repeat submit returns the stored outcome). If the countdown reaches zero with nothing
submitted, call `GET …/question` — the server has already failed the question.

#### `GET /trivia/sessions/:id/result`

```json
{ "success": true, "result": {
  "sessionId": "6703…", "source": { "type": "topic", "id": "6702…", "title": "Football" },
  "correct": 8, "total": 10, "isPreview": false, "brand": null, "completedAt": "…",
  "campaignGate": { "required": false, "counter": 4, "threshold": 10, "campaign": null } } }
```

Show `correct` out of `total`, **Retry** (start a new session for the same source: a new random
card set) and **Pick Another Topic**. If `campaignGate.required` is true the next non-campaign
start will be rejected, so offer the campaign straight away.
`409 SESSION_IN_PROGRESS` while questions remain.

### 6.2 Trivia state machine

```
   POST /trivia/sessions { timerSeconds, cardCount, practice }
                 │                 403 CAMPAIGN_REQUIRED ─▶ play details.campaign first
                 ▼
               quiz ◀──────────────────────────────────────────────┐
                 │            POST /abandon ─▶ abandoned            │
                 │                            (counts for nothing) │
       GET /question (clock starts once; same question on refresh) │
        practice on: correctOptionIndex ─▶ point at that option    │
                 │                                                 │
        tap an option ─▶ POST /answer         time runs out        │
            │        │                              │              │
         correct   wrong ◀──────────────────── timeout             │
        (confetti) (red shake)                                     │
            └────────┴─────────── completed:false ─────────────────┘
                                │
                          completed:true
                                ▼
                           completed ─▶ GET /result { correct, total }
                                         Retry ─▶ POST /trivia/sessions (new random card set)
```

---

## 7. Custom trivia

Any logged-in user can create quizzes and share them by link.

- **Freemium:** 1 non-deleted quiz. **Pro:** unlimited. Enforced on the server at creation;
  the second attempt by a freemium user returns `403 UPGRADE_REQUIRED` with
  `details: { feature: "custom_quiz", limit: 1, current: 1, pro: { amount, currency, durationDays } }`.
  Show the upgrade prompt from `details.pro`.
- **Statuses:** `draft` → `live` ↔ `unpublished`, plus `locked`.
- **When Pro expires** nothing is deleted. The owner's oldest quiz is untouched; every other
  quiz becomes `locked`: unpublished, share link inactive, still viewable and editable by the
  owner, but it cannot be published. Renewing Pro restores each one to its previous status and
  the same link works again. Deleting quizzes down to the limit unlocks the next one. A locked
  quiz returns `403 UPGRADE_REQUIRED` with `details.reason: "quiz_locked"` on publish.
- A quiz needs at least `customQuiz.minCardsToPublish` (5) cards to go live.

### 7.1 Owner endpoints (all Auth; every `:id` must belong to the caller, otherwise 404)

| Method | Path | Body | Purpose |
| --- | --- | --- | --- |
| POST | `/custom-quizzes` | `title`, `description?`, `defaultTimerSeconds?` (1–15), `defaultCardCount?`, file `image?` or `coverImageUrl?` | Create a draft |
| GET | `/custom-quizzes` | | The caller's quizzes, with `plan` and `limit` (`null` for Pro) |
| GET | `/custom-quizzes/:id` | | Quiz + all cards with answers (review screen) |
| GET | `/custom-quizzes/:id/preview` | | Same as above |
| PATCH | `/custom-quizzes/:id` | any create field | Edit |
| DELETE | `/custom-quizzes/:id` | | Delete (frees the freemium slot) |
| POST | `/custom-quizzes/:id/cards` | card (see 7.3) | Add a card |
| POST | `/custom-quizzes/:id/cards/bulk` | `{ cards: [ … ] }` up to 100 | Add many cards (all or nothing) |
| PATCH | `/custom-quizzes/:id/cards/:cardId` | partial card | Edit a card |
| DELETE | `/custom-quizzes/:id/cards/:cardId` | | Remove a card (`409 MIN_CARDS_REQUIRED` if a live quiz would drop below the minimum) |
| POST | `/custom-quizzes/:id/publish` | | Go live; generates the share link |
| POST | `/custom-quizzes/:id/unpublish` | | Back to unpublished; the link stops resolving |
| POST | `/custom-quizzes/:id/share-link/regenerate` | | New link; the old one dies immediately |
| DELETE | `/custom-quizzes/:id/share-link` | | Revoke the link; the quiz becomes unpublished |
| GET | `/custom-quizzes/:id/stats` | | `{ stats: { plays, averageScore, averageScorePercent } }` |

Quiz object:

```json
{ "id": "6704…", "title": "Capital cities", "description": null, "coverImageUrl": null,
  "status": "live", "shareSlug": "Zk3vQ0a1b2c3d4e5f6g7hA", "shareUrl": "https://app.example/q/Zk3vQ0a1b2c3d4e5f6g7hA",
  "defaultTimerSeconds": 5, "defaultCardCount": 5, "cardCount": 8, "createdAt": "…", "updatedAt": "…" }
```

`shareSlug`/`shareUrl` are `null` unless the quiz is live. `shareUrl` is
`{FRONTEND_URL}/q/{shareSlug}`, so the frontend must serve that route.

**Owner test play:** `POST /trivia/sessions { "sourceType": "custom", "sourceId": "<quiz id>", "timerSeconds": 5, "cardCount": 5 }`
works in any status, returns `isPreview: true`, and is not counted in the stats or anywhere else.

Editing a live quiz never affects a session already in progress: each session keeps its own copy
of its cards.

### 7.2 Share link

`GET /custom-quizzes/link/:slug` — **public**. Returns the minimal landing only:

```json
{ "success": true, "requiresAuth": true,
  "quiz": { "title": "Capital cities", "description": null, "coverImageUrl": null,
            "creator": { "name": "ada", "avatar": "https://…" } } }
```

It never returns cards. `404 QUIZ_NOT_FOUND` when the slug is unknown, or the quiz is not live,
locked, revoked or deleted. Render title, creator and a "Log in to play" button.

`GET /custom-quizzes/link/:slug/play-info` — Auth. After login:

```json
{ "success": true, "quiz": { "id": "6704…", "title": "Capital cities", "description": null,
  "coverImageUrl": null, "defaultTimerSeconds": 5, "defaultCardCount": 5,
  "cardCountBounds": { "available": 8, "min": 5, "max": 8 }, "isOwner": false } }
```

Then start the session with `{ "sourceType": "custom", "slug": "<slug>", "timerSeconds", "cardCount" }`.
The campaign gate applies to it, and a completed play counts toward the player's campaign counter.

### 7.3 Card format (the same for topics, custom quizzes and campaigns)

| Field | Rule |
| --- | --- |
| `type` | `"image"` or `"definition"` |
| `text` | Required for `definition`; optional caption for `image`. Max 300 characters |
| image | Required for `image`: a multipart file field named `image`, or `imageUrl` returned by `POST /uploads/images` for the same user |
| `options` | Exactly 2 non-empty, different strings, max 80 characters each. In multipart send it as a JSON string: `["Nigeria","Ghana"]` |
| `correctOptionIndex` | `0` or `1` |

Invalid cards return `400 INVALID_CARD`; in bulk the message names the row (`Card 3: …`) and
`details.index` is its zero-based position. Editor responses return a card as
`{ id, type, imageUrl, text, options, correctOptionIndex, attribution, createdAt, updatedAt }`.

### 7.4 Cards from a document

A player uploads their study material and gets draft cards to review. The server reads the text,
asks Claude to write definition cards from it, and keeps only the cards whose supporting sentence
really appears in the document. **Nothing is saved by this endpoint.** The drafts come back in the
card format of 7.3, so the review screen edits them and saves the ones the player keeps through the
existing endpoints.

`GET /custom-quizzes/generate` — Auth. What the upload screen needs:

```json
{ "success": true, "generate": {
  "enabled": true,
  "fileTypes": ["pdf", "docx", "txt", "md"], "maxFileBytes": 10485760, "minCharacters": 300,
  "count": { "default": 10, "min": 1, "max": 30 },
  "dailyLimit": 3, "usedToday": 1, "remaining": 2, "resetsAt": "2026-10-12T00:00:00.000Z" } }
```

Hide or disable the feature when `enabled` is `false` (no API key on the server), and show
`remaining` of `dailyLimit`. The allowance resets at `resetsAt` (midnight UTC).

`POST /custom-quizzes/generate` — Auth. Either `multipart/form-data` with the file in a field
named `document`, or JSON `{ "text": "pasted notes…" }`. Optional `count` (1–30, default 10).
It can take up to a minute, so show progress and do not retry automatically.

```json
{ "success": true,
  "suggestedTitle": "Financial accounting basics",
  "requested": 10,
  "cards": [
    { "type": "definition",
      "text": "What does the accounting equation state?",
      "options": ["Assets = liabilities + equity", "Assets = revenue - expenses"],
      "correctOptionIndex": 0,
      "quote": "The accounting equation states that assets equal liabilities plus owner's equity." }
  ],
  "document": { "name": "accounting.pdf", "kind": "pdf", "characters": 48211, "sampled": false },
  "usage": { "dailyLimit": 3, "usedToday": 2, "remaining": 1, "resetsAt": "2026-10-12T00:00:00.000Z" } }
```

- `cards` may hold fewer than `requested`: a card the document does not support is dropped.
- `quote` is the sentence from the document that proves the answer. Show it on the review
  screen so the player can check each card; it is not part of a saved card.
- `document.kind` is `pdf`, `docx` or `text`. `sampled` is `true` when the document was longer
  than about 60,000 characters and the cards were written from evenly spaced parts of it.
- Only PDFs with real text work; a scanned PDF returns `DOCUMENT_UNREADABLE`. Only the first 150
  pages of a PDF are read.

**Review, then save.** Let the player edit the text and options, change which option is correct
and remove cards. Then:

1. `POST /custom-quizzes` with the title (prefill it from `suggestedTitle`), or use a quiz the
   player already owns. The freemium quiz limit applies here as usual.
2. `POST /custom-quizzes/:id/cards/bulk` with `{ "cards": [ …the kept drafts… ] }`. Extra
   fields such as `quote` are ignored.
3. `POST /custom-quizzes/:id/publish` when the player is ready (at least 5 cards).

Limits: freemium players may generate from `customQuiz.generateDailyLimitFree` (3) documents a
day and Pro players from `customQuiz.generateDailyLimitPro` (20). A request that fails does not
use up the allowance. Over the limit returns `429 GENERATION_LIMIT_REACHED` with
`details: { dailyLimit, resetsAt, isPro }`; offer Pro when `isPro` is `false`.

---

## 8. Brand campaigns

Sponsored trivia created by `brand` accounts and delivered to freemium players.

### 8.1 Lifecycle

```
          POST /brand/campaigns
                  │
                  ▼        POST …/checkout                 payment confirmed
                draft ───────────────────▶ awaiting_payment ───────────────▶ live ──(30 days after payment)──▶ ended
                  ▲   POST …/cancel-checkout      │                          │  ▲
                  └───────────────────────────────┘             admin pause  ▼  │ admin resume
                                                                           paused
        any state ──(admin takedown, with a reason)──▶ taken_down
```

- Flat price (default 15,000 NGN) for a fixed duration (default 30 days). No packages, no tiers, no
  start date to choose. `startsAt` is the confirmed payment time; `endsAt` is exactly the
  duration later.
- A campaign is editable only as a `draft`. It needs at least `campaign.minCardsToPublish` (5)
  cards before checkout.
- It goes live only when the gateway confirms the payment — never from the checkout response.
- An ended campaign is never served, even if the cleanup job is late. A campaign that is `live`
  but past `endsAt` is reported as `ended`.

### 8.2 Brand endpoints (Auth, role `brand`; every `:id` must belong to the caller, otherwise 404)

| Method | Path | Body | Purpose |
| --- | --- | --- | --- |
| GET | `/brand/campaigns/pricing` | | `{ pricing: { amount, currency, durationDays }, minCardsToPublish }` |
| POST | `/brand/campaigns` | `title`, `brandName?`, `websiteUrl?`, `ctaText?`, `description?`, `tags?`, files `logo?`, `cover?` (or `logoUrl?`, `coverImageUrl?`) | Create a draft. Brand name, logo and website default to the brand profile |
| GET | `/brand/campaigns` | | The brand's campaigns |
| GET | `/brand/campaigns/:id` | | Campaign + cards with answers + pricing |
| GET | `/brand/campaigns/:id/preview` | | Same as above |
| PATCH | `/brand/campaigns/:id` | any create field | Edit (draft only) |
| DELETE | `/brand/campaigns/:id` | | Delete (draft only) |
| POST | `/brand/campaigns/:id/cards` | card (see 7.3) | Add a card (draft only) |
| POST | `/brand/campaigns/:id/cards/bulk` | `{ cards: [ … ] }` | Add many cards |
| PATCH | `/brand/campaigns/:id/cards/:cardId` | partial card | Edit a card |
| DELETE | `/brand/campaigns/:id/cards/:cardId` | | Remove a card |
| POST | `/brand/campaigns/:id/checkout` | `{ idempotencyKey? }` | Start payment → `awaiting_payment` |
| POST | `/brand/campaigns/:id/cancel-checkout` | | Back to `draft` to edit |
| GET | `/brand/campaigns/:id/dashboard` | | Numbers for the campaign |

`websiteUrl` must be an absolute `http://` or `https://` URL; anything else is `400`.
`ctaText` is at most 40 characters (for example "Visit our site"). `tags` is up to 8 labels.

Campaign object:

```json
{ "id": "6705…", "brandName": "Acme", "logoUrl": "https://…/logo.webp", "websiteUrl": "https://acme.example/",
  "ctaText": "Visit our site", "title": "Spring launch", "description": null, "coverImageUrl": null,
  "tags": ["food"], "status": "live", "startsAt": "2026-10-06T09:00:00.000Z", "endsAt": "2026-11-05T09:00:00.000Z",
  "moderationReason": null, "cardCount": 6, "createdAt": "…", "updatedAt": "…" }
```

Checkout response (`201`, or `200` when a checkout opened in the last 30 minutes is reused):

```json
{ "success": true,
  "checkout": { "authorizationUrl": "https://checkout.paystack.com/…", "reference": "pz_campaign_…",
                "payment": { "id": "…", "purpose": "campaign", "campaignId": "6705…", "amount": 15000,
                             "currency": "NGN", "durationDays": 30, "status": "pending" } },
  "campaign": { "id": "6705…", "status": "awaiting_payment" } }
```

Redirect to `authorizationUrl`, then call `GET /payments/verify/:reference` on return (section 4).

Errors: `409 CAMPAIGN_NOT_EDITABLE`, `409 CAMPAIGN_NOT_PAYABLE`, `400 MIN_CARDS_REQUIRED`.

Dashboard:

```json
{ "success": true, "campaign": { "…": "…" },
  "dashboard": { "status": "live", "startsAt": "…", "endsAt": "…", "daysRemaining": 29,
    "plays": 124, "completions": 97, "averageScore": 4.1, "averageScorePercent": 82.3,
    "urlClicks": 31, "uniqueUrlClickers": 27 } }
```

No per-player data is exposed. **Brand test play:** start a session with
`{ "sourceType": "campaign", "sourceId": "<id>" , … }`; it works in any status and is not counted.

### 8.3 Delivery to players — the interruption rule

- The server counts the non-campaign trivias (topics and custom quizzes) a freemium player has
  **completed** since their last completed campaign. Abandoned sessions
  and owner test plays do not count.
- When the count reaches `N` (`campaign.interruptionThreshold`, default 10), starting any
  non-campaign trivia is rejected:

```json
{ "success": false, "message": "Play a sponsored trivia to keep going.", "code": "CAMPAIGN_REQUIRED",
  "details": { "counter": 10, "threshold": 10,
    "campaign": { "id": "6705…", "title": "Spring launch", "description": null, "coverImageUrl": null,
                  "brandName": "Acme", "logoUrl": "https://…/logo.webp", "websiteUrl": "https://acme.example/",
                  "ctaText": "Visit our site", "endsAt": "2026-11-05T09:00:00.000Z" } } }
```

  HTTP status `403`. On this code, redirect to the campaign: start a session with
  `{ "sourceType": "campaign", "sourceId": details.campaign.id, "timerSeconds", "cardCount" }`.
- **Completing** the campaign trivia resets the counter to 0. Starting or abandoning it does not.
- If no campaign is live, nobody is blocked; the counter stays at or above N until one exists.
- Pro players are never blocked and their plays are not counted. They may still open a campaign.
- Campaigns rotate fairly: the one this player played least recently comes first.

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| GET | `/campaigns/next` | Auth | `{ required, counter, threshold, campaign }` — check before showing the topic list |
| GET | `/campaigns/:id` | Auth | `{ campaign, cardCountBounds }` for a running campaign (`404 CAMPAIGN_NOT_AVAILABLE` otherwise) |
| POST | `/campaigns/:id/click` | Auth | Counts a click → `{ url }` |

### 8.4 Campaign sessions and the brand link

Campaign plays use the session engine in section 6 unchanged (timer 1 to 15, the practice
toggle, answers hidden unless practice is on). `session.brand` (on start and session state)
and `result.brand` carry:

```json
{ "id": "6705…", "title": "Spring launch", "description": null, "coverImageUrl": null,
  "brandName": "Acme", "logoUrl": "https://…/logo.webp", "websiteUrl": "https://acme.example/",
  "ctaText": "Visit our site", "endsAt": "…" }
```

Show the brand name and logo on the quiz screen and the result screen. Render the link as:

```html
<a href="{brand.websiteUrl}" target="_blank" rel="noopener noreferrer">{brand.ctaText ?? "Visit our site"}</a>
```

and call `POST /campaigns/:id/click` when it is clicked (fire and forget; do not wait for it
before opening the tab).

---

## 9. Admin

Every `/admin/*` route requires role `admin` on the server (`401` without a token, `403` for
any other role).

### Settings

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/admin/config` | `{ config: { "<key>": value, … } }` |
| PUT | `/admin/config/:key` | Body `{ "value": …, "description"?: "…" }` |

| Key | Default | Editable |
| --- | --- | --- |
| `game.timerMinSeconds` / `game.timerMaxSeconds` | 1 / 15 | No (global constants; `400` on edit) |
| `game.submitGraceMs` | 1000 | Yes (0–5000) |
| `trivia.defaultTimerSeconds` | 5 | Yes (1–15) |
| `trivia.minCards` / `trivia.maxCards` | 5 / 30 | Yes |
| `trivia.imagePercent` | 70 | Yes (0–100) |
| `customQuiz.freeLimit` / `customQuiz.minCardsToPublish` | 1 / 5 | Yes |
| `customQuiz.generateDailyLimitFree` / `customQuiz.generateDailyLimitPro` | 3 / 20 | Yes (documents turned into trivia per player per day) |
| `campaign.minCardsToPublish` | 5 | Yes |
| `campaign.interruptionThreshold` | 10 | Yes (positive integer) |
| `campaign.priceAmount` / `campaign.durationDays` | 15000 / 30 | Yes |
| `pro.priceAmount` / `pro.durationDays` | 1500 / 30 | Yes |
| `payments.currency` | `NGN` | Yes (3-letter code) |

A price or duration change applies to checkouts started afterwards; existing payments keep the
values they were created with.

### Trivia topics and cards

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/admin/trivia/topics` | All topics with `cardCount`, `isActive` and `imagePercent`, in alphabetical order |
| POST | `/admin/trivia/topics` | `name`, `description?`, `isActive?`, `imagePercent?`, file `image?` (cover) |
| GET | `/admin/trivia/topics/:id` | Topic + every card with answers + play stats (preview) |
| PATCH | `/admin/trivia/topics/:id` | Edit (same fields) |
| DELETE | `/admin/trivia/topics/:id` | Delete the topic and its cards |
| POST | `/admin/trivia/topics/:id/cards` | Add a card (see 7.3) |
| POST | `/admin/trivia/topics/:id/cards/bulk` | `{ cards: [ … ] }`, up to 100, all or nothing |
| PATCH | `/admin/trivia/topics/:id/cards/:cardId` | Edit a card |
| DELETE | `/admin/trivia/topics/:id/cards/:cardId` | Remove a card |

`imagePercent` is the share of picture cards in a session of that topic: a whole number from 0
(short definitions only) to 100 (pictures only). Send it empty (`""` or `null`) to go back to
the global `trivia.imagePercent` setting; a topic returns `"imagePercent": null` while it
follows the setting. Anything else is `400 INVALID_IMAGE_PERCENT`.

For bulk entry with images: upload each image with `POST /uploads/images`, then put the returned
`url` in the card's `imageUrl`.

### Importing image cards

Image cards can also be fetched automatically. The server looks up the best-known entries of a
category on Wikidata, downloads each picture from Wikimedia Commons into our own storage, and
adds it to a topic as an image card with two options. No API key is needed.

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/admin/trivia/import/categories` | `{ categories: [ { key, topicName, topicSlug, supportsCountry } ], countries, maxCount }` |
| POST | `/admin/trivia/import` | `{ category, count?, topicId?, country? }` |

- `category`: `animals`, `plants`, `food`, `tech`, `footballers`, `musicians`, `celebrities`,
  `pastors`, `instruments`, `music-symbols-beginner`, `music-symbols-intermediate` or
  `music-symbols-advanced`. The three music-symbol categories use a fixed list of about 20
  symbols each and go to the `Music Theory: Beginner / Intermediate / Advanced` topics.
- `count`: how many cards to add, 1 to 50 (default 20). Call it again for more: each call
  continues after the entries already imported, most famous first.
- `topicId`: the topic to add to. Without it the cards go to the category's own topic
  (`topicSlug`), which is created if it does not exist.
- `country`: for the people categories only (`footballers`, `musicians`, `celebrities`,
  `pastors`); ignored for the others. Without it, or with `"mixed"`, the cards alternate between
  Nigerian and worldwide people. `"worldwide"` drops the Nigerian half; a country from
  `countries` (e.g. `"ghana"`) or a Wikidata id (e.g. `"Q117"`) fetches that country only.
  Mixed and worldwide requests can take up to a minute.

```json
{ "success": true,
  "import": { "category": "footballers",
              "topic": { "id": "6701…", "name": "Football", "slug": "football" },
              "requested": 20, "created": 20,
              "skipped": { "unusableLicense": 1, "imageFailed": 0, "noWrongOption": 0 } } }
```

The request answers when the import has finished, so show a progress state. Imported cards are
live at once: players get them in the topic's next session, with no approval step. Only pictures under
a free licence (public domain, CC0, CC BY, CC BY-SA) are taken; the credit is stored in the
card's `attribution`. Imported cards are ordinary cards afterwards: review, edit or delete them
with the card endpoints above. Errors: `400 INVALID_IMPORT_CATEGORY`, `400 INVALID_IMPORT_COUNT`,
`400 INVALID_IMPORT_COUNTRY`, `502 IMPORT_SOURCE_UNAVAILABLE`.

### Loading the starter questions

The server ships with built-in definition questions for a set of topics (football, biology,
food, the three music theory levels and musical instruments). An admin can load them without
the seed script.

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/admin/trivia/starter` | `{ topics: [ { slug, name, description, topicId, total, missing } ] }` |
| POST | `/admin/trivia/starter` | `{ slugs? }` |

- `topicId` is `null` until the topic exists; `missing` is how many of its `total` built-in
  questions are not in the topic yet.
- `slugs`: which topics to load. Without it every topic is loaded. A topic that does not
  exist is created.
- Only the questions a topic does not already have are added (matched by their text), so the
  call is safe to repeat. A built-in question an admin deleted comes back on the next load; one
  an admin edited (options only) is left as it is.

```json
{ "success": true,
  "loaded": { "created": 44,
              "topics": [ { "slug": "music-theory-beginner", "name": "Music Theory: Beginner",
                            "topicId": "6701…", "topicCreated": true, "created": 44 } ] } }
```

Error: `400 INVALID_STARTER_TOPIC`.

### Writing cards from a document

An admin can have definition cards written from a document, the same way players do for their
own quizzes (section 7.4), and add them to a topic.

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/admin/trivia/generate` | `{ generate: { enabled, fileTypes, maxFileBytes, minCharacters, count } }` |
| POST | `/admin/trivia/generate` | `multipart/form-data` with the file in `document`, or JSON `{ text }`. Optional `count`, `topicId` |

- Request and response are those of `POST /custom-quizzes/generate`, except that admins have no
  daily allowance: there are no `dailyLimit` / `remaining` fields in the info and no `usage` in
  the result, and `GENERATION_LIMIT_REACHED` is never returned. The 10 requests per 10 minutes
  rate limit still applies.
- `topicId`: the topic the cards are for. Its existing questions (the newest 300) are not
  written again, so the same document can be run several times for more cards. An unknown topic
  returns `404 TOPIC_NOT_FOUND`.
- Nothing is saved. Show the drafts for review, then send the kept ones to
  `POST /admin/trivia/topics/:id/cards/bulk`. They are live for players as soon as they are saved.
- Only definition cards are written. The pictures in a document are not read.

### Campaigns and revenue

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/admin/campaigns?status=&page=&limit=` | All campaigns |
| GET | `/admin/campaigns/:id` | Campaign + cards + dashboard |
| POST | `/admin/campaigns/:id/pause` | `{ reason }` — live → paused (delivery stops; the 30 days keep running) |
| POST | `/admin/campaigns/:id/resume` | paused → live (or ended if its window is over) |
| POST | `/admin/campaigns/:id/takedown` | `{ reason }` — permanent |
| GET | `/admin/revenue?from=&to=` | Confirmed payments by purpose and currency |
| GET | `/admin/payments?status=&purpose=&page=&limit=` | Payment records |

`reason` is required (`400` without it). Wrong state → `409 INVALID_CAMPAIGN_STATE`.

```json
{ "success": true, "range": { "from": null, "to": null },
  "breakdown": [ { "purpose": "campaign", "currency": "NGN", "payments": 3, "total": 45000 },
                 { "purpose": "pro", "currency": "NGN", "payments": 41, "total": 61500 } ],
  "totalsByCurrency": { "NGN": 106500 }, "pendingPayments": 2 }
```

Forum moderation (`/forum/moderation/flags`) is unchanged.

---

## 10. Uploads

| | |
| --- | --- |
| Accepted types | JPG, PNG, WEBP. The server checks the file's actual bytes, not its name or declared type |
| Max size | 5 MB (`400 LIMIT_FILE_SIZE`) |
| Processing | Resized to fit 1280×1280, re-encoded as WEBP, metadata stripped, stored under a random name |
| Result | A public `https://…webp` URL |

`POST /uploads/images` — Auth, multipart: file field `image`, optional text field `kind`
(`cards` default, `covers`, `logos`).

```json
{ "success": true, "image": { "url": "https://…/pazzell/cards/3f2a….webp", "width": 1280, "height": 640, "sizeBytes": 48211 } }
```

Any `imageUrl`, `coverImageUrl` or `logoUrl` sent in a JSON body must be a URL that this
endpoint returned **to the same user**; anything else is `400 INVALID_IMAGE_URL`.

File fields on other endpoints: `image` (cards, quiz cover, topic cover), `logo` and `cover`
(campaigns), `avatar` (profiles). Errors: `INVALID_IMAGE_TYPE`, `IMAGE_REQUIRED`, `LIMIT_FILE_SIZE`.

---

## 11. Wallet

The wallet is **withdraw-only**. It holds rewards a player has earned and lets them withdraw to
their bank account. There is no top-up or deposit, and it is never used to pay for Pro or
campaigns. No gameplay credits the wallet yet, so balances stay at their current values until a
reward feature is added. Amounts are in NGN.

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| GET | `/wallet/balance` | Auth | `{ balance, currency: "NGN" }` |
| GET | `/wallet/transactions?limit=50` | Auth | Ledger, newest first |
| POST | `/wallet/bank-accounts` | Auth | `{ accountNumber, bankCode, bankName }` — the account name is resolved by the bank |
| GET | `/wallet/bank-accounts` | Auth | Saved accounts |
| DELETE | `/wallet/bank-accounts/:id` | Auth | Remove an account |
| POST | `/wallet/withdrawals` | Auth | `{ bankAccountId, amount, idempotencyKey }` |
| GET | `/wallet/withdrawals` | Auth | Withdrawal history |
| GET | `/wallet/withdrawals/:id` | Auth | One withdrawal |

Ledger entry: `{ type: "credit" | "debit", amount, balanceAfter, reason, referenceId, status, createdAt }`
where `reason` is `reward`, `withdrawal`, `withdrawal_reversal`, `admin_adjustment` or
(historical rows) `weekly_payout`.

Withdrawal `status`: `pending` → `processing` → `paid`, or `failed` (the amount is returned to
the wallet). Always send a fresh `idempotencyKey` (a UUID) per withdrawal; re-sending the same key
returns the original withdrawal and never withdraws twice. Insufficient balance → `400`.

---

## 12. Error codes

| Code | Status | Where | Meaning / what to do |
| --- | --- | --- | --- |
| `CAMPAIGN_REQUIRED` | 403 | start a topic/custom session | A campaign is owed. Play `details.campaign` first |
| `UPGRADE_REQUIRED` | 403 | create/publish custom quiz | Freemium limit reached, or quiz locked. Show the Pro prompt |
| `INVALID_TIMER` | 400 | start, quiz defaults | Timer outside 1–15 or not a whole number |
| `INVALID_PRACTICE` | 400 | start session | `practice` is not `true` or `false` |
| `INVALID_CARD_COUNT` | 400 | start session, quiz defaults, generate from a document | Outside `details.min`–`details.max` |
| `NO_CARDS` | 400 | start session | The source has no cards |
| `INVALID_SOURCE` | 400 | start session | Bad `sourceType` |
| `TOPIC_NOT_FOUND` / `QUIZ_NOT_FOUND` / `CAMPAIGN_NOT_FOUND` | 404 | | Unknown, not yours, or not available |
| `CAMPAIGN_NOT_AVAILABLE` | 404 | campaign play/info | Not live or past its end date |
| `SESSION_NOT_FOUND` | 404 | | Unknown or not yours |
| `QUESTION_NOT_SERVED` | 409 | answer | Fetch the question first |
| `NOT_CURRENT_QUESTION` | 409 | answer | Use `details.currentIndex` |
| `QUESTION_NOT_FOUND` | 404 | answer | Bad `questionIndex` |
| `INVALID_OPTION` | 400 | answer | Option not part of the question |
| `SESSION_IN_PROGRESS` | 409 | result | Questions remain |
| `SESSION_NOT_ACTIVE` | 409 | answer | Already finished |
| `SESSION_ABANDONED` | 409 | | Start a new one |
| `MIN_CARDS_REQUIRED` | 400 / 409 | publish, checkout, delete card | `details: { minCards, cardCount }` |
| `QUIZ_NOT_LIVE` | 409 | regenerate link | Publish first |
| `INVALID_CARD` | 400 | cards | See 7.3; `details.index` in bulk |
| `CARD_NOT_FOUND` | 404 | cards | |
| `AI_NOT_CONFIGURED` | 503 | generate from a document | The server has no Claude API key. Hide the feature |
| `AI_UNAVAILABLE` | 502 | generate from a document | The AI request failed. Let the player retry |
| `DOCUMENT_REQUIRED` / `DOCUMENT_TOO_LARGE` / `INVALID_DOCUMENT_TYPE` | 400 | generate from a document | No file or text; over 10MB; not a PDF, .docx or text file |
| `DOCUMENT_UNREADABLE` | 400 | generate from a document | Scanned, password-protected or damaged PDF. Show the message |
| `DOCUMENT_TOO_SHORT` | 400 | generate from a document | Under `details.minCharacters` characters of text |
| `NO_CARDS_GENERATED` | 422 | generate from a document | No card could be backed by the document. Suggest another document |
| `GENERATION_LIMIT_REACHED` | 429 | generate from a document | Daily allowance used; `details: { dailyLimit, resetsAt, isPro }` |
| `INVALID_IMAGE_TYPE` / `IMAGE_REQUIRED` / `IMAGE_TOO_LARGE` / `LIMIT_FILE_SIZE` / `INVALID_IMAGE_URL` | 400 | uploads | See section 10 |
| `CAMPAIGN_NOT_EDITABLE` | 409 | brand edits | Only drafts are editable |
| `CAMPAIGN_NOT_PAYABLE` | 409 | checkout | Already paid or not payable |
| `INVALID_CAMPAIGN_STATE` | 409 | admin moderation | `details.status` |
| `PAYMENT_NOT_FOUND` | 404 | verify | Unknown reference or not yours |
| `ALREADY_PAID` / `CHECKOUT_EXPIRED` | 409 | checkout with an old `idempotencyKey` | Start a new checkout |
| `CHECKOUT_FAILED` | 502 | checkout | Gateway error; retry |
| `PAYMENTS_UNAVAILABLE` | 503 | checkout | Gateway not configured |
| `RATE_LIMITED` | 429 | | Slow down |

---

## 13. Rate limits

Per user (per IP when logged out). Exceeding one returns `429 RATE_LIMITED`.

| Routes | Limit |
| --- | --- |
| Question fetch and answer submit | 180 / minute |
| Start a session | 30 / minute |
| Share-link resolve and play-info | 30 / minute |
| Checkout start and payment verify | 10 / 10 minutes |
| Brand URL click | 20 / minute |
| Image upload | 60 / 10 minutes |
| Generate cards from a document | 10 / 10 minutes, plus the daily allowance in 7.4 |
| Create/edit quizzes, campaigns and cards | 120 / minute |

---

## 14. Environment variables

**Frontend-relevant**

| Variable | Why it matters to the frontend |
| --- | --- |
| `FRONTEND_URL` | Origin used to build `shareUrl` (`/q/:slug`), the payment return URL (`/payment/verify?reference=`) and the password-reset link (`/reset-password?token=`). The frontend must serve those three routes |

**Backend**

| Variable | Purpose |
| --- | --- |
| `PORT`, `NODE_ENV`, `TRUST_PROXY` | Server |
| `DB_URI`, `REDIS_URL` | MongoDB and Redis |
| `ACCESS_TOKEN`, `REFRESH_TOKEN`, `ACCESS_TOKEN_EXPIRE`, `REFRESH_TOKEN_EXPIRE`, `ACTIVATION_SECRET` | JWT secrets and lifetimes |
| `PAYSTACK_SECRET_KEY`, `TRANSFER_PROVIDER` | Payment gateway and withdrawals |
| `PAYMENT_CURRENCY`, `PRO_PRICE_AMOUNT`, `PRO_DURATION_DAYS`, `CAMPAIGN_PRICE_AMOUNT`, `CAMPAIGN_DURATION_DAYS`, `CAMPAIGN_INTERRUPTION_THRESHOLD`, `GAME_SUBMIT_GRACE_MS`, `TRIVIA_IMAGE_PERCENT` | Defaults for the settings in section 9 (an admin override wins) |
| `WIKIMEDIA_CONTACT` | Contact email or URL sent to Wikimedia with image-import requests |
| `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` | Claude API key for trivia from a document (without it the feature answers `503 AI_NOT_CONFIGURED`), and the model that writes the cards (default `claude-haiku-4-5-20251001`) |
| `QUIZ_GENERATE_DAILY_LIMIT_FREE`, `QUIZ_GENERATE_DAILY_LIMIT_PRO` | Defaults for the daily document allowance (an admin override wins) |
| `STORAGE_PROVIDER` (`firebase` \| `aws` \| `memory`), `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_S3_BUCKET_NAME`, `AWS_S3_PUBLIC_BASE_URL`, `FIREBASE_STORAGE_BUCKET` | Image storage |
| `TYPE`, `PROJECT_ID`, `PRIVATE_KEY_ID`, `PRIVATE_KEY`, `CLIENT_EMAIL`, `CLIENT_ID`, `AUTH_URI`, `TOKEN_URI`, `AUTH_PROVIDER_CERT_URL`, `CLIENT_CERT_URL`, `UNIVERSE_DOMAIN` | Firebase service account (Google sign-in, Firebase storage) |
| `EMAIL_PROVIDER`, `SMTP_*`, `SENDGRID_API_KEY`, `TWILIO_SMTP_*`, `AWS_SES_FROM_EMAIL` | Email |
| `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD`, `SEED_BRAND_EMAIL`, `SEED_BRAND_PASSWORD`, `SEED_CONFIRM` | Seed script |

See `.env.example` for the full annotated list.

---

## 15. What was removed

There is no Match game and no study step. These routes no longer exist and return `404`:
`/match/*`, `/admin/match/*`, `GET /trivia/sessions/:id/study` and
`POST /trivia/sessions/:id/quiz/begin`. The error codes `STUDY_PHASE_OVER`, `QUIZ_NOT_STARTED`,
`LEVEL_LOCKED`, `LEVEL_NOT_FOUND`, `ARTIFACT_NOT_FOUND`, `TIMER_NOT_IN_LEVEL_CONFIG` and every
`ATTEMPT_*` code are gone with them.

There are no points, leaderboards, rankings, ads, spin wheel, reward codes, prize draws or
referral rewards. These routes no longer exist and return `404`:

`/leaderboards/*`, `/referrals/*`, `/raffles/*`, `/sessions/*`, `/packages*`, `/payouts/*`,
`/prize-pools/*`, `/platform/earnings`, `/gamers`, `/profile/privacy`, `/admin/clear-all-data`,
`/forum/winner-submissions*`, the old `/campaigns*` and `/brands*` routes, and
`/payments/initialize`, `/payments/transactions`, `/payments/calculate-weekly-price`.

Fields that no longer appear on users: `analytics`, `puzzlesSolved`, `privacy`,
`notifications.referralBonusAlerts`, `notifications.leaderboardUpdates`.
