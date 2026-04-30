# Daily Prize Table - Real-time Potential Earnings

## Overview

The Daily Prize Table is a **real-time endpoint** that shows what each leaderboard position (1-10) would earn based on the current day's active campaigns. This is NOT about actual payouts - it's a dynamic prize table that updates as new brands create campaigns.

## How It Works

### 1. **Real-time Calculation**
- Finds all active, paid campaigns for today
- Calculates total daily pool from all campaigns
- Applies 70-30 split (gamers vs platform)
- Distributes the 70% gamer share across positions 1-10

### 2. **Dynamic Updates**
- **When a new brand creates a campaign** → Daily pool increases → All position amounts increase
- **When a campaign ends** → Daily pool decreases → All position amounts decrease
- No actual money is allocated to players
- Just shows potential earnings for each position

### 3. **Frontend Integration**
Your frontend can:
1. Fetch the prize table: `GET /api/v1/prize-table/today`
2. Fetch the leaderboard: `GET /api/v1/leaderboards/weekly`
3. Map position on leaderboard with position on prize table to show gamers their potential earnings

## API Endpoints

### 1. Get Today's Prize Table

**Endpoint:** `GET /api/v1/prize-table/today`

**Authentication:** None (Public endpoint)

**Response:**
```json
{
  "success": true,
  "prizeTable": {
    "date": "2025-01-20",
    "activeCampaignsCount": 5,
    "totalDailyPool": 5857.14,
    "gamerShare": 4100,
    "platformFee": 1757.14,
    "prizeTable": [
      {
        "position": 1,
        "percentage": 20,
        "amount": 820
      },
      {
        "position": 2,
        "percentage": 15,
        "amount": 615
      },
      {
        "position": 3,
        "percentage": 10,
        "amount": 410
      },
      {
        "position": 4,
        "percentage": 7.875,
        "amount": 322.88
      },
      {
        "position": 5,
        "percentage": 7.875,
        "amount": 322.88
      },
      {
        "position": 6,
        "percentage": 7.875,
        "amount": 322.88
      },
      {
        "position": 7,
        "percentage": 7.875,
        "amount": 322.88
      },
      {
        "position": 8,
        "percentage": 7.875,
        "amount": 322.88
      },
      {
        "position": 9,
        "percentage": 7.875,
        "amount": 322.88
      },
      {
        "position": 10,
        "percentage": 7.875,
        "amount": 322.88
      }
    ],
    "campaignBreakdown": [
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
      },
      {
        "campaignId": "campaign_D_id",
        "packageType": "basic",
        "dailyAllocation": 1000
      },
      {
        "campaignId": "campaign_E_id",
        "packageType": "premium",
        "dailyAllocation": 1428.57
      }
    ]
  }
}
```

### 2. Get Prize Table for Specific Date

**Endpoint:** `GET /api/v1/prize-table/date/:date`

**Authentication:** None (Public endpoint)

**Example:** `GET /api/v1/prize-table/date/2025-01-20`

**Response:** Same format as above

## Real-World Example

### Scenario: Brand D Creates New Campaign

**Initial State (3 campaigns - Monday morning):**
```
Campaign A (Basic): ₦1,000
Campaign B (Basic): ₦1,000
Campaign C (Premium): ₦1,428.57
─────────────────────────────
Total Daily Pool: ₦3,428.57
Gamer Share (70%): ₦2,400

Prize Table:
Position 1: ₦480.00 (20%)
Position 2: ₦360.00 (15%)
Position 3: ₦240.00 (10%)
Position 4-10: ₦189.00 each (7.875%)
```

**After Brand D Creates Campaign (Tuesday morning):**
```
Campaign A (Basic): ₦1,000
Campaign B (Basic): ₦1,000
Campaign C (Premium): ₦1,428.57
Campaign D (Basic): ₦1,000  ← NEW!
─────────────────────────────
Total Daily Pool: ₦4,428.57
Gamer Share (70%): ₦3,100

Prize Table (UPDATED AUTOMATICALLY):
Position 1: ₦620.00 (20%) ⬆ +₦140
Position 2: ₦465.00 (15%) ⬆ +₦105
Position 3: ₦310.00 (10%) ⬆ +₦70
Position 4-10: ₦244.13 each (7.875%) ⬆ +₦55.13
```

## Frontend Integration Example

### React Example

