# Pazzell API End-to-End Testing Guide (Postman)

## Base URL
```
http://localhost:4000/api/v1
```

## Authentication
- **Type**: JWT Bearer Token
- **Header**: `Authorization: Bearer <accessToken>`
- **Token Expiry**: ~1 hour (access), ~7 days (refresh)
- **Refresh Endpoint**: `POST /refresh`

---

## LEGEND
- 🔓 = No authentication required
- 🔐 = Requires JWT Bearer Token
- 👤 = Gamer role required
- 🏢 = Brand role required
- 🛡️ = Admin role required
- 📎 = Requires file upload (multipart/form-data)
- 📋 = JSON body only

---

## PART 1: AUTHENTICATION

---

### 1.1 Register as Gamer 🔓 📋
**POST** `/auth/gamer/register`

```json
{
  "firstName": "John",
  "lastName": "Doe",
  "email": "gamer@example.com",
  "password": "securePass123"
}
```

Optional referral fields:
```json
{
  "firstName": "John",
  "lastName": "Doe",
  "email": "gamer@example.com",
  "password": "securePass123",
  "referrerId": "userId_of_referrer",
  "referrerUsername": "referrer_username",
  "referralCode": "referral_code"
}
```

**Expected Response (201)**:
```json
{
  "success": true,
  "message": "Registration successful! Please check your email to verify your account.",
  "activationToken": "<jwt_activation_token>"
}
```
> Save the `activationToken` — you'll need it for activation.

---

### 1.2 Register as Brand 🔓 📋
**POST** `/auth/brand/register`

```json
{
  "name": "Brand Admin Name",
  "email": "admin@company.com",
  "password": "securePass123",
  "companyName": "Brand Company Ltd"
}
```

**Expected Response (201)**:
```json
{
  "success": true,
  "message": "Registration successful! Please check your email to verify your account.",
  "activationToken": "<jwt_activation_token>"
}
```

---

### 1.3 Activate Account 🔓 📋
**POST** `/auth/user/activate`

```json
{
  "activation_token": "<activationToken_from_registration>",
  "activation_code": "123456"
}
```
> The `activation_code` is the 4-6 digit code sent to the user's email.

**Expected Response (200)**:
```json
{
  "success": true,
  "user": { ... },
  "accessToken": "<jwt_access_token>"
}
```

---

### 1.4 Resend Activation Email 🔓 📋
**POST** `/auth/user/resend-activation`

```json
{
  "email": "gamer@example.com"
}
```

**Expected Response (200)**:
```json
{
  "success": true,
  "message": "Activation email resent to gamer@example.com",
  "activationToken": "<new_activation_token>"
}
```

---

### 1.5 Login 🔓 📋
**POST** `/auth/login`

```json
{
  "email": "gamer@example.com",
  "password": "securePass123"
}
```

**Expected Response (200)**:
```json
{
  "success": true,
  "user": {
    "_id": "user_id",
    "firstName": "John",
    "email": "gamer@example.com",
    "role": "gamer"
  },
  "accessToken": "<jwt_access_token>"
}
```
> Save the `accessToken` for authenticated requests.

---

### 1.6 Google OAuth Sign-in/Sign-up 🔓 📋
**POST** `/auth/google`

Option 1 — Firebase ID token:
```json
{
  "idToken": "<firebase_id_token>"
}
```

Option 2 — Manual profile:
```json
{
  "email": "user@gmail.com",
  "name": "John Doe",
  "googleId": "google_uid_123",
  "avatar": "https://lh3.googleusercontent.com/...",
  "givenName": "John",
  "familyName": "Doe"
}
```

---

### 1.7 Forgot Password 🔓 📋
**POST** `/auth/forgot-password`

```json
{
  "email": "gamer@example.com"
}
```

**Expected Response (200)**:
```json
{
  "success": true,
  "message": "If an account with that email exists, a password reset link has been sent."
}
```

---

### 1.8 Reset Password 🔓 📋
**POST** `/auth/reset-password`

```json
{
  "token": "<reset_token_from_email_link>",
  "new_password": "newSecurePass123"
}
```

**Expected Response (200)**:
```json
{
  "success": true,
  "message": "Password reset successful. You can now log in with your new password."
}
```

---

### 1.9 Refresh Access Token 🔓 📋
**POST** `/refresh`

```json
{}
```
> Uses the refresh token stored in HttpOnly cookie automatically.

