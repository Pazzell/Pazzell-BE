# Referral API — Frontend Integration Guide

## How the Referral System Works

1. **John shares his referral link** (containing his userId, username, or email)
2. **Peter signs up** using John's referral link → Peter immediately gets **+1 signup bonus point**
3. **Peter plays and solves his first puzzle** → Peter earns puzzle points AND John gets **+3 referral bonus points**
4. Leaderboard total = **puzzle points + referral bonus points** (resets each month)

---

## Step 1 — Pass Referral Info at Signup

When Peter signs up using John's referral link, include **one** of these fields in the signup body:

```http
POST /api/v1/auth/register/gamer
Content-Type: application/json

{
  "firstName": "Peter",
  "lastName": "Smith",
  "email": "peter@example.com",
  "password": "secret123",
  "referralCode": "john_username"   // OR referrerId: "john's userId", OR referrerUsername: "john_username"
}
```

| Field | Value | When to use |
|-------|-------|-------------|
| `referrerId` | John's MongoDB `_id` | Most reliable — use when you have the ID |
| `referrerUsername` | John's `username` | Use with username-based referral links |
| `referralCode` | Same as username/email | Generic field, accepts userId, username, or email |

**Same fields work for Google OAuth signup:**
```http
POST /api/v1/auth/google
{
  "idToken": "firebase_id_token",
  "referralCode": "john_username"
}
```

### Response
```json
{
  "success": true,
  "message": "Registration successful! Please check your email to verify your account.",
  "activationToken": "..."
}
```

> Peter's `analytics.lifetime.totalPoints` is incremented by **1** immediately upon successful signup with a valid referral code.

---

## Step 2 — Get the Referral Link / Code

Each user's referral code is their **username**. Fetch it from the user profile:

```http
GET /api/v1/me
Authorization: Bearer <token>
```

```json
{
  "user": {
    "_id": "abc123",
    "username": "john_doe",
    ...
  }
}
```

**Construct the referral link:**
```
https://yourapp.com/signup?ref=john_doe
```

On the signup page, read `?ref=` from the URL and pass it as `referralCode` in the signup body.

---

## Step 3 — Display the Referral Dashboard (Authenticated User)

```http
GET /api/v1/referrals/my-stats?month=2026-06
Authorization: Bearer <token>
```

**Query params:**
| Param | Default | Description |
|-------|---------|-------------|
| `month` | current month | `YYYY-MM` format |

**Response:**
```json
{
  "success": true,
  "month": "2026-06",
  "stats": {
    "totalReferrals": 5,
    "pendingReferrals": 2,
    "successfulReferralsThisMonth": 3,
    "referralPointsThisMonth": 9,
    "totalReferralPointsAllTime": 15,
    "referredUsersThisMonth": [
      {
        "userId": "...",
        "fullName": "Peter Smith",
        "username": "peter_smith",
        "avatar": "https://...",
        "successfulAt": "2026-06-25T10:00:00Z",
        "pointsAwarded": 3
      }
    ]
  }
}
```

**What to show on the dashboard:**
- **Referral Count**: `stats.successfulReferralsThisMonth` (this month) or `stats.totalReferrals` (all time)
- **Referral Points Earned**: `stats.referralPointsThisMonth` (this month) or `stats.totalReferralPointsAllTime`
- **Pending**: `stats.pendingReferrals` (signed up but haven't completed first puzzle yet)
- **Referred Users List**: `stats.referredUsersThisMonth`

---

## Step 4 — Display the Monthly Leaderboard

```http
GET /api/v1/leaderboards/monthly
```

**Response:**
```json
{
  "success": true,
  "leaderboard": {
    "type": "monthly",
    "monthKey": "2026-06",
    "resetsAt": "End of 2026-06",
    "totalPlayers": 25,
    "entries": [
      {
        "position": 1,
        "userId": "...",
        "fullName": "John Doe",
        "username": "john_doe",
        "avatar": "https://...",
        "puzzlesSolved": 10,
        "puzzlePoints": 12,
        "referralPoints": 9,
        "referralCount": 3,
        "totalPoints": 21
      }
    ]
  }
}
```

**What to show per row:**
| Column | Field |
|--------|-------|
| Rank | `position` |
| Player | `fullName` / `username` / `avatar` |
| Puzzle Points | `puzzlePoints` |
| Referral Bonus | `referralPoints` |
| Total Points | `totalPoints` |

> The leaderboard **resets automatically** at the start of each new month (data is scoped to the current month).

---

## Step 5 — Weekly Leaderboard

```http
GET /api/v1/leaderboards/weekly
```

Returns puzzle points only (no referral breakdown) for the current week (Mon–Sun).

---

## Points Reference

| Action | Points |
|--------|--------|
| Solve a puzzle (first time per day) — any game | **+1** |
| Solve a sliding puzzle (first time per day) | **+2** |
| Sign up via a referral link | **+1** (for the new user) |
| A referral you made completes their first puzzle | **+3** (for the referrer) |

> Monthly leaderboard `totalPoints = puzzlePoints + referralPoints` and resets at month end.

---

## All Referral Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/v1/referrals/my-stats?month=YYYY-MM` | Required | Authenticated user's own referral stats |
| `GET` | `/api/v1/referrals/summary?month=YYYY-MM&limit=20` | None | Top referrers leaderboard |
| `GET` | `/api/v1/referrals/events?month=YYYY-MM&eventType=signup` | None | Referral event log |

---

## Testing the Flow (Postman / curl)

```bash
# 1. Register John
POST /api/v1/auth/register/gamer
{ "firstName":"John","lastName":"Doe","email":"john@test.com","password":"pass123" }
# Activate John's account, then login → get John's token

# 2. Get John's username
GET /api/v1/me   (Authorization: Bearer john_token)
# e.g. username = "john_doe"

# 3. Register Peter with John's referral
POST /api/v1/auth/register/gamer
{ "firstName":"Peter","lastName":"Smith","email":"peter@test.com","password":"pass123","referralCode":"john_doe" }
# Peter gets +1 point at signup

# 4. Peter solves his first puzzle
POST /api/v1/campaigns/:campaignId/submit
Authorization: Bearer peter_token
{ "timeTaken":30000,"movesTaken":20,"solved":true,"answers":[0,1,2,1,3] }
# Peter gets +1 (or +2 for sliding_puzzle); John gets +3 referral bonus

# 5. Check John's referral dashboard
GET /api/v1/referrals/my-stats
Authorization: Bearer john_token
# stats.referralPointsThisMonth = 3, stats.successfulReferralsThisMonth = 1

# 6. Check leaderboard
GET /api/v1/leaderboards/monthly
# John's entry: puzzlePoints + referralPoints = totalPoints
```
