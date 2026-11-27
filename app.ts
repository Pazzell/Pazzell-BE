import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import "dotenv/config";
import authRouter from "./routes/auth.route";
import userRouter from "./routes/user.route";
import planRouter from "./routes/plan.route";
import triviaRouter from "./routes/trivia.route";
import customQuizRouter from "./routes/customQuiz.route";
import aiTriviaRouter from "./routes/aiTrivia.route";
import campaignRouter from "./routes/campaign.route";
import uploadRouter from "./routes/upload.route";
import adminRouter from "./routes/admin.route";
import analyticsRouter from "./routes/analytics.route";
import configRouter from "./routes/config.route";
import forumRouter from "./routes/forum.route";
import teamGameRouter from "./routes/teamGame.route";
import { ErrorMiddleware } from "./middlewares/error";

const app = express();

// Behind a load balancer the client IP (used by the rate limiters) is in X-Forwarded-For.
// Set TRUST_PROXY to the number of proxy hops in front of the app (e.g. 1).
if (process.env.TRUST_PROXY) {
  const hops = Number(process.env.TRUST_PROXY);
  app.set("trust proxy", Number.isNaN(hops) ? process.env.TRUST_PROXY : hops);
}

//body parser — keeps the raw bytes so webhook signatures are verified against
//exactly what the gateway sent
app.use(
  express.json({
    limit: "1mb",
    verify: (req, _res, buf) => {
      (req as any).rawBody = buf;
    },
  })
);

//cookie parser
app.use(cookieParser());

//cors
app.use(
  cors({
    origin: "*",
  })
);

// routes
app.use(
  "/api/v1",
  authRouter,
  userRouter,
  planRouter,
  triviaRouter,
  customQuizRouter,
  teamGameRouter,
  aiTriviaRouter,
  campaignRouter,
  uploadRouter,
  analyticsRouter,
  configRouter,
  forumRouter,
  adminRouter
);

//testing api
app.use("/test", (req: Request, res: Response) => {
  res.status(200).json({
    success: true,
    message: "API is working",
  });
});

//Simple welcome page
app.get("/", (req: Request, res: Response) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Pazzell API</title>
      <style>
        body {
          font-family: Arial, sans-serif;
          text-align: center;
          padding: 50px;
          background-color: #f4f4f4;
        }
        h1 {
          color: #333;
        }
        p {
          font-size: 18px;
          color: #555;
        }
      </style>
    </head>
    <body>
      <h1>Welcome to the Pazzell API</h1>
      <p>Image and short-definition trivia across many topics. The API lives under /api/v1.</p>
    </body>
    </html>
  `);
});

//unkown route
app.all("*", (req: Request, res: Response, next: NextFunction) => {
  const err = new Error(`Route ${req.originalUrl} not found`) as any;
  err.statusCode = 404;
  next(err);
});

// Global error handler - must be last
app.use(ErrorMiddleware);

export { app };
