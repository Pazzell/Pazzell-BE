# Brand Puzzle Game Backend - API Documentation

## Overview

This is a puzzle gaming backend built with Node.js, Express, TypeScript, MongoDB, Firebase Storage, and JWT authentication. The system supports two main user roles: **Gamers** (players) and **Brands** (puzzle creators), plus admin capabilities.

---

## Base URL

```
http://localhost:4000/api/v1
```

All endpoints use JSON (except file uploads which use multipart/form-data).

---

## Authentication

### Token Format

- **Access Token**: Short-lived JWT (default 1 hour), used for API requests.
- **Refresh Token**: Long-lived JWT (default 7 days), stored in `HttpOnly` cookies for token refresh.
- **Headers**: Include `Authorization: Bearer <accessToken>` for protected endpoints.
- **Cookies**: Access and refresh tokens are automatically set in response headers.

### Response Format (Successful Auth)

```json
{
  "success": true,
  "user": {
    "_id": "user_id",
    "name": "User Name",
    "email": "user@example.com",
    "role": "gamer|brand|admin",
    "isVerified": true,
    "avatar": "url_or_null"
  },
  "accessToken": "jwt_token_string"
}
```

---

## Authentication Endpoints

### 1. Gamer Registration (Email)

**POST** `/auth/gamer/register`

Register a new gamer with email and password. Sends a verification email.

**Request Body:**

```json
{
  "name": "John Gamer",
  "email": "gamer@example.com",
  "password": "securePassword123"
}
```

**Response (201):**

```json
{
  "success": true,
  "user": {
    "_id": "123abc",
    "name": "John Gamer",
    "email": "gamer@example.com",
    "role": "gamer",
    "isVerified": false
  },
  "activationToken": "eyJhbGc...",
  "message": "Activation email sent. Please verify your email."
}
```

**Notes:**

- Password must be at least 6 characters (add validation as needed).
- Activation email contains a 6-digit code.
- Store `activationToken` on the client for the next step.

---

### 2. Gamer Email Verification

**POST** `/auth/gamer/activate`

Verify gamer email using the activation token and code from email.

**Request Body:**

```json
{
  "activation_token": "eyJhbGc...",
  "activation_code": "123456"
}
```

**Response (200/201):**

```json
{
  "success": true,
  "user": { ... },
  "accessToken": "eyJhbGc...",
  "message": "Account activated. You are now logged in."
}
```

**Error Cases:**

- `400`: Missing activation data.
- `400`: Invalid or expired activation token.
- `400`: Incorrect activation code.

---

### 3. Gamer Login (Email)

**POST** `/auth/gamer/login`

Log in an existing gamer using email and password.

**Request Body:**

```json
{
  "email": "gamer@example.com",
  "password": "securePassword123"
}
```

**Response (200):**

```json
{
  "success": true,
  "user": { ... },
  "accessToken": "eyJhbGc..."
}
```

**Error Cases:**

- `400`: Missing email or password.
- `403`: Invalid credentials (email not found or wrong password).

---

### 4. Google OAuth (Gamer Signup/Login)

**POST** `/auth/google`

Sign up or log in a gamer using Google OAuth. Auto-creates or updates gamer account.

**Request Body (Option 1: Firebase idToken):**

```json
{
  "idToken": "firebase_id_token_string"
}
```

**Request Body (Option 2: Profile Payload):**

```json
{
  "email": "gamer@gmail.com",
  "name": "John Gamer",
  "googleId": "google_uid_123",
  "avatar": "https://lh3.googleusercontent.com/..."
}
```

**Response (200):**

```json
{
  "success": true,
  "user": {
    "_id": "123abc",
    "name": "John Gamer",
    "email": "gamer@gmail.com",
    "role": "gamer",
    "isVerified": true,
    "avatar": "https://lh3.googleusercontent.com/..."
  },
  "accessToken": "eyJhbGc..."
}
```

**Notes:**

- No email verification required for Google OAuth.
- Account auto-marked as verified.
- Can be used for both signup and login (idempotent).

---

### 5. Brand Registration (Email)

**POST** `/auth/brand/register`

Register a new brand with company details. Sends verification email.

**Request Body:**

```json
{
  "name": "Brand Admin Name",
  "email": "admin@brandcompany.com",
  "password": "securePassword123",
  "companyName": "Brand Company Inc."
}
```

**Response (201):**

```json
{
  "success": true,
  "user": {
    "_id": "123abc",
    "name": "Brand Admin Name",
    "email": "admin@brandcompany.com",
    "role": "brand",
    "isVerified": false,
    "companyName": "Brand Company Inc."
  },
  "activationToken": "eyJhbGc...",
  "message": "Activation email sent. Please verify your email."
}
```

---

### 6. Brand Email Verification

**POST** `/auth/brand/activate`

