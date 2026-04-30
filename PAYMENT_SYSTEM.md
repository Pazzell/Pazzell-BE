thr# Payment System Documentation

## Overview

This payment system handles revenue distribution from brand campaigns to players in the puzzle gaming platform. It implements a fixed daily allocation model with weekly payouts.

## Business Logic

### Revenue Model

- **Basic Package**: ₦7,000 for 7 days
- **Premium Package**: ₦10,000 for 7 days
- **Revenue Split**: 70% to top 10 gamers, 30% to platform
- **Payout Frequency**: Weekly (Sunday night)

### Fixed Daily Allocation

All campaigns use FIXED daily rates regardless of join day:

- **Basic**: ₦7,000 / 7 = ₦1,000/day
- **Premium**: ₦10,000 / 7 = ₦1,428.57/day

### Prize Distribution (Top 10 Gamers)

From the 70% gamer share:

- 1st place: 20%
- 2nd place: 15%
- 3rd place: 10%
- 4th-10th place: 7.875% each

## Database Models

### Transaction Model

Tracks all payment transactions.

```typescript
{
  campaignId: string,
  brandId: string,
  packageType: "basic" | "premium",
  amount: number,
  currency: "NGN",
  reference: string,
  status: "pending" | "success" | "failed",
  paystackResponse: object,
}
```

### Campaign Model (Updated)

Added budget tracking fields:

```typescript
{
  packageType: "basic" | "premium",
  totalBudget: number,
  dailyAllocation: number,
  budgetUsed: number,
  budgetRemaining: number,
  paymentStatus: "unpaid" | "paid" | "partial",
  transactionId: string,
}
```

### DailyPrizePool Model

Tracks daily prize pools.

```typescript
{
  date: "2025-01-15",
  activeCampaigns: [{
    campaignId: string,
    packageType: string,
    dailyAllocation: number,
  }],
  totalDailyPool: number,
  gamerShare: number, // 70%
  platformFee: number, // 30%
  status: "active" | "completed",
}
```

### Payout Model

Tracks weekly payouts to gamers.

```typescript
{
  userId: string,
  weekKey: "2025-01-06_to_2025-01-12",
  position: 1-10,
  points: number,
  puzzlesSolved: number,
  totalDailyPool: number,
  gamerShare: number,
  distributionPercentage: number,
  amount: number,
  status: "pending" | "processed" | "paid" | "failed",
}
```

## API Endpoints

### Payment Endpoints

#### 1. Initialize Payment

```http
POST /api/v1/payments/initialize
Authorization: Bearer <token> (Brand only)

Request Body:
{
  "campaignId": "campaign123",
  "packageType": "basic", // or "premium"
  "email": "brand@example.com"
}

Response:
{
  "success": true,
  "data": {
    "authorization_url": "https://checkout.paystack.com/...",
    "access_code": "...",
    "reference": "campaign_123_..."
  }
}
```

#### 2. Verify Payment

```http
GET /api/v1/payments/verify/:reference
Authorization: Bearer <token>

Response:
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

#### 3. Paystack Webhook

```http
POST /api/v1/payments/webhook
(No authentication - Paystack signature verification)

Automatically processes payment confirmations
```

#### 4. Get Transaction History

```http
GET /api/v1/payments/transactions
Authorization: Bearer <token> (Brand only)

Response:
{
  "success": true,
  "transactions": [...]
}
```

### Campaign Budget

#### Get Campaign Budget Status

```http
GET /api/v1/campaigns/:campaignId/budget

Response:
{
  "success": true,
  "budget": {
    "packageType": "basic",
    "totalBudget": 7000,
    "dailyAllocation": 1000,
    "budgetUsed": 3000,
    "budgetRemaining": 4000,
    "paymentStatus": "paid",
    "daysRemaining": 4,
    "startDate": "2025-01-15",
    "endDate": "2025-01-22"
  }
}
```

### Prize Pool Endpoints

#### 1. Get Daily Prize Pool

```http
GET /api/v1/prize-pools/daily/:date
(Public endpoint)

Example: GET /api/v1/prize-pools/daily/2025-01-15

Response:
{
  "success": true,
  "prizePool": {
    "date": "2025-01-15",
    "totalDailyPool": 5000,
    "gamerShare": 3500,
    "platformFee": 1500,
    "activeCampaigns": [...]
  }
}
```

#### 2. Calculate Daily Prize Pool (Admin/Cron)

```http
POST /api/v1/prize-pools/daily/calculate
Authorization: Bearer <token> (Admin only)

Request Body:
{
  "date": "2025-01-15"
}

Response:
{
  "success": true,
  "message": "Daily prize pool calculated successfully",
  "prizePool": {...}
}
```

#### 3. Get Weekly Prize Pool Summary

```http
GET /api/v1/prize-pools/weekly/summary
(Public endpoint)

