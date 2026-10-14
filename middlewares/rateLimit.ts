import { Request, Response, NextFunction } from "express";
import rateLimit from "express-rate-limit";
import ErrorHandler from "../utils/ErrorHandler";

interface LimiterOptions {
  windowMs: number;
  limit: number;
  // Limiters are off under NODE_ENV=test unless a test opts in.
  enabledInTest?: boolean;
}

/**
 * Per-user (falling back to per-IP) limiter. Counters live in process memory: fine for a
 * single instance; swap in a shared store (e.g. rate-limit-redis) when scaling out.
 */
export const createRateLimiter = ({ windowMs, limit, enabledInTest = false }: LimiterOptions) =>
  rateLimit({
    windowMs,
    limit,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    skip: () => process.env.NODE_ENV === "test" && !enabledInTest,
    keyGenerator: (req: Request) =>
      req.user?._id ? `u:${String(req.user._id)}` : `ip:${req.ip}`,
    handler: (_req: Request, _res: Response, next: NextFunction) =>
      next(new ErrorHandler("Too many requests. Please slow down.", 429, "RATE_LIMITED")),
  });

const MINUTE = 60 * 1000;

// Answer submission (a 1-second timer allows at most ~60/min of real play)
export const submitLimiter = createRateLimiter({ windowMs: MINUTE, limit: 180 });
// Starting sessions / attempts
export const sessionStartLimiter = createRateLimiter({ windowMs: MINUTE, limit: 30 });
// Public share-link resolution (slug guessing)
export const linkResolveLimiter = createRateLimiter({ windowMs: MINUTE, limit: 30 });
// Checkout start and payment verification
export const checkoutLimiter = createRateLimiter({ windowMs: 10 * MINUTE, limit: 10 });
// Brand URL click tracking
export const clickLimiter = createRateLimiter({ windowMs: MINUTE, limit: 20 });
// Image uploads
export const uploadLimiter = createRateLimiter({ windowMs: 10 * MINUTE, limit: 60 });
// Turning a document, or a topic and a prompt, into trivia cards (the daily allowances
// are enforced separately)
export const generateLimiter = createRateLimiter({ windowMs: 10 * MINUTE, limit: 10 });
// Create/update of quizzes, campaigns and cards
export const writeLimiter = createRateLimiter({ windowMs: MINUTE, limit: 120 });