Verify brand email using activation token and code.

**Request Body:**

```json
{
  "activation_token": "eyJhbGc...",
  "activation_code": "123456"
}
```

**Response (200/201):**

```json
{
  "success": true,
  "user": { ... },
  "accessToken": "eyJhbGc...",
  "message": "Brand account activated."
}
```

---

### 7. Brand Login

**POST** `/auth/brand/login`

Log in an existing brand.

**Request Body:**

```json
{
  "email": "admin@brandcompany.com",
  "password": "securePassword123"
}
```

**Response (200):**

```json
{
  "success": true,
  "user": { ... },
  "accessToken": "eyJhbGc..."
}
```

---

### 8. Logout

**POST** `/auth/logout`

Logout the current user. Clears tokens.

**Headers:**

```
Authorization: Bearer <accessToken>
```

**Response (200):**

```json
{
  "success": true
}
```

---

## Puzzle Campaign Endpoints (Brand)

### 1. Create Campaign

**POST** `/brands/campaigns`

Create a new puzzle campaign. Requires multipart/form-data upload with image and metadata.

**Headers:**

```
Authorization: Bearer <accessToken>
Content-Type: multipart/form-data
```

**Form Data:**

- `image` (File, required): Single image file (PNG, JPG, etc.). Used for both scrambled puzzle and original image.
- `title` (Text, required): Campaign title (e.g., "Logo Quiz Challenge").
- `description` (Text, required): Campaign description.
- `questions` (Text, required): Stringified JSON array of question objects.
- `timeLimit` (Text, required): Campaign duration in hours (e.g., "24").
- `brandUrl` (Text, optional): Brand website or social link (e.g., "https://brand.example.com").
- `videoUrl` (Text, optional): Optional promotional video URL (YouTube/Vimeo).

**Questions Format (stringified JSON):**

```json
[
  {
    "question": "Which company has a bitten apple logo?",
    "choices": ["Microsoft", "Apple", "Dell", "Asus"],
    "correctIndex": 1
  },
  {
    "question": "What brand has the swoosh logo?",
    "choices": ["Adidas", "Nike", "Puma", "Reebok"],
    "correctIndex": 1
  }
]
```

**Example cURL:**

```bash
curl -X POST 'http://localhost:3000/api/v1/brands/campaigns' \
  -H 'Authorization: Bearer <accessToken>' \
  -F 'image=@/path/to/image.png' \
  -F 'title=Logo Quiz Challenge' \
  -F 'description=Test your brand knowledge' \
  -F 'questions=[{"question":"Which company has a bitten apple logo?","choices":["Microsoft","Apple","Dell","Asus"],"correctIndex":1}]' \
  -F 'timeLimit=24'
```

**Response (201):**

```json
{
  "success": true,
  "campaign": {
    "_id": "campaign_id",
    "brandId": "brand_user_id",
    "title": "Logo Quiz Challenge",
    "description": "Test your brand knowledge",
    "brandUrl": "https://brand.example.com",
    "videoUrl": "https://youtu.be/example",
    "puzzleImageUrl": "https://storage.googleapis.com/bucket/puzzles/...",
    "originalImageUrl": "https://storage.googleapis.com/bucket/puzzles/...",
    "questions": [
      {
        "_id": "q_id",
        "question": "Which company has a bitten apple logo?",
        "choices": ["Microsoft", "Apple", "Dell", "Asus"],
        "correctIndex": 1
      }
    ],
    "timeLimit": 24,
    "analytics": {},
    "createdAt": "2025-11-25T10:30:00Z",
    "updatedAt": "2025-11-25T10:30:00Z"
  }
}
```

**Error Cases:**

- `400`: Missing required fields.
- `400`: Invalid JSON in questions.
- `400`: Missing image file.
- `403`: User is not a brand.

---

### 2. Get Campaign Analytics

**GET** `/brands/analytics`

Get analytics for all campaigns created by the authenticated brand.

**Headers:**

```
Authorization: Bearer <accessToken>
```

**Response (200):**

```json
{
  "success": true,
  "campaigns": [
    {
      "campaignId": "campaign_id",
      "title": "Logo Quiz Challenge",
      "plays": 150,
      "completions": 89,
      "avgCompletionTime": 3450,
      "questionCorrectnessRates": [0.92, 0.78, 0.85]
    }
  ]
}
```

**Fields:**

- `plays`: Total number of attempts.
- `completions`: Number of successful completions.
- `avgCompletionTime`: Average time in milliseconds for successful completions.
- `questionCorrectnessRates`: Array of correctness rates (0-1) for each question.

---

## Puzzle Endpoints (Gamer)

### 1. List All Campaigns

**GET** `/puzzles`

Get all available puzzle campaigns.

**Headers:**

```
Authorization: Bearer <accessToken>
```

**Query Parameters:**