**Expected Response (200)**:
```json
{
  "success": true,
  "accessToken": "<new_jwt_access_token>"
}
```

---

### 1.10 Logout 🔐 📋
**POST** `/auth/logout`

```json
{}
```
> Set Header: `Authorization: Bearer <accessToken>`

**Expected Response (200)**:
```json
{
  "success": true
}
```

---

## PART 2: USER PROFILE

---

### 2.1 Get Current User 🔐 📋
**GET** `/me`

> No body required. Set Header: `Authorization: Bearer <accessToken>`

**Expected Response (200)**:
```json
{
  "success": true,
  "user": {
    "_id": "user_id",
    "firstName": "John",
    "lastName": "Doe",
    "email": "gamer@example.com",
    "role": "gamer",
    "username": "johndoe",
    "isVerified": true
  }
}
```

---

### 2.2 Get Gamer Profile (with analytics) 🔐 👤 📋
**GET** `/profile/gamer`

> No body. Set Header: `Authorization: Bearer <accessToken>`

**Expected Response (200)**:
```json
{
  "success": true,
  "profile": {
    "_id": "user_id",
    "firstName": "John",
    "analytics": {
      "lifetime": {
        "attempts": 150,
        "puzzlesSolved": 120,
        "totalPoints": 450,
        "totalEarnings": 25000
      }
    }
  }
}
```

---

### 2.3 Get Brand Profile 🔐 🏢 📋
**GET** `/profile/brand`

> No body. Set Header: `Authorization: Bearer <accessToken>` (brand account)

---

### 2.4 Update Gamer Profile 🔐 👤 📎
**PUT** `/profile/gamer`

Content-Type: `multipart/form-data`

| Field | Type | Required |
|-------|------|----------|
| `avatar` | File (PNG/JPG) | No |
| `firstName` | Text | No |
| `lastName` | Text | No |
| `email` | Text | No |

> To update without avatar, you can send `application/json` with only text fields.

---

### 2.5 Update Brand Profile 🔐 🏢 📎
**PUT** `/profile/brand`

Content-Type: `multipart/form-data`

| Field | Type | Required |
|-------|------|----------|
| `avatar` | File (PNG/JPG) | No |
| `companyName` | Text | No |
| `email` | Text | No |

---

## PART 3: PACKAGES

---

### 3.1 Get All Packages 🔐 📋
**GET** `/packages`

> Set Header: `Authorization: Bearer <accessToken>`

**Expected Response (200)**:
```json
{
  "success": true,
  "packages": [
    {
      "_id": "package_id",
      "name": "basic",
      "amount": 7000,
      "priority": 1,
      "isActive": true
    },
    {
      "_id": "package_id",
      "name": "premium",
      "amount": 10000,
      "priority": 2,
      "isActive": true
    }
  ]
}
```
> Save a `package._id` for creating campaigns.

---

### 3.2 Get Package by ID 🔐 📋
**GET** `/packages/:packageId`

> Replace `:packageId` with actual ID.

---

### 3.3 Create Package (Admin Only) 🛡️ 📋
**POST** `/packages`

```json
{
  "name": "enterprise",
  "amount": 15000,
  "priority": 3,
  "description": "Enterprise package - Maximum visibility"
}
```

---

## PART 4: CAMPAIGNS

---

### 4.1 Get All Campaigns 🔓 📋
**GET** `/campaigns`

Optional query params:
```
?gameType=sliding_puzzle
?status=active
?paymentStatus=paid
```

Game type values: `sliding_puzzle` | `card_matching` | `spot_the_difference` | `word_hunt`

---

### 4.2 Get Active Campaigns Only 🔓 📋
**GET** `/campaigns/active`

Optional: `?gameType=sliding_puzzle`

---

### 4.3 Get Single Campaign 🔓 📋
**GET** `/campaigns/:campaignId`

---

### 4.4 Get Campaigns by Brand 🔓 📋
**GET** `/campaigns/brand/:brandId`

---

### 4.5 Create Campaign (Brand Only) 🔐 🏢 📎
**POST** `/brands/campaigns`

