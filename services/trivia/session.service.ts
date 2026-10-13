import ErrorHandler from "../../utils/ErrorHandler";
import TriviaAttemptModel, { ITriviaAttempt } from "../../models/triviaAttempt.model";
import TriviaAttemptQuestionModel from "../../models/triviaAttemptQuestion.model";
import { QuestionOutcome } from "../../models/triviaAttemptQuestion.model";
import userModel from "../../models/user.model";
import {
  getSubmitGraceMs,
  getTimerRange,
  getTriviaCardBounds,
  getTriviaImagePercent,
  isValidTimerSeconds,
} from "../config/config.service";
import { deadlineFrom, isPastDeadline, remainingMs, STALE_ATTEMPT_MS } from "../game/timing";
import {
  assertNoCampaignOwed,
  countNonCampaignPlay,
  getCampaignGateState,
  recordCampaignPlayCompleted,
  recordCampaignPlayStart,
  resetCampaignCounter,
} from "../campaign/campaign.service";
import { brandForAttempt, resolveSource, titleForAttempt } from "./sources";
import { pickMixedCards } from "./mix";

// One session engine for every kind of trivia (admin topics, custom quizzes, brand
// campaigns):  quiz -> completed  (or abandoned). There is no separate study step: a
// session started with `practice` on has the correct option marked on every question.

type Player = {
  _id: any;
  role: string;
  proUntil?: Date | string | null;
  nonCampaignPlaysSinceCampaign?: number;
};

/** Allowed card counts for a source: at least 5 (or all cards if fewer), up to the cap. */
export async function cardCountBounds(available: number) {
  const { minCards, maxCards } = await getTriviaCardBounds();
  return {
    available,
    min: Math.min(minCards, available),
    max: Math.min(maxCards, available),
  };
}

/**
 * What the "picture questions" picker needs: how many cards of each kind there are, and
 * the share a session gets when the player does not choose one.
 */
export async function cardMix(imageCards: number, total: number, ownPercent?: number | null) {
  return {
    imageCards,
    definitionCards: total - imageCards,
    defaultImagePercent: ownPercent ?? (await getTriviaImagePercent()),
  };
}

async function publicSession(attempt: ITriviaAttempt) {
  return {
    id: String(attempt._id),
    status: attempt.status,
    source: {
      type: attempt.sourceType,
      id: attempt.sourceId,
      title: await titleForAttempt(attempt.sourceType, attempt.sourceId),
    },
    isPreview: attempt.isPreview,
    practice: !!attempt.practice,
    timerSeconds: attempt.timerSeconds,
    cardCount: attempt.cardCount,
    imagePercent: attempt.imagePercent ?? null,
    currentIndex: Math.min(attempt.currentIndex, attempt.cardCount),
    brand: await brandForAttempt(attempt.sourceType, attempt.sourceId),
    startedAt: attempt.startedAt,
    completedAt: attempt.completedAt || null,
  };
}

/**
 * Starts a session, which goes straight into the quiz. If the player already has one in
 * progress for this topic / quiz / campaign it is returned as-is (its own timer, card
 * count and practice setting included), so a refresh or a second tab can never produce
 * a new card set. Starting a non-campaign session is refused while a campaign is owed.
 */