Response:
{
  "success": true,
  "summary": {
    "weekKey": "2025-01-06_to_2025-01-12",
    "weekStart": "2025-01-06T00:00:00.000Z",
    "weekEnd": "2025-01-12T23:59:59.999Z",
    "dailyPools": 7,
    "totalWeeklyPool": 35000,
    "weeklyGamerShare": 24500,
    "weeklyPlatformFee": 10500
  }
}
```

### Payout Endpoints

#### 1. Calculate Weekly Payouts (Admin/Cron)

```http
POST /api/v1/payouts/weekly/calculate
Authorization: Bearer <token> (Admin only)

Request Body:
{
  "weekKey": "2025-01-06_to_2025-01-12"
}

Response:
{
  "success": true,
  "message": "Weekly payouts calculated successfully",
  "result": {
    "weekKey": "2025-01-06_to_2025-01-12",
    "totalWeeklyPool": 35000,
    "weeklyGamerShare": 24500,
    "platformFee": 10500,
    "payouts": [...]
  }
}
```

#### 2. Get Gamer's Earnings

```http
GET /api/v1/payouts/my-earnings
Authorization: Bearer <token> (Gamer)

Response:
{
  "success": true,
  "payouts": [...],
  "totalEarnings": 15000
}
```

#### 3. Get Week Payouts (Admin)

```http
GET /api/v1/payouts/week/:weekKey
Authorization: Bearer <token> (Admin only)

Response:
{
  "success": true,
  "weekKey": "2025-01-06_to_2025-01-12",
  "payouts": [...],
  "totalAmount": 24500
}
```

#### 4. Process Payouts (Admin)

```http
POST /api/v1/payouts/process
Authorization: Bearer <token> (Admin only)

Request Body:
{
  "weekKey": "2025-01-06_to_2025-01-12",
  "payoutIds": ["payout1", "payout2", ...]
}

Response:
{
  "success": true,
  "message": "10 payouts marked as processed",
  "modifiedCount": 10
}
```

#### 5. Get Platform Earnings (Admin)

```http
GET /api/v1/platform/earnings?startDate=2025-01-01&endDate=2025-01-31
Authorization: Bearer <token> (Admin only)

Response:
{
  "success": true,
  "period": {
    "startDate": "2025-01-01",
    "endDate": "2025-01-31"
  },
  "summary": {
    "totalRevenue": 140000,
    "totalPlatformFee": 42000,
    "totalGamerShare": 98000,
    "platformPercentage": 30,
    "gamerPercentage": 70
  }
}
```

## Environment Variables

Add these to your `.env` file:

```env
PAYSTACK_SECRET_KEY=sk_test_your_secret_key_here
```

## Testing with Dummy Values

### Test Cards (Paystack Test Mode)

Use these test card numbers:

**Success:**

- Card: 4084084084084081
- CVV: 408
- Expiry: 01/99
- PIN: 0000
- OTP: 123456

**Decline:**

- Card: 5060666666666666666
- CVV: 123
- Expiry: 01/99
- PIN: 1234

### Test Workflow

1. **Initialize Payment:**

```bash
curl -X POST http://localhost:8000/api/v1/payments/initialize \
  -H "Authorization: Bearer YOUR_BRAND_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "campaignId": "YOUR_CAMPAIGN_ID",
    "packageType": "basic",
    "email": "test@example.com"
  }'
```

2. **Visit the authorization_url** returned and complete payment with test card

3. **Verify Payment:**

```bash
curl http://localhost:8000/api/v1/payments/verify/REFERENCE
```

4. **Calculate Daily Prize Pool:**

```bash
curl -X POST http://localhost:8000/api/v1/prize-pools/daily/calculate \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "date": "2025-01-15"
  }'
```

5. **Calculate Weekly Payouts:**

```bash
curl -X POST http://localhost:8000/api/v1/payouts/weekly/calculate \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "weekKey": "2025-01-06_to_2025-01-12"
  }'
```

## Cron Jobs (Recommended)

### Daily Prize Pool Calculation

Run daily at 11:59 PM to calculate the day's prize pool:

```
59 23 * * * curl -X POST http://localhost:8000/api/v1/prize-pools/daily/calculate ...
```

### Weekly Payout Calculation

Run on Sunday at 11:59 PM to calculate weekly payouts:

```
59 23 * * 0 curl -X POST http://localhost:8000/api/v1/payouts/weekly/calculate ...
```

## Budget Rollover

When a campaign ends with unused budget:

- The `budgetRemaining` field tracks unused funds
- Unused funds automatically roll over to the next week
- The fixed daily rate remains constant throughout the campaign lifecycle

## Security Notes

1. **Paystack Webhook Verification**: Always verify the `x-paystack-signature` header
2. **Admin Endpoints**: Protected with `authorizeRoles("admin")`
3. **Brand Endpoints**: Protected with `authorizeRoles("brand")`
4. **Secret Keys**: Never commit `PAYSTACK_SECRET_KEY` to version control

## Support

For issues or questions about the payment system, contact the development team.
