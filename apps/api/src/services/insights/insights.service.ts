import { CategorySource, InsightSource, Prisma, SpendingCategory, TransactionType } from "@prisma/client";
import { env } from "../../config/env";
import prisma from "../../config/db";
import logger from "../../config/logger";
import { isRefreshPending, queueInsightsRefresh } from "../../queues/insights.queue";
import { AiUnavailableError, generateJson, isAiConfigured } from "../ai/gemini.client";
import redisClient from "../redis.service";
import { categoriseRecentSpends } from "./categorise.service";
import { buildFacts, localDate, type InsightFacts } from "./facts.service";
import { Pseudonymiser } from "./pseudonymise";
import { checkContent, factsForModel, insightContentSchema, SYSTEM_PROMPT, templateInsights, type InsightContent } from "./writer";

export const MAX_REFRESHES_PER_DAY = 5;
// Template insights are retried with the AI after this long, in case it was only briefly unavailable
const RETRY_AI_AFTER_MS = 60 * 60 * 1000;

/** Problems with an insights request carry their own HTTP status (never 401). */
export class InsightsError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "InsightsError";
    this.status = status;
  }
}

/**
 * Generates and stores the user's insights. Categorises new spending first, calculates the facts,
 * then has the AI word them, keeping only insights whose every figure we calculated. Falls back to
 * template sentences whenever the AI is unconfigured, unavailable or fails the check.
 */
export const generateInsights = async (userId: string, timezone: string) => {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { aiInsightsEnabled: true } });
  if (!user?.aiInsightsEnabled) return null; // turned off since the job was queued

  try {
    await categoriseRecentSpends(userId);
  } catch (err) {
    // Uncategorised spending still shows up, as "Not categorised yet"
    logger.warn({ err: String(err), userId }, "Categorising failed; continuing without");
  }

  const facts = await buildFacts(userId, timezone);
  let content: InsightContent = templateInsights(facts);
  let source: InsightSource = InsightSource.TEMPLATE;
  let model: string | null = null;

  const hasActivity = !new Prisma.Decimal(facts.current.spent).isZero() || !new Prisma.Decimal(facts.current.moneyIn).isZero();
  if (isAiConfigured() && hasActivity) {
    try {
      const pseudonyms = new Pseudonymiser();
      const { payload, allowed } = factsForModel(facts, pseudonyms);
      const result = await generateJson({
        models: [env.GEMINI_MODEL, env.GEMINI_CATEGORY_MODEL],
        system: SYSTEM_PROMPT,
        prompt: `Facts:\n${JSON.stringify(payload, null, 2)}`,
        schema: insightContentSchema,
      });
      const checked = checkContent(result.data, allowed, pseudonyms);
      if (checked) {
        content = checked;
        source = InsightSource.AI;
        model = result.model;
      } else {
        logger.warn({ userId, model: result.model }, "AI insights quoted figures we didn't calculate; using templates");
      }
    } catch (err) {
      if (!(err instanceof AiUnavailableError)) throw err;
      logger.warn({ userId, err: err.message }, "AI unavailable; using template insights");
    }
  }

  const data = {
    periodFrom: facts.period.from,
    periodTo: facts.period.to,
    facts: facts as unknown as Prisma.InputJsonValue,
    content: content as unknown as Prisma.InputJsonValue,
    source,
    model,
    generatedAt: new Date(),
  };
  return prisma.spendingInsight.upsert({ where: { userId }, update: data, create: { userId, ...data } });
};

const isStale = (insight: { periodTo: string; source: InsightSource; generatedAt: Date } | null, today: string) =>
  !insight ||
  insight.periodTo !== today ||
  (insight.source === InsightSource.TEMPLATE && isAiConfigured() && Date.now() - insight.generatedAt.getTime() > RETRY_AI_AFTER_MS);

/**
 * What the Insights screens show. Stale insights (from an earlier day, or templates while the AI
 * may be back) are returned as they are while a refresh runs in the background.
 */
export const getInsights = async (userId: string, timezone: string) => {
  const [user, insight] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { aiInsightsEnabled: true } }),
    prisma.spendingInsight.findUnique({ where: { userId } }),
  ]);
  if (!user.aiInsightsEnabled) return { enabled: false, insight: null, refreshing: false };

  let refreshing = await isRefreshPending(userId);
  if (!refreshing && isStale(insight, localDate(timezone, new Date()))) {
    await queueInsightsRefresh(userId, timezone);
    refreshing = true;
  }

  return {
    enabled: true,
    refreshing,
    insight: insight && {
      headline: (insight.content as unknown as InsightContent).headline,
      insights: (insight.content as unknown as InsightContent).insights,
      facts: insight.facts as unknown as InsightFacts,
      source: insight.source,
      generatedAt: insight.generatedAt,
    },
  };
};

/** "Refresh" button: up to MAX_REFRESHES_PER_DAY a day, so one user can't drain the AI quota. */
export const requestRefresh = async (userId: string, timezone: string) => {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { aiInsightsEnabled: true } });
  if (!user.aiInsightsEnabled) throw new InsightsError("Turn on AI insights first", 403);

  const key = `insights:refreshes:${userId}:${localDate(timezone, new Date())}`;
  const count = await redisClient.incr(key);
  if (count === 1) await redisClient.expire(key, 26 * 60 * 60);
  if (count > MAX_REFRESHES_PER_DAY) {
    throw new InsightsError(`You can refresh insights ${MAX_REFRESHES_PER_DAY} times a day. Try again tomorrow.`, 429);
  }
  await queueInsightsRefresh(userId, timezone);
};

/** Opt in or out. Opting out deletes the stored insights; opting in queues the first ones. */
export const setInsightsEnabled = async (userId: string, enabled: boolean, timezone: string) => {
  await prisma.user.update({
    where: { id: userId },
    data: enabled ? { aiInsightsEnabled: true, aiInsightsConsentAt: new Date() } : { aiInsightsEnabled: false },
  });
  if (enabled) await queueInsightsRefresh(userId, timezone);
  else await prisma.spendingInsight.deleteMany({ where: { userId } });
};

/**
 * The user's own category for a money-out transaction. It always wins: AI categorising only
 * fills rows that have no category.
 */
export const setTransactionCategory = async (userId: string, transactionId: string, category: SpendingCategory) => {
  const transaction = await prisma.transaction.findFirst({
    where: { id: transactionId, userId },
    select: { id: true, type: true },
  });
  if (!transaction) throw new InsightsError("Transaction not found", 404);
  if (transaction.type !== TransactionType.DEBIT) throw new InsightsError("Only money you spent can have a category", 400);
  const withdrawal = await prisma.withdrawal.findUnique({ where: { debitTransactionId: transactionId }, select: { id: true } });
  if (withdrawal) throw new InsightsError("Withdrawals to your own bank account aren't spending, so they have no category", 400);

  return prisma.transaction.update({
    where: { id: transactionId },
    data: { category, categorySource: CategorySource.USER },
    select: { id: true, category: true, categorySource: true },
  });
};
