import express from "express";
import {
  getOptions,
  createAiTrivia,
  listMine,
  getMine,
  deleteMine,
} from "../controllers/aiTrivia.controller";
import { isAuthenticated } from "../utils/auth";
import { generateLimiter } from "../middlewares/rateLimit";

const router = express.Router();

router.get("/ai-trivia/options", isAuthenticated, getOptions);
// Writing one is Pro only (enforced in the service); the rest stays open after Pro ends
router.post("/ai-trivia", isAuthenticated, generateLimiter, createAiTrivia);
router.get("/ai-trivia", isAuthenticated, listMine);
router.get("/ai-trivia/:id", isAuthenticated, getMine);
router.delete("/ai-trivia/:id", isAuthenticated, deleteMine);

export default router;