- `page` (optional, default: 1): Pagination page number.
- `limit` (optional, default: 10): Items per page.

**Response (200):**

```json
{
  "success": true,
  "puzzles": [
    {
      "puzzleId": "campaign_id",
      "brandId": "brand_id",
      "title": "Logo Quiz Challenge",
      "description": "Test your brand knowledge",
      "puzzleImageUrl": "https://storage.googleapis.com/...",
      "originalImageUrl": "https://storage.googleapis.com/...",
      "timeLimit": 24,
      "questions": [
        {
          "question": "Which company has a bitten apple logo?",
          "choices": ["Microsoft", "Apple", "Dell", "Asus"]
        }
      ],
      "createdAt": "2025-11-25T10:30:00Z"
    }
  ]
}
```

**Notes:**

- Questions do not include `correctIndex` in list view (only in get single puzzle).

---

### 2. Get Single Puzzle

**GET** `/puzzles/:id`

Get details of a single puzzle campaign.

**Headers:**

```
Authorization: Bearer <accessToken>
```

**Response (200):**

```json
{
  "success": true,
  "puzzle": {
    "puzzleId": "campaign_id",
    "puzzleImageUrl": "https://storage.googleapis.com/...",
    "originalImageUrl": "https://storage.googleapis.com/...",
    "timeLimit": 24,
    "questions": [
      {
        "question": "Which company has a bitten apple logo?",
        "choices": ["Microsoft", "Apple", "Dell", "Asus"]
      }
    ]
  }
}
```

---

### 3. Submit Puzzle Attempt

**POST** `/puzzles/:id/submit`

Submit a puzzle attempt with answers and metadata. Records attempt, computes score, and updates user analytics.

**Headers:**

```
Authorization: Bearer <accessToken>
Content-Type: application/json
```

**Request Body:**

```json
{
  "timeTaken": 5000,
  "movesTaken": 12,
  "solved": true,
  "answers": [1, 0, 2]
}
```

**Fields:**

- `timeTaken` (number, required): Time spent in milliseconds.
- `movesTaken` (number, required): Number of moves/interactions.
- `solved` (boolean, required): Whether the puzzle was solved.
- `answers` (array of numbers, required): Answer indices for each question (must match question order).

**Response (200):**

```json
{
  "success": true,
  "attempt": {
    "_id": "attempt_id",
    "userId": "gamer_id",
    "puzzleId": "campaign_id",
    "campaignId": "campaign_id",
    "timeTaken": 5000,
    "movesTaken": 12,
    "solved": true,
    "firstTimeSolved": true,
    "quizScore": 100,
    "pointsEarned": 250,
    "answers": [1, 0, 2],
    "timestamp": "2025-11-25T10:35:00Z"
  },
  "userAnalytics": {
    "lifetime": {
      "puzzlesSolved": 5,
      "totalPoints": 1250,
      "totalTime": 28500,
      "totalMoves": 67,
      "attempts": 8,
      "successRate": 0.625
    }
  }
}
```

**Error Cases:**

- `404`: Puzzle not found.
- `400`: Invalid answers array (length mismatch or non-numeric indices).
- `401`: User not authenticated.

---

## Leaderboard Endpoints

### 1. Get Daily Leaderboard

**GET** `/leaderboards/daily`

Get the daily leaderboard for gamers who solved puzzles today.

**Headers:**

```
Authorization: Bearer <accessToken>
```

**Query Parameters:**

- `limit` (optional, default: 100): Number of top entries to return.

**Response (200):**

```json
{
  "success": true,
  "leaderboard": {
    "_id": "leaderboard_id",
    "type": "daily",
    "date": "2025-11-25",
    "entries": [
      {
        "userId": "gamer_id_1",
        "userName": "John Gamer",
        "puzzlesSolved": 3,
        "totalPoints": 750,
        "averageTime": 3200,
        "rank": 1
      },
      {
        "userId": "gamer_id_2",
        "userName": "Jane Player",
        "puzzlesSolved": 2,
        "totalPoints": 500,
        "averageTime": 4100,
        "rank": 2
      }
    ]
  }
}
```

---

## User Profile Endpoints

### 1. Get User Profile

**GET** `/users/profile`

Get the authenticated user's profile and analytics.

**Headers:**

```
Authorization: Bearer <accessToken>
```

**Response (200):**

```json
{
  "success": true,
  "user": {
    "_id": "user_id",
    "name": "John Gamer",
    "email": "gamer@example.com",
    "role": "gamer",
    "isVerified": true,
    "avatar": "https://...",
    "analytics": {
      "lifetime": {
        "puzzlesSolved": 5,
        "totalPoints": 1250,
        "totalTime": 28500,
        "totalMoves": 67,
        "attempts": 8,
        "successRate": 0.625
      }
    },
    "createdAt": "2025-11-20T08:00:00Z"
  }
}
```