Content-Type: `multipart/form-data`

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `image` | File (PNG/JPG, max 50MB) | Yes | Puzzle/campaign image |
| `title` | Text | Yes | Campaign title |
| `description` | Text | Yes | Campaign description |
| `gameType` | Text | Yes | `sliding_puzzle`, `card_matching`, `spot_the_difference`, `word_hunt` |
| `packageId` | Text | Yes | MongoDB ID from `/packages` |
| `brandUrl` | Text | No | Brand website URL |
| `campaignUrl` | Text | No | Campaign landing page URL |
| `videoUrl` | Text | No | Promo video URL |
| `timeLimit` | Text | No | In hours, default: 168 (7 days) |
| `questions` | Text (JSON string) | No | Array of quiz questions |
| `words` | Text (JSON string) | No | Array of words (for word_hunt) |

Sample `questions` value (as JSON string in form-data):
```json
[
  {
    "question": "What is the brand's main product?",
    "choices": ["Shoes", "Phones", "Food", "Clothes"],
    "correctAnswer": 1
  },
  {
    "question": "What year was the brand founded?",
    "choices": ["2010", "2015", "2018", "2020"],
    "correctAnswer": 2
  }
]
```

Sample `words` for word_hunt (JSON string):
```json
["BRAND", "PUZZLE", "GAME", "WIN", "PLAY"]
```

**Expected Response (201)**:
```json
{
  "success": true,
  "campaign": {
    "_id": "campaign_id",
    "title": "My Campaign",
    "gameType": "sliding_puzzle",
    "status": "draft",
    "paymentStatus": "unpaid"
  },
  "message": "Campaign created and published successfully"
}
```
> Save the `campaign._id` for payment and other operations.

---

### 4.6 Get Campaign Analytics (Brand Only) 🔐 🏢 📋
**GET** `/brands/analytics`

---

### 4.7 Check Campaign Completion Status 🔐 📋
**GET** `/campaigns/:campaignId/completion`

> Checks if the authenticated gamer has completed this campaign.

---

### 4.8 Submit Campaign Result (Play Game) 🔐 👤 📋
**POST** `/campaigns/:campaignId/submit`

```json
{
  "timeTaken": 45000,
  "movesTaken": 125,
  "solved": true,
  "answers": [0, 2, 1]
}
```

Field notes:
- `timeTaken`: milliseconds taken to complete
- `movesTaken`: number of moves made
- `solved`: `true` if completed, `false` if gave up
- `answers`: array of selected choice indices for quiz questions

**Expected Response (201)**:
```json
{
  "success": true,
  "attempt": {
    "_id": "attempt_id",
    "timeTaken": 45000,
    "movesTaken": 125,
    "solved": true,
    "firstTimeSolved": true,
    "quizScore": 2,
    "pointsEarned": 4
  },
  "gameType": "sliding_puzzle"
}
```

---

### 4.9 Get Campaign Budget 🔓 📋
**GET** `/campaigns/:campaignId/budget`

**Expected Response (200)**:
```json
{
  "success": true,
  "budget": {
    "packageType": "basic",
    "totalBudget": 7000,
    "dailyAllocation": 500,
    "budgetUsed": 2500,
    "budgetRemaining": 4500,
    "paymentStatus": "paid",
    "daysRemaining": 3
  }
}
```

---

### 4.10 Update Campaign 🔐 🏢 📋
**PATCH** `/campaigns/:campaignId`

```json
{
  "title": "Updated Campaign Title",
  "description": "Updated description"
}
```

---

### 4.11 Delete Campaign 🔐 🏢 📋
**DELETE** `/campaigns/:campaignId`

> No body required.

---

## PART 5: PAYMENTS

---

### 5.1 Initialize Payment (Brand Only) 🔐 🏢 📋
**POST** `/payments/initialize`

```json
{
  "campaignId": "<campaign_id_from_create>",
  "email": "brand@company.com"
}
```

**Expected Response (200)**:
```json
{
  "success": true,
  "data": {
    "authorization_url": "https://checkout.paystack.com/...",
    "access_code": "paystack_access_code",
    "reference": "campaign_123_1234567890_abc123"
  }
}
```
> Open the `authorization_url` in a browser to complete payment. Save the `reference`.

---

### 5.2 Verify Payment (Brand Only) 🔐 🏢 📋
**GET** `/payments/verify/:reference`

> Replace `:reference` with the reference from initialization.

**Expected Response (200)**:
```json
{
  "success": true,
  "message": "Payment verified successfully",
  "transaction": {
    "reference": "campaign_123_...",
    "amount": 7000,
    "status": "success",
    "packageType": "basic"
  }
}
```

---

### 5.3 Get Transaction History (Brand Only) 🔐 🏢 📋
**GET** `/payments/transactions`

---

### 5.4 Paystack Webhook 🔓
**POST** `/payments/webhook`