export async function startSession(
  player: Player,
  input: {
    sourceType?: any;
    sourceId?: any;
    slug?: any;
    timerSeconds?: any;
    cardCount?: any;
    imagePercent?: any;
    practice?: any;
  }
) {
  const userId = String(player._id);
  const source = await resolveSource(player, input);
  const sourceKey = `${source.sourceType}:${source.sourceId}`;

  const existing = await TriviaAttemptModel.findOne({ userId, sourceKey, active: true });
  if (existing) {
    return { session: await publicSession(await withoutStudyPhase(existing)), resumed: true };
  }

  if (input.practice !== undefined && typeof input.practice !== "boolean") {
    throw new ErrorHandler("practice must be true or false", 400, "INVALID_PRACTICE");
  }

  if (source.sourceType !== "campaign" && !source.isPreview) {
    await assertNoCampaignOwed(player);
  }

  const timerSeconds = input.timerSeconds ?? source.defaults.timerSeconds;
  if (!isValidTimerSeconds(timerSeconds)) {
    const { minSeconds, maxSeconds } = getTimerRange();
    throw new ErrorHandler(
      `timerSeconds must be a whole number from ${minSeconds} to ${maxSeconds}`,
      400,
      "INVALID_TIMER",
      { minSeconds, maxSeconds }
    );
  }

  if (source.cards.length === 0) {
    throw new ErrorHandler("This trivia has no cards yet", 400, "NO_CARDS");
  }
  const bounds = await cardCountBounds(source.cards.length);
  const requested =
    input.cardCount ??
    (source.defaults.cardCount
      ? Math.max(bounds.min, Math.min(bounds.max, source.defaults.cardCount))
      : undefined);
  if (!Number.isInteger(requested) || requested < bounds.min || requested > bounds.max) {
    throw new ErrorHandler(
      `cardCount must be a whole number from ${bounds.min} to ${bounds.max}`,
      400,
      "INVALID_CARD_COUNT",
      bounds
    );
  }
  const cardCount: number = requested;

  const chosenPercent = input.imagePercent ?? undefined;
  if (
    chosenPercent !== undefined &&
    !(Number.isInteger(chosenPercent) && chosenPercent >= 0 && chosenPercent <= 100)
  ) {
    throw new ErrorHandler(
      "imagePercent must be a whole number from 0 to 100",
      400,
      "INVALID_IMAGE_PERCENT"
    );
  }

  let attempt: ITriviaAttempt;
  try {
    attempt = await TriviaAttemptModel.create({
      userId,
      sourceType: source.sourceType,
      sourceId: source.sourceId,
      sourceKey,
      isPreview: source.isPreview,
      practice: input.practice === true,
      timerSeconds,
      cardCount,
      imagePercent: chosenPercent ?? null,
    });
  } catch (e: any) {
    if (e.code === 11000) {
      const winner = await TriviaAttemptModel.findOne({ userId, sourceKey, active: true });
      if (winner) return { session: await publicSession(winner), resumed: true };
    }
    throw e;
  }

  // Random card set in random order, mixed as the player asked (or else the topic's own
  // share, or else the global one); each card's two options are shuffled as well.
  const selected = pickMixedCards(
    source.cards,
    cardCount,
    chosenPercent ?? source.imagePercent ?? (await getTriviaImagePercent())
  );
  await TriviaAttemptQuestionModel.insertMany(
    selected.map((card, quizIndex) => ({
      attemptId: String(attempt._id),
      quizIndex,
      cardId: card.id,
      card: {
        type: card.type,
        imageUrl: card.imageUrl,
        text: card.text,
        options: card.options,
        correctOptionIndex: card.correctOptionIndex,
        attribution: card.attribution,
      },
      optionOrder: Math.random() < 0.5 ? [0, 1] : [1, 0],
    }))
  );

  if (source.sourceType === "campaign" && !source.isPreview) {
    await recordCampaignPlayStart(source.sourceId, userId, String(attempt._id), cardCount);
  }

  return { session: await publicSession(attempt), resumed: false };
}

/** A session left in the old study step carries on as a quiz. */
async function withoutStudyPhase(attempt: ITriviaAttempt): Promise<ITriviaAttempt> {
  if ((attempt.status as string) !== "studying") return attempt;
  await TriviaAttemptModel.updateOne(
    { _id: attempt._id, status: "studying" },
    { $set: { status: "quiz" } }
  );
  return (await TriviaAttemptModel.findById(attempt._id))!;
}

async function loadOwnedAttempt(userId: string, sessionId: string): Promise<ITriviaAttempt> {
  const attempt = await TriviaAttemptModel.findOne({ _id: sessionId, userId });
  // 404 (not 403) so session ids of other players cannot be probed.
  if (!attempt) throw new ErrorHandler("Session not found", 404, "SESSION_NOT_FOUND");
  return withoutStudyPhase(attempt);
}

export async function getSession(userId: string, sessionId: string) {
  return publicSession(await loadOwnedAttempt(userId, sessionId));
}

async function buildResult(attempt: ITriviaAttempt, player?: Player) {
  return {
    sessionId: String(attempt._id),
    source: {
      type: attempt.sourceType,
      id: attempt.sourceId,
      title: await titleForAttempt(attempt.sourceType, attempt.sourceId),
    },
    correct: attempt.correctCount,
    total: attempt.cardCount,
    isPreview: attempt.isPreview,
    brand: await brandForAttempt(attempt.sourceType, attempt.sourceId),
    completedAt: attempt.completedAt,
    // Tells the client whether the next non-campaign trivia will be blocked.
    campaignGate: player ? await getCampaignGateState(player) : undefined,
  };
}

/** Closes a finished quiz and applies the campaign counter rules exactly once. */
async function completeSession(attempt: ITriviaAttempt): Promise<ITriviaAttempt> {
  const closed = await TriviaAttemptModel.findOneAndUpdate(
    { _id: attempt._id, active: true },
    { $set: { status: "completed", active: false, completedAt: new Date() } },
    { new: true }
  );
  if (!closed) return (await TriviaAttemptModel.findById(attempt._id))!;
  if (closed.isPreview) return closed;

  // counterApplied flips once, so a retried completion cannot count twice.
  const claimed = await TriviaAttemptModel.findOneAndUpdate(
    { _id: closed._id, counterApplied: false },
    { $set: { counterApplied: true } }
  );
  if (claimed) {
    if (closed.sourceType === "campaign") {
      await recordCampaignPlayCompleted(String(closed._id), closed.correctCount, closed.cardCount);
      await resetCampaignCounter(closed.userId);
    } else {
      await countNonCampaignPlay(closed.userId);
    }
  }
  return closed;
}