---

## Error Responses

All error responses follow this format:

```json
{
  "success": false,
  "message": "Error description"
}
```

**Common HTTP Status Codes:**

- `200`: OK
- `201`: Created
- `400`: Bad Request (validation error, missing fields, invalid JSON, etc.)
- `401`: Unauthorized (missing or invalid token)
- `403`: Forbidden (insufficient permissions, e.g., non-brand trying to create campaign)
- `404`: Not Found
- `500`: Internal Server Error

---

## Data Models

### User Model

```typescript
{
  _id: ObjectId,
  name: string,
  email: string (unique),
  password?: string,
  avatar?: string,
  role: "gamer" | "brand" | "admin",
  googleId?: string,
  companyName?: string, // for brand users
  isVerified: boolean,
  analytics: {
    lifetime: {
      puzzlesSolved: number,
      totalPoints: number,
      totalTime: number,
      totalMoves: number,
      attempts: number,
      successRate: number
    },
    daily?: {
      date: string,
      puzzlesSolved: number
    }
  },
  puzzlesSolved: [ObjectId], // puzzle IDs
  createdAt: Date,
  updatedAt: Date
}
```

### Puzzle Campaign Model

```typescript
{
  _id: ObjectId,
  brandId: ObjectId,
  title: string,
  description: string,
  puzzleImageUrl: string,
  originalImageUrl: string,
  questions: [
    {
      question: string,
      choices: [string],
      correctIndex: number
    }
  ],
  timeLimit: number, // hours
  analytics: object,
  createdAt: Date,
  updatedAt: Date
}
```

### Puzzle Attempt Model

```typescript
{
  _id: ObjectId,
  userId: ObjectId,
  puzzleId: ObjectId,
  campaignId: ObjectId,
  timeTaken: number, // milliseconds
  movesTaken: number,
  solved: boolean,
  firstTimeSolved: boolean,
  quizScore: number, // 0-100
  pointsEarned: number,
  answers: [number], // answer indices
  timestamp: Date
}
```

---

## Frontend Integration Checklist

### Authentication Pages

- [ ] Gamer signup (email/password)
- [ ] Gamer email verification page
- [ ] Gamer login
- [ ] Google OAuth integration (use Firebase SDK or OAuth2 library)
- [ ] Brand signup
- [ ] Brand email verification page
- [ ] Brand login

### Gamer Features

- [ ] Browse available puzzles list
- [ ] View single puzzle details
- [ ] Submit puzzle attempt
- [ ] View personal analytics/profile
- [ ] View daily leaderboard
- [ ] Logout

### Brand Features

- [ ] Create new campaign (multipart form upload)
- [ ] View campaign analytics
- [ ] List all campaigns
- [ ] Logout

### Shared

- [ ] Token refresh logic (use refresh_token cookie automatically)
- [ ] Error handling and user feedback
- [ ] Loading states during API calls
- [ ] Responsive UI for mobile and desktop

---

## Environment Variables (Backend)

Required for the backend to run:

```
DB_URI=mongodb://...
ACTIVATION_SECRET=secret_key
ACCESS_TOKEN=secret_key
REFRESH_TOKEN=secret_key
ACCESS_TOKEN_EXPIRE=1h or 24 (hours)
REFRESH_TOKEN_EXPIRE=7d or 168 (hours)
FIREBASE_PROJECT_ID=your_firebase_project
FIREBASE_PRIVATE_KEY=your_firebase_private_key
FIREBASE_CLIENT_EMAIL=your_firebase_client_email
FIREBASE_STORAGE_BUCKET=your_firebase_bucket_url
SMTP_SERVICE=gmail (for emails)
SMTP_EMAIL=your_email@gmail.com
SMTP_PASSWORD=your_app_password
```

---

## Notes for Frontend Developer

1. **Token Management**: Access tokens are stored in cookies (HttpOnly) and also returned in JSON. Use the JSON response for immediate use.
2. **Multipart Upload**: When creating campaigns, ensure form-data is properly formatted. Use libraries like `FormData` (browser) or `form-data` (Node.js).
3. **CORS**: The backend allows cross-origin requests. No special CORS headers needed from frontend.
4. **Timestamps**: All dates are in ISO 8601 format (UTC). Parse as needed.
5. **Image URLs**: Firebase Storage URLs are public and can be directly used in `<img>` tags.
6. **Questions Array**: Always match answer indices to the order of questions.
7. **Error Handling**: All error responses follow the standard format above. Parse `message` field for user feedback.
8. **Pagination**: Implement pagination for puzzle listing (use `page` and `limit` query params).
9. **Real-time Updates**: Currently no WebSocket support. Implement polling for leaderboard updates if needed.

---

## Support

For issues or clarifications, refer to the backend repository or contact the backend development team.