> This is called by Paystack automatically — do NOT call this manually in Postman for testing.

---

## PART 6: LEADERBOARDS

---

### 6.1 Get Weekly Leaderboard (Current Week) 🔓
**GET** `/leaderboards/weekly`

**Expected Response (200)**:
```json
{
  "success": true,
  "weekKey": "2025-01-06_to_2025-01-12",
  "leaderboard": [
    {
      "position": 1,
      "userId": "user_id",
      "firstName": "John",
      "username": "johndoe",
      "score": 150,
      "totalEarnings": 5000
    }
  ]
}
```

---

### 6.2 Get Weekly Leaderboard by Week 🔓
**GET** `/leaderboards/weekly/:weekKey`

> Example: `/leaderboards/weekly/2025-01-06_to_2025-01-12`

---

### 6.3 Get Monthly Leaderboard (Current Month) 🔓
**GET** `/leaderboards/monthly`

---

### 6.4 Get Monthly Leaderboard by Month 🔓
**GET** `/leaderboards/monthly/:monthKey`

> Example: `/leaderboards/monthly/2025-01`

---

### 6.5 Get All-Time Leaderboard 🔓
**GET** `/leaderboards/all-time`

---

## PART 7: REFERRALS

---

### 7.1 Get Referral Summary by Month 🔓
**GET** `/referrals/summary`

Optional: `?month=2025-01&limit=20`

**Expected Response (200)**:
```json
{
  "success": true,
  "month": "2025-01",
  "summary": [
    {
      "rank": 1,
      "user": {
        "firstName": "John",
        "username": "johndoe"
      },
      "successfulCount": 25
    }
  ]
}
```

---

### 7.2 Get Referral Events 🔓
**GET** `/referrals/events`

Optional: `?month=2025-01&eventType=signup`

Event type values: `signup` | `first_puzzle`

---

## PART 8: ANALYTICS

---

### 8.1 Get App Analytics (Public) 🔓
**GET** `/analytics/app`

**Expected Response (200)**:
```json
{
  "success": true,
  "analytics": {
    "totalGamesPlayed": 50000,
    "gamesPlayedToday": 1250,
    "currentlyPlaying": 45,
    "onlineUsers": 320
  }
}
```

---

### 8.2 Mark Game Started 🔐 📋
**POST** `/analytics/game/start`

```json
{
  "campaignId": "<campaign_id>"
}
```

---

### 8.3 Mark Game Stopped 🔐 📋
**POST** `/analytics/game/stop`

```json
{}
```

---

### 8.4 Mark User Online (Heartbeat) 🔐 📋
**POST** `/analytics/user/online`

```json
{}
```
> Call every 2-3 minutes to keep user marked as online.

---

### 8.5 Mark User Offline 🔐 📋
**POST** `/analytics/user/offline`

```json
{}
```

---

## PART 9: PRIZE POOLS & PAYOUTS

---

### 9.1 Get Daily Prize Pool 🔓
**GET** `/prize-pools/daily/:date`

> Example: `/prize-pools/daily/2025-01-15`

**Expected Response (200)**:
```json
{
  "success": true,
  "prizePool": {
    "date": "2025-01-15",
    "totalDailyPool": 150000,
    "platformFee": 45000,
    "gamerShare": 105000,
    "campaigns": 8
  }
}
```

---

### 9.2 Get Weekly Prize Pool Summary 🔓
**GET** `/prize-pools/weekly/summary`

---

### 9.3 Get Today's Prize Table 🔓
**GET** `/prize-table/today`

---

### 9.4 Get Prize Table by Date 🔓
**GET** `/prize-table/date/:date`

> Example: `/prize-table/date/2025-01-15`

---

### 9.5 Get Gamer Payout History 🔐 👤
**GET** `/payouts/my-earnings`

**Expected Response (200)**:
```json
{
  "success": true,
  "payouts": [
    {
      "weekKey": "2025-01-06_to_2025-01-12",
      "position": 5,
      "amount": 2500,
      "status": "processed"
    }
  ],
  "totalEarnings": 15000
}
```

---

## PART 10: ADMIN ENDPOINTS

---

### 10.1 Calculate Daily Prize Pool 🛡️ 📋
**POST** `/prize-pools/daily/calculate`

```json
{
  "date": "2025-01-15"
}
```

---

### 10.2 Calculate Weekly Payouts 🛡️ 📋
**POST** `/payouts/weekly/calculate`

