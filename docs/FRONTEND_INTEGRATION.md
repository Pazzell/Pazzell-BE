# Frontend Integration — Backend Changes Handoff

Date: 2026-04-29

Purpose: a concise, implementation-ready handoff for frontend engineers to integrate the recent backend changes (monthly rewards, referrals, Spot-the-Difference, card matching updates, admin features).

---

## 1. Executive Summary

- What changed (high level):

  - Replaced weekly rewards with a monthly rewards engine using a fixed Top-10 prize structure, plus a jackpot raffle and referral winner payouts.
  - Leaderboards updated to support monthly keys (`YYYY-MM`) and use average completion time as a tiebreaker.
  - Referral system added: referral link capture, signup tracking, and successful referral marking when a referred user completes their first puzzle.
  - New puzzle type: `spot_the_difference` (replaces `whack_a_mole`). `card_matching` now uses server-generated `cardImages` (16 images / 8 pairs).
  - Scoring simplified to fixed points per gameType (Spot=2, Card=3, Sliding=4, etc.).

- Why frontend needs updates:

  - New API endpoints and altered payload shapes for leaderboards, rewards, referrals, and puzzles.
  - Game UI must handle new image flows (original+modified for Spot, cardImages for Card Matching).
  - Admin pages must expose monthly winners, payouts, raffle history, and referral reports.

- Scope for frontend work:
  - Update public leaderboard pages, puzzle pages (Spot & Card Matching), user profile/referral UI, and the admin dashboard.

---

## 2. Frontend Features To Update (Checklist)

- Leaderboards
- Referral pages and referral sharing UI
- User profile / dashboard (monthly rank, pending payouts, referral stats)
- Rewards page (monthly Top-10, prize amounts, raffle winner)
- Puzzle pages:
  - Spot-the-Difference page (new)
  - Card Matching page (use `cardImages`)
  - Common submit flow (use `/puzzles/:id/submit`)
- Admin dashboard (monthly winners, payouts, raffle logs, referral events)
- Notifications for winners / referral confirmations

Mark items completed as you implement them.

---

## 3. API Documentation (Implementation-ready)

Prefix: `/api/v1`

Notes: `monthKey` format is `YYYY-MM`. Auth follows existing conventions (cookies + Bearer tokens). Admin endpoints require Admin role.

### Leaderboards & Rewards

- Get Current Monthly Leaderboard

  - Method: GET
  - URL: `/api/v1/leaderboards/monthly`
  - Auth: No
  - Query: `month=YYYY-MM` (optional)
  - Response:
    ```json
    {
      "success": true,
      "month": "2026-04",
      "entries": [
        {
          "position": 1,
          "userId": "u1",
          "username": "alice",
          "points": 120,
          "puzzlesSolved": 30,
          "avgTime": 45000,
          "prize": 100000
        }
      ],
      "prizeStructure": [
        100000, 60000, 50000, 40000, 35000, 30000, 25000, 20000, 15000, 10000
      ],
      "jackpot": { "amount": 65000, "drawn": true, "winnerUserId": "u7" }
    }
    ```

- Get Monthly Leaderboard (by month)

  - Method: GET
  - URL: `/api/v1/leaderboards/monthly/:monthKey`
  - Auth: No
  - Response: same as above for the month.

- Get Monthly Payouts (user/admin)

  - Method: GET
  - URL: `/api/v1/rewards/payouts?month=YYYY-MM&status=pending|paid`
  - Auth: Admin for all users; user for own history
  - Response: array of payouts: `{ userId, monthKey, type, amount, currency, status }`

- Approve / Mark Payout Paid (Admin)
  - Method: PATCH
  - URL: `/api/v1/admin/rewards/payouts/:payoutId/approve`
  - Auth: Admin
  - Body: `{ transactionRef?: string }`
  - Response: updated payout

### Referrals

- Get Referral Summary

  - Method: GET
  - URL: `/api/v1/referrals/summary?month=YYYY-MM&limit=20`
  - Auth: Public / Admin
  - Response:
    ```json
    {
      "success": true,
      "month": "2026-04",
      "summary": [
        {
          "rank": 1,
          "user": { "_id": "u1", "username": "alice" },
          "successfulCount": 5,
          "referredUserIds": ["u9", "u11"]
        }
      ]
    }
    ```

- Get Referral Events (Admin)

  - Method: GET
  - URL: `/api/v1/referrals/events?month=YYYY-MM&eventType=signup|first_puzzle`
  - Auth: Admin recommended
  - Response: `{ success:true, month, count, events: [{ referrerId, referredUserId, eventType, eventAt }] }`

- (Recommended) Get Referral Link (user-facing)
  - Method: GET
  - URL: `/api/v1/users/me/referral-link`
  - Auth: User
  - Response: `{ success:true, referralLink, referralCode? }`

### Puzzles

- List Puzzles / Campaigns

  - Method: GET
  - URL: `/api/v1/puzzles` or `/api/v1/puzzles?gameType=card_matching`
  - Auth: No
  - Response: `{ success:true, campaigns: PuzzleCampaign[] }` where PuzzleCampaign includes `cardImages?: string[]`, `puzzleImageUrl`, `originalImageUrl`.

