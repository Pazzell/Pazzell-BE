# Payment System Complete Walkthrough

This document walks through the entire payment system flow using a real-world scenario with 5 brands and 15 gamers.

---

# 📊 SCENARIO SETUP

**5 Brands:**
- Brand A: Basic Campaign (Day 1 - Monday)
- Brand B: Basic Campaign (Day 1 - Monday)
- Brand C: Premium Campaign (Day 1 - Monday)
- Brand D: Basic Campaign (Day 2 - Tuesday)
- Brand E: Premium Campaign (Day 3 - Wednesday)

**Pricing:**
- Basic: ₦7,000 total → ₦1,000/day for 7 days
- Premium: ₦10,000 total → ₦1,428.57/day for 7 days

**Week:** Monday - Sunday

**Players:** 15 gamers compete throughout the week

---

# 📅 DAY-BY-DAY BREAKDOWN

## 🔵 DAY 1 (MONDAY)

### **Step 1: Campaign Creation & Payment**

**Brand A (Basic Campaign):**
1. Brand creates campaign via `POST /api/v1/brands/campaigns`
   ```json
   {
     "title": "Brand A Puzzle Challenge",
     "gameType": "sliding_puzzle",
     "packageId": "basic_package_id",
     ...
   }
   ```
2. Campaign created with:
   ```json
   {
     "status": "active",
     "paymentStatus": "unpaid",
     "startDate": "2025-01-20T00:00:00Z",
     "endDate": "2025-01-27T23:59:59Z"
   }
   ```

3. Brand initializes payment: `POST /api/v1/payments/initialize`
   ```json
   {
     "campaignId": "campaign_A_id",
     "packageType": "basic",
     "email": "brandA@example.com"
   }
   ```

4. System creates Transaction record:
   ```json
   {
     "campaignId": "campaign_A_id",
     "brandId": "brand_A_id",
     "packageType": "basic",
     "amount": 7000,
     "currency": "NGN",
     "reference": "campaign_A_1737369600_abc123",
     "status": "pending"
   }
   ```

5. Paystack returns authorization URL:
   ```json
   {
     "authorization_url": "https://checkout.paystack.com/xyz",
     "access_code": "abc123xyz",
     "reference": "campaign_A_1737369600_abc123"
   }
   ```

6. Brand completes payment on Paystack checkout page using test card

7. Paystack webhook hits `POST /api/v1/payments/webhook` with signature verification

8. System updates:
   ```json
   // Transaction
   {
     "status": "success",
     "paystackResponse": { ... }
   }

   // Campaign
   {
     "packageType": "basic",
     "totalBudget": 7000,
     "dailyAllocation": 1000,
     "budgetRemaining": 7000,
     "budgetUsed": 0,
     "paymentStatus": "paid",
     "transactionId": "transaction_A_id"
   }
   ```

**Brand B & C:** Same process
- Brand B pays ₦7,000 (Basic)
- Brand C pays ₦10,000 (Premium)

### **Step 2: Daily Prize Pool Calculation (11:59 PM)**

**Automated cron job triggers:** `POST /api/v1/prize-pools/daily/calculate`
```json
{
  "date": "2025-01-20"
}
```

**System finds active paid campaigns for Day 1:**
- Campaign A (Basic): ₦1,000
- Campaign B (Basic): ₦1,000
- Campaign C (Premium): ₦1,428.57

**Calculation:**
```
Total Daily Pool = 1,000 + 1,000 + 1,428.57 = ₦3,428.57
Gamer Share (70%) = ₦3,428.57 × 0.70 = ₦2,400
Platform Fee (30%) = ₦3,428.57 × 0.30 = ₦1,028.57
```

**DailyPrizePool Record Created:**
```json
{
  "date": "2025-01-20",
  "activeCampaigns": [
    {
      "campaignId": "campaign_A_id",
      "packageType": "basic",
      "dailyAllocation": 1000
    },
    {
      "campaignId": "campaign_B_id",
      "packageType": "basic",
      "dailyAllocation": 1000
    },
    {
      "campaignId": "campaign_C_id",
      "packageType": "premium",
      "dailyAllocation": 1428.57
    }
  ],
  "totalDailyPool": 3428.57,
  "gamerShare": 2400,
  "platformFee": 1028.57,
  "status": "active"
}
```

**Campaign Budgets Updated:**
```json
// Campaign A
{
  "budgetUsed": 1000,
  "budgetRemaining": 6000
}

// Campaign B
{
  "budgetUsed": 1000,
  "budgetRemaining": 6000
}

// Campaign C
{
  "budgetUsed": 1428.57,
  "budgetRemaining": 8571.43
}
```