```json
{
  "weekKey": "2025-01-06_to_2025-01-12"
}
```

---

### 10.3 Get Week's Payouts 🛡️
**GET** `/payouts/week/:weekKey`

> Example: `/payouts/week/2025-01-06_to_2025-01-12`

---

### 10.4 Process Payouts 🛡️ 📋
**POST** `/payouts/process`

```json
{
  "weekKey": "2025-01-06_to_2025-01-12",
  "payoutIds": ["payout_id_1", "payout_id_2"]
}
```

---

### 10.5 Get Platform Earnings 🛡️
**GET** `/platform/earnings`

Optional: `?startDate=2025-01-01&endDate=2025-01-31`

---

### 10.6 Clear All Gamer Data 🛡️ 📋
**POST** `/admin/clear-all-data`

```json
{}
```
> ⚠️ **DANGEROUS** — Clears all gamer data. Use only in test environments.

---

## PART 11: BRANDS LIST

---

### 11.1 Get All Brands 🔓
**GET** `/brands`

---

### 11.2 Get All Gamers 🔓
**GET** `/gamers`

---

## END-TO-END TESTING FLOW

Follow this order for a complete E2E test:

```
1.  POST /auth/gamer/register         → get activationToken
2.  POST /auth/user/resend-activation → (optional, test resend)
3.  POST /auth/user/activate          → get accessToken (GAMER)
4.  POST /auth/login                  → (optional, test login)
5.  GET  /me                          → verify gamer session
6.  GET  /profile/gamer               → check gamer profile

7.  POST /auth/brand/register         → get activationToken (BRAND)
8.  POST /auth/user/activate          → get accessToken (BRAND)
9.  GET  /me                          → verify brand session

10. GET  /packages                    → get packageId
11. POST /brands/campaigns            → create campaign (multipart), get campaignId
12. GET  /campaigns                   → list all campaigns
13. GET  /campaigns/:campaignId       → view single campaign
14. POST /payments/initialize         → get authorization_url + reference
    → Open authorization_url in browser and complete payment
15. GET  /payments/verify/:reference  → verify payment success
16. GET  /campaigns/:campaignId/budget → check budget after payment

17. Switch to GAMER token
18. POST /analytics/game/start        → mark game start
19. POST /campaigns/:campaignId/submit → submit game result
20. GET  /campaigns/:campaignId/completion → check completion
21. POST /analytics/game/stop         → mark game stop

22. GET  /leaderboards/weekly         → check weekly leaderboard
23. GET  /leaderboards/monthly        → check monthly leaderboard
24. GET  /leaderboards/all-time       → check all-time leaderboard

25. GET  /referrals/summary           → check referral rankings
26. GET  /referrals/events            → check referral events

27. GET  /payouts/my-earnings         → check gamer payout history
28. GET  /prize-table/today           → check prize table

29. POST /auth/forgot-password        → test forgot password
30. POST /auth/reset-password         → test password reset

31. POST /auth/logout                 → logout
```

---

## COMMON ERROR RESPONSES

| Status | Body |
|--------|------|
| 400 | `{"success": false, "message": "Missing required fields"}` |
| 401 | `{"success": false, "message": "Please login to access this resource"}` |
| 403 | `{"success": false, "message": "Role: gamer is not allowed to access this resource"}` |
| 404 | `{"success": false, "message": "Campaign not found"}` |
| 500 | `{"success": false, "message": "Internal server error"}` |

---

## FILE UPLOAD ENDPOINTS SUMMARY

| Endpoint | Field Name | Type | Required |
|----------|-----------|------|----------|
| `POST /brands/campaigns` | `image` | PNG/JPG (max 50MB) | Yes |
| `PUT /profile/gamer` | `avatar` | PNG/JPG (max 50MB) | No |
| `PUT /profile/brand` | `avatar` | PNG/JPG (max 50MB) | No |

---

## NOTES

1. **Unregistered routes**: `/puzzles/*` and `/instant/*` are defined in code but not mounted in the app — they will return 404 until added.
2. **Cookies**: The server sets HttpOnly cookies for refresh tokens automatically — Postman handles these if you enable "Save cookies" in settings.
3. **Paystack**: Payment testing requires real Paystack test keys and test card numbers. Use Paystack test cards (e.g., `4084084084084081`, expiry any future date, CVV `408`).
4. **Role switching**: Keep separate Postman environments or variables for GAMER token and BRAND token.