async function settleQuestion(
  attempt: ITriviaAttempt,
  quizIndex: number,
  outcome: QuestionOutcome,
  selectedOptionIndex?: number
): Promise<ITriviaAttempt> {
  const settled = await TriviaAttemptQuestionModel.findOneAndUpdate(
    { attemptId: String(attempt._id), quizIndex, outcome: { $exists: false } },
    {
      $set: {
        outcome,
        answeredAt: new Date(),
        ...(selectedOptionIndex !== undefined ? { selectedOptionIndex } : {}),
      },
    },
    { new: true }
  );
  if (!settled) return (await TriviaAttemptModel.findById(attempt._id))!;

  const advanced = await TriviaAttemptModel.findOneAndUpdate(
    { _id: attempt._id, active: true, currentIndex: quizIndex },
    { $inc: { currentIndex: 1, correctCount: outcome === "correct" ? 1 : 0 } },
    { new: true }
  );
  if (!advanced) return (await TriviaAttemptModel.findById(attempt._id))!;
  return advanced.currentIndex >= advanced.cardCount ? completeSession(advanced) : advanced;
}

/** Fails the current question if its deadline (plus grace) passed with no answer. */
async function expireOverdue(attempt: ITriviaAttempt, now: Date): Promise<ITriviaAttempt> {
  const graceMs = await getSubmitGraceMs();
  let current = attempt;
  while (current.status === "quiz" && current.currentIndex < current.cardCount) {
    const question = await TriviaAttemptQuestionModel.findOne({
      attemptId: String(current._id),
      quizIndex: current.currentIndex,
    }).lean();
    if (!question || !question.deadlineAt || question.outcome) break;
    if (!isPastDeadline(question.deadlineAt, now, graceMs)) break;
    current = await settleQuestion(current, question.quizIndex, "timeout");
  }
  return current;
}

function assertInQuiz(attempt: ITriviaAttempt) {
  if (attempt.status === "abandoned") {
    throw new ErrorHandler("This session was abandoned", 409, "SESSION_ABANDONED");
  }
}

/**
 * The question the player is on. The first call starts its clock; a repeat call (page
 * refresh) returns the same question with the remaining time. The payload carries no
 * card id and no hint in the option order, and no answer either unless the session is
 * in practice mode, where `correctOptionIndex` says which displayed option is right.
 */
export async function getCurrentQuestion(player: Player, sessionId: string) {
  const now = new Date();
  let attempt = await loadOwnedAttempt(String(player._id), sessionId);
  assertInQuiz(attempt);
  attempt = await expireOverdue(attempt, now);
  if (attempt.status === "completed") {
    return { completed: true, result: await buildResult(attempt, player) };
  }

  const filter = { attemptId: String(attempt._id), quizIndex: attempt.currentIndex };
  await TriviaAttemptQuestionModel.updateOne(
    { ...filter, servedAt: { $exists: false } },
    { $set: { servedAt: now, deadlineAt: deadlineFrom(now, attempt.timerSeconds) } }
  );
  const question = (await TriviaAttemptQuestionModel.findOne(filter).lean())!;

  return {
    completed: false,
    question: {
      index: question.quizIndex,
      total: attempt.cardCount,
      type: question.card.type,
      imageUrl: question.card.imageUrl || null,
      text: question.card.text || null,
      attribution: question.card.attribution || null,
      options: question.optionOrder.map((original, position) => ({
        index: position,
        text: question.card.options[original],
      })),
      ...(attempt.practice
        ? { correctOptionIndex: question.optionOrder.indexOf(question.card.correctOptionIndex) }
        : {}),
      timerSeconds: attempt.timerSeconds,
      servedAt: question.servedAt,
      deadlineAt: question.deadlineAt,
      remainingMs: remainingMs(question.deadlineAt!, now),
      serverTime: now,
    },
  };
}

/**
 * Submits the answer for the current question. `optionIndex` is the position (0 or 1)
 * of the chosen option as it was displayed. Late submissions are timeouts. Submitting
 * again for a settled question returns the stored outcome and changes nothing.
 */