---

## 🔵 DAY 2 (TUESDAY)

### **Step 1: New Campaign**
Brand D creates Basic Campaign:
1. Campaign creation
2. Payment initialization
3. Pays ₦7,000 via Paystack
4. Webhook confirms payment
5. Campaign activated with budget

### **Step 2: Gamers Playing**
Throughout Day 1 and Day 2, gamers are playing:

**Gameplay Flow:**
```
1. Gamer selects campaign: GET /api/v1/campaigns/:campaignId
2. Gamer plays puzzle game
3. Gamer submits result: POST /api/v1/campaigns/:campaignId/submit
   {
     "timeTaken": 45000,
     "movesTaken": 35,
     "solved": true,
     "answers": [0, 2, 1, 3]
   }
4. System calculates points based on:
   - Speed score
   - Move efficiency
   - Quiz correctness
   - Game difficulty multiplier
5. PuzzleAttempt record created
6. User analytics updated:
   - Lifetime points
   - Puzzles solved
   - Success rate
```

### **Step 3: Daily Prize Pool (11:59 PM)**

**Active Campaigns:** A, B, C, D (4 campaigns)

**Calculation:**
```
Total Daily Pool = 1,000 + 1,000 + 1,428.57 + 1,000 = ₦4,428.57
Gamer Share (70%) = ₦3,100
Platform Fee (30%) = ₦1,328.57
```

**Campaign Budgets After Day 2:**
```
Campaign A: budgetUsed = 2,000, budgetRemaining = 5,000
Campaign B: budgetUsed = 2,000, budgetRemaining = 5,000
Campaign C: budgetUsed = 2,857.14, budgetRemaining = 7,142.86
Campaign D: budgetUsed = 1,000, budgetRemaining = 6,000
```

---

## 🔵 DAY 3 (WEDNESDAY)

### **Step 1: New Campaign**
Brand E creates Premium Campaign and pays ₦10,000

### **Step 2: Daily Prize Pool (11:59 PM)**

**Active Campaigns:** A, B, C, D, E (5 campaigns - ALL ACTIVE!)

**Calculation:**
```
Total = 1,000 + 1,000 + 1,428.57 + 1,000 + 1,428.57 = ₦5,857.14
Gamer Share (70%) = ₦4,100
Platform Fee (30%) = ₦1,757.14
```

**Campaign Budgets After Day 3:**
```
Campaign A: budgetUsed = 3,000, budgetRemaining = 4,000
Campaign B: budgetUsed = 3,000, budgetRemaining = 4,000
Campaign C: budgetUsed = 4,285.71, budgetRemaining = 5,714.29
Campaign D: budgetUsed = 2,000, budgetRemaining = 5,000
Campaign E: budgetUsed = 1,428.57, budgetRemaining = 8,571.43
```

---

## 🔵 DAYS 4-7 (THURSDAY - SUNDAY)

**Same daily process continues with all 5 campaigns active**

**Each Day (Thu, Fri, Sat, Sun):**
- Daily Pool: ₦5,857.14
- Gamer Share: ₦4,100
- Platform Fee: ₦1,757.14

**Daily Budget Deductions:** Each campaign deducts its fixed daily rate

---

## 🏁 END OF WEEK (SUNDAY 11:59 PM)

### **Step 1: Final Campaign Status Check**

**Campaign A (Started Monday):**
```
Days Active: 7 (Mon-Sun)
Budget Used: 7 × ₦1,000 = ₦7,000
Budget Remaining: ₦0
End Date Reached: Yes
→ Status automatically changed to "ended"
```

**Campaign B (Started Monday):**
```
Days Active: 7 (Mon-Sun)
Budget Used: ₦7,000
Budget Remaining: ₦0
End Date Reached: Yes
→ Status changed to "ended"
```

**Campaign C (Started Monday):**
```
Days Active: 7 (Mon-Sun)
Budget Used: 7 × ₦1,428.57 = ₦10,000
Budget Remaining: ₦0
End Date Reached: Yes
→ Status changed to "ended"
```

**Campaign D (Started Tuesday):**
```
Days Active: 6 (Tue-Sun)
Budget Used: 6 × ₦1,000 = ₦6,000
Budget Remaining: ₦1,000 (1 more day left!)
End Date: Not reached yet
→ Remains "active" - ROLLS OVER to Week 2
```