```jsx
import { useEffect, useState } from 'react';

function PotentialEarnings() {
  const [prizeTable, setPrizeTable] = useState(null);
  const [leaderboard, setLeaderboard] = useState(null);

  useEffect(() => {
    // Fetch prize table
    fetch('/api/v1/prize-table/today')
      .then(res => res.json())
      .then(data => setPrizeTable(data.prizeTable));

    // Fetch leaderboard
    fetch('/api/v1/leaderboards/weekly')
      .then(res => res.json())
      .then(data => setLeaderboard(data.leaderboard));

    // Refresh every 30 seconds to catch new campaigns
    const interval = setInterval(() => {
      fetch('/api/v1/prize-table/today')
        .then(res => res.json())
        .then(data => setPrizeTable(data.prizeTable));
    }, 30000);

    return () => clearInterval(interval);
  }, []);

  // Find current user's position
  const myPosition = leaderboard?.entries.find(
    entry => entry.userId === currentUserId
  )?.position;

  // Get potential earnings for my position
  const myPotentialEarnings = prizeTable?.prizeTable.find(
    prize => prize.position === myPosition
  )?.amount;

  return (
    <div>
      <h2>Your Potential Earnings Today</h2>
      {myPosition && myPotentialEarnings && (
        <div>
          <p>Current Position: #{myPosition}</p>
          <p>Potential Earnings: ₦{myPotentialEarnings.toLocaleString()}</p>
        </div>
      )}

      <h3>Prize Table</h3>
      <table>
        <thead>
          <tr>
            <th>Position</th>
            <th>Percentage</th>
            <th>Amount (₦)</th>
          </tr>
        </thead>
        <tbody>
          {prizeTable?.prizeTable.map(prize => (
            <tr key={prize.position}>
              <td>#{prize.position}</td>
              <td>{prize.percentage}%</td>
              <td>₦{prize.amount.toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <p>Active Campaigns: {prizeTable?.activeCampaignsCount}</p>
      <p>Total Daily Pool: ₦{prizeTable?.totalDailyPool.toLocaleString()}</p>
    </div>
  );
}
```

## Use Cases

### 1. **Gamer Dashboard**
Show gamers:
- Their current position on leaderboard
- What they would earn if the day ended now
- How much they could earn by reaching a higher position

### 2. **Marketing/Motivation**
Display the prize table prominently to:
- Motivate gamers to compete
- Show transparency in prize distribution
- Update in real-time as prizes grow

### 3. **Historical Analysis**
Use the date-specific endpoint to:
- Show historical prize tables
- Compare different days
- Analyze prize trends

## Key Features

✅ **Real-time Updates** - Reflects current active campaigns
✅ **No User Data** - Just position and amounts
✅ **No Actual Payouts** - Display only, no money allocated
✅ **Dynamic** - Changes as campaigns are created/ended
✅ **Public Endpoint** - No authentication required
✅ **Transparent** - Shows campaign breakdown

## Testing

### Test Scenario

1. **Initial State (No Campaigns):**
```bash
curl http://localhost:8000/api/v1/prize-table/today
```
Response:
```json
{
  "activeCampaignsCount": 0,
  "totalDailyPool": 0,
  "gamerShare": 0,
  "prizeTable": [
    {"position": 1, "percentage": 20, "amount": 0},
    {"position": 2, "percentage": 15, "amount": 0},
    ...
  ]
}
```

2. **After Brand Creates Basic Campaign:**
```bash
curl http://localhost:8000/api/v1/prize-table/today
```
Response:
```json
{
  "activeCampaignsCount": 1,
  "totalDailyPool": 1000,
  "gamerShare": 700,
  "prizeTable": [
    {"position": 1, "percentage": 20, "amount": 140},
    {"position": 2, "percentage": 15, "amount": 105},
    {"position": 3, "percentage": 10, "amount": 70},
    ...
  ]
}
```

3. **After Another Premium Campaign:**
```bash
curl http://localhost:8000/api/v1/prize-table/today
```
Response:
```json
{
  "activeCampaignsCount": 2,
  "totalDailyPool": 2428.57,
  "gamerShare": 1700,
  "prizeTable": [
    {"position": 1, "percentage": 20, "amount": 340},
    {"position": 2, "percentage": 15, "amount": 255},
    {"position": 3, "percentage": 10, "amount": 170},
    ...
  ]
}
```

## Important Notes

1. **Not Actual Payouts**: This endpoint does NOT create payout records or allocate money
2. **Display Only**: Used purely for showing potential earnings to gamers
3. **Current State**: Shows what positions are worth RIGHT NOW based on active campaigns
4. **Weekly vs Daily**:
   - Weekly payouts (`/api/v1/payouts/weekly/calculate`) - Actual money distribution (admin only, runs Sunday)
   - Prize table (`/api/v1/prize-table/today`) - Potential earnings display (public, real-time)

## Comparison Table

| Feature | Prize Table | Weekly Payouts |
|---------|------------|----------------|
| **Purpose** | Display potential earnings | Actual money distribution |
| **Frequency** | Real-time, changes constantly | Once per week (Sunday) |
| **Authentication** | Public, no auth | Admin only |
| **Creates Records** | No | Yes (Payout records) |
| **Allocates Money** | No | Yes |
| **Updates User Earnings** | No | Yes |
| **Based On** | Current active campaigns | Full week performance |

## Summary

The Daily Prize Table is a **display-only** feature that shows gamers what they could earn based on their position. It updates automatically as campaigns are created and provides transparency and motivation without actually distributing any funds.

Use this in your frontend to show gamers the "current jackpot" for each position!