export async function submitAnswer(
  player: Player,
  sessionId: string,
  questionIndex: any,
  optionIndex: any
) {
  const now = new Date();
  if (!Number.isInteger(questionIndex) || questionIndex < 0) {
    throw new ErrorHandler("questionIndex must be a non-negative integer", 400);
  }
  let attempt = await loadOwnedAttempt(String(player._id), sessionId);
  assertInQuiz(attempt);

  const question = await TriviaAttemptQuestionModel.findOne({
    attemptId: String(attempt._id),
    quizIndex: questionIndex,
  }).lean();
  if (!question) throw new ErrorHandler("Question not found", 404, "QUESTION_NOT_FOUND");

  let outcome = question.outcome;
  if (!outcome) {
    if (attempt.status !== "quiz") {
      throw new ErrorHandler("This session is no longer in progress", 409, "SESSION_NOT_ACTIVE");
    }
    if (questionIndex !== attempt.currentIndex) {
      throw new ErrorHandler("That is not the current question", 409, "NOT_CURRENT_QUESTION", {
        currentIndex: attempt.currentIndex,
      });
    }
    if (!question.servedAt || !question.deadlineAt) {
      throw new ErrorHandler("Fetch the question before answering it", 409, "QUESTION_NOT_SERVED");
    }

    let selected: number | undefined;
    if (isPastDeadline(question.deadlineAt, now, await getSubmitGraceMs())) {
      outcome = "timeout";
    } else {
      if (optionIndex !== 0 && optionIndex !== 1) {
        throw new ErrorHandler("optionIndex must be 0 or 1", 400, "INVALID_OPTION");
      }
      selected = question.optionOrder[optionIndex];
      outcome = selected === question.card.correctOptionIndex ? "correct" : "wrong";
    }
    attempt = await settleQuestion(attempt, questionIndex, outcome, selected);
    const stored = await TriviaAttemptQuestionModel.findById(question._id).select("outcome").lean();
    outcome = stored?.outcome || outcome;
  } else {
    attempt = (await TriviaAttemptModel.findById(attempt._id))!;
  }

  const completed = attempt.status === "completed";
  return {
    questionIndex,
    outcome,
    // Display position of the right option — revealed only now that the question is settled.
    correctOptionIndex: question.optionOrder.indexOf(question.card.correctOptionIndex),
    completed,
    nextQuestionIndex: completed ? null : attempt.currentIndex,
    result: completed ? await buildResult(attempt, await freshPlayer(player)) : null,
  };
}

// The counter may just have changed; re-read it so the returned gate state is current.
async function freshPlayer(player: Player): Promise<Player> {
  const user = await userModel
    .findById(player._id)
    .select("role proUntil nonCampaignPlaysSinceCampaign")
    .lean();
  return user ? ({ ...user, _id: String(user._id) } as Player) : player;
}

export async function getResult(player: Player, sessionId: string) {
  let attempt = await loadOwnedAttempt(String(player._id), sessionId);
  if (attempt.status === "quiz") attempt = await expireOverdue(attempt, new Date());
  if (attempt.status !== "completed") {
    throw new ErrorHandler("This session is not finished yet", 409, "SESSION_IN_PROGRESS", {
      status: attempt.status,
      currentIndex: attempt.currentIndex,
      total: attempt.cardCount,
    });
  }
  return buildResult(attempt, await freshPlayer(player));
}

/**
 * Walks away from a session. It is closed without a result and counts for nothing:
 * not toward quiz stats, not toward the campaign counter, and an abandoned campaign
 * session does not clear a campaign that is owed.
 */
export async function abandonSession(userId: string, sessionId: string) {
  const attempt = await loadOwnedAttempt(userId, sessionId);
  await TriviaAttemptModel.updateOne(
    { _id: attempt._id, active: true },
    { $set: { status: "abandoned", active: false, completedAt: new Date() } }
  );
  return publicSession((await TriviaAttemptModel.findById(attempt._id))!);
}

/** Scheduler: closes sessions that were walked away from. */
export async function abandonStaleTriviaSessions(now: Date = new Date()): Promise<number> {
  const result = await TriviaAttemptModel.updateMany(
    { active: true, startedAt: { $lt: new Date(now.getTime() - STALE_ATTEMPT_MS) } },
    { $set: { status: "abandoned", active: false, completedAt: now } }
  );
  return result.modifiedCount;
}

/** Play count and average score for a quiz or topic (completed, non-preview plays only). */
export async function getPlayStats(sourceType: string, sourceId: string) {
  const agg = await TriviaAttemptModel.aggregate([
    {
      $match: {
        sourceKey: `${sourceType}:${sourceId}`,
        status: "completed",
        isPreview: false,
        cardCount: { $gt: 0 },
      },
    },
    {
      $group: {
        _id: null,
        plays: { $sum: 1 },
        averageScore: { $avg: "$correctCount" },
        averagePercent: { $avg: { $multiply: [{ $divide: ["$correctCount", "$cardCount"] }, 100] } },
      },
    },
  ]);
  const row = agg[0];
  return {
    plays: row?.plays || 0,
    averageScore: row ? Math.round(row.averageScore * 100) / 100 : null,
    averageScorePercent: row ? Math.round(row.averagePercent * 10) / 10 : null,
  };
}