**Campaign E (Started Wednesday):**
```
Days Active: 5 (Wed-Sun)
Budget Used: 5 × ₦1,428.57 = ₦7,142.85
Budget Remaining: ₦2,857.15 (2 more days left!)
End Date: Not reached yet
→ Remains "active" - ROLLS OVER to Week 2
```

### **Step 2: Weekly Prize Pool Calculation**

**Daily Breakdown:**
```
Day 1 (Mon): 3 campaigns = ₦3,428.57
Day 2 (Tue): 4 campaigns = ₦4,428.57
Day 3 (Wed): 5 campaigns = ₦5,857.14
Day 4 (Thu): 5 campaigns = ₦5,857.14
Day 5 (Fri): 5 campaigns = ₦5,857.14
Day 6 (Sat): 5 campaigns = ₦5,857.14
Day 7 (Sun): 5 campaigns = ₦5,857.14
──────────────────────────────────
TOTAL WEEK 1: ₦37,142.84

Gamer Share (70%): ₦26,000
Platform Fee (30%): ₦11,142.84
```

### **Step 3: Leaderboard Snapshot**

At end of week, system fetches leaderboard:
`GET /api/v1/leaderboards/weekly`

**Top 15 Gamers:**
```
Rank  | Gamer ID  | Points | Puzzles Solved
------|-----------|--------|---------------
1     | Gamer1    | 150    | 10
2     | Gamer2    | 145    | 9
3     | Gamer3    | 140    | 9
4     | Gamer4    | 135    | 8
5     | Gamer5    | 130    | 8
6     | Gamer6    | 125    | 8
7     | Gamer7    | 120    | 7
8     | Gamer8    | 115    | 7
9     | Gamer9    | 110    | 7
10    | Gamer10   | 105    | 6
------|-----------|--------|--------------- (NO PAYOUT BELOW)
11    | Gamer11   | 100    | 6            ❌
12    | Gamer12   | 95     | 5            ❌
13    | Gamer13   | 90     | 5            ❌
14    | Gamer14   | 85     | 5            ❌
15    | Gamer15   | 80     | 4            ❌
```

### **Step 4: Payout Calculation**

**Cron job triggers:** `POST /api/v1/payouts/weekly/calculate`
```json
{
  "weekKey": "2025-01-20_to_2025-01-26"
}
```

**Prize Distribution Formula (from ₦26,000 gamer share):**

```
Position 1:  ₦26,000 × 20.000% = ₦5,200.00
Position 2:  ₦26,000 × 15.000% = ₦3,900.00
Position 3:  ₦26,000 × 10.000% = ₦2,600.00
Position 4:  ₦26,000 × 7.875%  = ₦2,047.50
Position 5:  ₦26,000 × 7.875%  = ₦2,047.50
Position 6:  ₦26,000 × 7.875%  = ₦2,047.50
Position 7:  ₦26,000 × 7.875%  = ₦2,047.50
Position 8:  ₦26,000 × 7.875%  = ₦2,047.50
Position 9:  ₦26,000 × 7.875%  = ₦2,047.50
Position 10: ₦26,000 × 7.875%  = ₦2,047.50
──────────────────────────────────────────
TOTAL DISTRIBUTED: ₦26,032.50
```

**Payout Records Created for Top 10:**
```json
{
  "userId": "gamer1_id",
  "weekKey": "2025-01-20_to_2025-01-26",
  "position": 1,
  "points": 150,
  "puzzlesSolved": 10,
  "totalDailyPool": 37142.84,
  "gamerShare": 26000,
  "distributionPercentage": 20,
  "amount": 5200,
  "currency": "NGN",
  "status": "pending"
}

// Similar records for positions 2-10
```

**User Analytics Updated:**
```json
// Gamer1
{
  "analytics.lifetime.totalEarnings": 5200,
  // Previous earnings + this week
}

// Gamer2
{
  "analytics.lifetime.totalEarnings": 3900
}

// ... and so on for top 10
```

**Gamers 11-15:** No payout records created (outside top 10)

---

## 🔄 WEEK 2 (ROLLOVER)

### **Monday (Week 2, Day 1)**

**Active Campaigns at Start of Week 2:**
- Campaign D: 1 day remaining
- Campaign E: 2 days remaining
- Campaigns A, B, C: Ended (no longer active)

**Daily Prize Pool Calculation:**
```
Active Campaigns:
- Campaign D: ₦1,000
- Campaign E: ₦1,428.57

Total Daily Pool = ₦2,428.57
Gamer Share (70%) = ₦1,700
Platform Fee (30%) = ₦728.57
```