- Get Puzzle by Id

  - GET `/api/v1/puzzles/:id` (no auth)
  - Response: `{ success:true, puzzle: { puzzleId, puzzleImageUrl, originalImageUrl, questions } }

- Submit Puzzle Result
  - POST `/api/v1/puzzles/:id/submit`
  - Auth: User required (for points/referral)
  - Body: `{
  timeTaken: number, movesTaken?: number, solved: boolean, answers?: number[], differencesFound?: [{x,y,width,height}]
}`
  - Response: `{ success:true, attempt: { firstTimeSolved:boolean, pointsEarned:number, ... }, gameType }

### Admin & Raffle

- Finalize Monthly Rewards (Admin trigger, optional)

  - POST `/api/v1/admin/rewards/finalize?month=YYYY-MM`
  - Auth: Admin
  - Response: `{ success:true, monthKey, top10, referralTop, payoutsCreated }

- Raffle / Jackpot Logs
  - GET `/api/v1/admin/raffles?month=YYYY-MM`
  - Auth: Admin
  - Response: `{ draws: [{ monthKey, candidates, winner, amount, drawnAt }] }

---

## 4. Response Type Definitions (TypeScript)

Add these interfaces to your frontend `api/types` or `models` folder.

```ts
// api/types/leaderboard.ts
export interface LeaderboardEntry {
  position: number;
  userId: string;
  username?: string;
  avatar?: string;
  points: number;
  puzzlesSolved: number;
  avgTime?: number | null; // ms
  prize?: number | null; // NGN
}

export interface MonthlyLeaderboardResponse {
  success: true;
  month: string; // YYYY-MM
  entries: LeaderboardEntry[];
  prizeStructure?: number[];
  jackpot?: { amount: number; drawn: boolean; winnerUserId?: string };
}

// api/types/referral.ts
export interface ReferralSummaryRow {
  rank: number;
  user: {
    _id?: string;
    firstName?: string;
    lastName?: string;
    username?: string;
    avatar?: string;
  };
  successfulCount: number;
  referredUserIds: string[];
}

export interface ReferralSummaryResponse {
  success: true;
  month: string;
  summary: ReferralSummaryRow[];
}

// api/types/puzzle.ts
export type GameType =
  | "spot_the_difference"
  | "card_matching"
  | "sliding_puzzle"
  | "word_hunt";

export interface PuzzleCampaign {
  _id: string;
  brandId?: string;
  gameType: GameType;
  title?: string;
  description?: string;
  puzzleImageUrl?: string;
  originalImageUrl?: string;
  cardImages?: string[]; // length 16 (8 pairs)
  timeLimit?: number;
  questions?: { question: string; choices: string[]; correctIndex: number }[];
}

export interface PuzzleSubmitRequest {
  timeTaken: number;
  movesTaken?: number;
  solved: boolean;
  answers?: number[];
  differencesFound?: { x: number; y: number; width: number; height: number }[];
}

export interface PuzzleSubmitResponse {
  success: true;
  attempt: any;
  gameType: GameType;
}
```

---

## 5. Frontend Implementation Guidance (practical)

- Leaderboard UI

  - Show `avgTime` as secondary metric and label as "Average Completion Time" with format mm:ss or s.ms.
  - Display `prize` if present next to positions 1–10. Use `prizeStructure` to render a legend / prize table for clarity.

- Spot-the-Difference

  - Load `originalImageUrl` and `puzzleImageUrl`. If only `puzzleImageUrl` is sent, present both views if possible.
  - Implement a difference-marking UI; submit `differencesFound` optional payload and `timeTaken`.
  - Points are awarded server-side; frontend only sends completion data.

- Card Matching

  - Use `cardImages` array. If array missing or invalid length, show fallback.
  - Render grid of 16 cards; matches are identical image pairs.

- Referral

  - Build referral link using either `/users/me/referral-link` or `signup?ref=<username|id>`.
  - Show referral progress and successful referrals count. Provide share/copy UI.

- Admin
  - Create `Monthly Rewards` page showing Top-10, referral winner, and raffle winner; include payout statuses and actions to mark paid.

---

## 6. Sample Requests

Fetch monthly leaderboard (current month):

```bash
curl -X GET "https://api.example.com/api/v1/leaderboards/monthly"
```

Submit puzzle completion:

```bash
curl -X POST "https://api.example.com/api/v1/puzzles/<puzzleId>/submit" \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"timeTaken":120000,"movesTaken":34,"solved":true}'
```

Get referral summary for April 2026:

```bash
curl -X GET "https://api.example.com/api/v1/referrals/summary?month=2026-04"
```

---

## 7. QA & Migration Checklist (Staging)

1. Deploy backend to staging and update frontend env to staging base URL.
2. Verify puzzle listing returns `cardImages` for card campaigns and `originalImageUrl` + `puzzleImageUrl` for spot campaigns.
3. Create test brand and campaigns for spot & card matching. Upload images via admin if needed.
4. Create test users and simulate referrals: sign up using `?ref=` links, then complete one puzzle for referred users; confirm server marks referral successful and events appear in `/referrals/events`.
5. Trigger monthly finalize (admin endpoint or wait last-day scheduler) and confirm `/leaderboards/monthly` and `/rewards/payouts` show expected entries.
6. Test admin payout approve flow (PATCH) and confirm statuses update.

---

## 8. Next deliverables (optional)

- I can generate a Postman collection or an SDK (TypeScript) wrapper for these endpoints.
- I can create minimal React components or storybook mocks for Spot-the-Difference and Card Matching.

---

Contact: backend engineer (see repo `README.md`) for any missing fields, auth details, or sample data.