**After Monday (Week 2, Day 1):**
```
Campaign D:
  - Days Used: 7 total (6 in Week 1 + 1 in Week 2)
  - budgetUsed: ₦7,000
  - budgetRemaining: ₦0
  - Status → "ended"

Campaign E:
  - Days Used: 6 total (5 in Week 1 + 1 in Week 2)
  - budgetUsed: ₦8,571.42
  - budgetRemaining: ₦1,428.58 (1 more day)
  - Status → still "active"
```

### **Tuesday (Week 2, Day 2)**

**Active Campaigns:**
- Campaign E only (last day)

**Daily Prize Pool:**
```
Total = ₦1,428.57
Gamer Share = ₦1,000
Platform Fee = ₦428.57
```

**After Tuesday (Week 2, Day 2):**
```
Campaign E:
  - Days Used: 7 total (5 in Week 1 + 2 in Week 2)
  - budgetUsed: ₦10,000
  - budgetRemaining: ₦0
  - Status → "ended"
```

**All Campaigns Now Ended!**

---

# 📊 COMPLETE FLOW DIAGRAM

```
┌─────────────────────────────────────────────────────────────┐
│                     CAMPAIGN LIFECYCLE                       │
└─────────────────────────────────────────────────────────────┘

STEP 1: CREATION
Brand → Create Campaign → POST /api/v1/brands/campaigns
        Status: "active", paymentStatus: "unpaid"
                            ↓
STEP 2: PAYMENT
Brand → Initialize Payment → POST /api/v1/payments/initialize
        Paystack Returns URL
                            ↓
Brand → Completes Payment → Paystack Checkout
        Uses Test Card
                            ↓
Paystack → Webhook → POST /api/v1/payments/webhook
        Verifies Signature
                            ↓
System → Updates Campaign:
        - packageType: "basic" or "premium"
        - totalBudget: 7000 or 10000
        - dailyAllocation: 1000 or 1428.57
        - budgetRemaining: totalBudget
        - paymentStatus: "paid"
                            ↓
STEP 3: DAILY OPERATIONS (Repeat Daily)
┌────────────────────────────────────────────────────┐
│  Gamers Play → Submit Results → Points Calculated  │
│  Leaderboard Updated Throughout Day                │
└────────────────────────────────────────────────────┘
                            ↓
Cron Job (11:59 PM) → Calculate Daily Prize Pool
        - Find active paid campaigns
        - Calculate daily allocations
        - Create DailyPrizePool record
        - Deduct from campaign budgets
        - Check if campaigns exhausted
                            ↓
STEP 4: WEEKLY PAYOUT (Sunday 11:59 PM)
Cron Job → Calculate Weekly Payouts
        - Fetch top 10 from leaderboard
        - Calculate 70% gamer share
        - Distribute by position percentages
        - Create Payout records
        - Update user earnings
                            ↓
STEP 5: CAMPAIGN END CHECK
IF budgetRemaining = 0 OR endDate reached:
        Status → "ended"
ELSE:
        Status → "active" (Rolls over to next week)
```

---

# 💰 COMPLETE FINANCIAL BREAKDOWN

## **Total Revenue Collected**

```
3 Basic Campaigns  × ₦7,000  = ₦21,000
2 Premium Campaigns × ₦10,000 = ₦20,000
─────────────────────────────────────
TOTAL REVENUE:                 ₦41,000
```

## **Week 1 Distribution**

**Total Pool Used:** ₦37,142.84

```
Platform Fee (30%):  ₦11,142.84
Gamer Share (70%):   ₦26,000.00

Top 10 Payouts:
  Position 1:        ₦5,200.00
  Position 2:        ₦3,900.00
  Position 3:        ₦2,600.00
  Position 4-10:     ₦2,047.50 each × 7 = ₦14,332.50
                     ─────────────
  Total Paid Out:    ₦26,032.50
```

**Budget Remaining After Week 1:**
```
Campaign A: ₦0 (ended)
Campaign B: ₦0 (ended)
Campaign C: ₦0 (ended)
Campaign D: ₦1,000 (rollover)
Campaign E: ₦2,857.16 (rollover)
─────────────────────────────
Total Rollover: ₦3,857.16
```

## **Week 2 Distribution (Rollover)**

**Day 1 (Monday):**
```
Campaign D: ₦1,000
Campaign E: ₦1,428.57
─────────────────────
Total: ₦2,428.57
Platform: ₦728.57
Gamers: ₦1,700.00
```

**Day 2 (Tuesday):**
```
Campaign E: ₦1,428.57
─────────────────────
Total: ₦1,428.57
Platform: ₦428.57
Gamers: ₦1,000.00
```

**Week 2 Totals:**
```
Total Pool: ₦3,857.14
Platform Fee: ₦1,157.14
Gamer Share: ₦2,700.00
```

## **Grand Total (Both Weeks)**

```
Total Revenue:         ₦41,000.00
Total Platform Fee:    ₦12,299.98 (30%)
Total Gamer Payouts:   ₦28,700.02 (70%)
```

**Verification:**
```
₦12,299.98 + ₦28,700.02 = ₦41,000.00 ✓
```

---

# 🔑 KEY SYSTEM FEATURES

## 1. **Fixed Daily Rate**
- ✅ Basic: Always ₦1,000/day regardless of join day
- ✅ Premium: Always ₦1,428.57/day regardless of join day
- ✅ No proration, no variable rates

## 2. **Automatic Budget Tracking**
- ✅ Real-time budget deduction
- ✅ Automatic campaign end when budget exhausted
- ✅ Rollover support for incomplete campaigns

## 3. **Fair Prize Distribution**
- ✅ Top 10 only receive payouts
- ✅ Weighted distribution (1st gets most)
- ✅ 70-30 split (gamers-platform)

## 4. **Weekly Payout Cycle**
- ✅ Payouts calculated Sunday night
- ✅ Based on full week performance
- ✅ Top 10 from leaderboard

## 5. **Rollover Support**
- ✅ Campaigns can span multiple weeks
- ✅ Same fixed rate throughout lifecycle
- ✅ Automatic status management

---

# 📞 API CALLS IN SEQUENCE

## **Brand Workflow**

1. **Create Campaign:**
   ```bash
   POST /api/v1/brands/campaigns
   Authorization: Bearer <brand_token>
   Content-Type: multipart/form-data
   ```

2. **Initialize Payment:**
   ```bash
   POST /api/v1/payments/initialize
   Authorization: Bearer <brand_token>
   {
     "campaignId": "xxx",
     "packageType": "basic",
     "email": "brand@example.com"
   }
   ```

3. **Check Budget Status:**
   ```bash
   GET /api/v1/campaigns/:campaignId/budget
   ```

## **Gamer Workflow**

1. **View Active Campaigns:**
   ```bash
   GET /api/v1/campaigns/active
   ```

2. **Get Campaign Details:**
   ```bash
   GET /api/v1/campaigns/:campaignId
   ```

3. **Play & Submit:**
   ```bash
   POST /api/v1/campaigns/:campaignId/submit
   Authorization: Bearer <gamer_token>
   ```

4. **Check Earnings:**
   ```bash
   GET /api/v1/payouts/my-earnings
   Authorization: Bearer <gamer_token>
   ```

## **Admin/Cron Workflow**

1. **Calculate Daily Pool:**
   ```bash
   POST /api/v1/prize-pools/daily/calculate
   Authorization: Bearer <admin_token>
   {"date": "2025-01-20"}
   ```

2. **Calculate Weekly Payouts:**
   ```bash
   POST /api/v1/payouts/weekly/calculate
   Authorization: Bearer <admin_token>
   {"weekKey": "2025-01-20_to_2025-01-26"}
   ```

3. **Process Payouts:**
   ```bash
   POST /api/v1/payouts/process
   Authorization: Bearer <admin_token>
   {
     "weekKey": "2025-01-20_to_2025-01-26",
     "payoutIds": [...]
   }
   ```

---

# 🎯 SUCCESS METRICS

From this scenario:
- ✅ **5 campaigns** successfully processed
- ✅ **₦41,000** in revenue collected
- ✅ **15 gamers** participated
- ✅ **Top 10** received payouts totaling **₦26,032.50**
- ✅ **Platform** earned **₦12,299.98** (30%)
- ✅ **2 campaigns** successfully rolled over to Week 2
- ✅ **All budgets** tracked accurately
- ✅ **Zero budget discrepancies**

---

# 📝 NOTES

1. **Payment Gateway**: Paystack handles all payments with webhook verification
2. **Cron Jobs**: Essential for daily calculations and weekly payouts
3. **Status Management**: Automatic campaign lifecycle management
4. **Rollover**: Seamless transition across weeks
5. **Fair Distribution**: Fixed rates ensure fairness regardless of join day
6. **Transparency**: All transactions and payouts are tracked and auditable

This system ensures **transparent**, **fair**, and **automated** revenue distribution from brands to gamers!
