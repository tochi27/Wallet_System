import { Queue } from "bullmq";
import { bullmqConnection } from "../config/redis.config";
import logger from "../config/logger";

export type InsightsJobData = { userId: string; timezone: string };

export const insightsQueue = new Queue<InsightsJobData>("insights", {
  connection: bullmqConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential", delay: 60_000 },
    removeOnComplete: true,
    removeOnFail: { count: 200 },
  },
});

/**
 * Queues a regeneration for the user. The job id is per user, so asking again while one is
 * waiting or running doesn't queue a second. Never throws: insights can always wait.
 */
export const queueInsightsRefresh = async (userId: string, timezone: string): Promise<void> => {
  try {
    await insightsQueue.add("refresh", { userId, timezone }, { jobId: `insights-${userId}` });
  } catch (err) {
    logger.warn({ err, userId }, "Could not queue an insights refresh");
  }
};

/** True while a refresh for this user is waiting or running. */
export const isRefreshPending = async (userId: string): Promise<boolean> => {
  const job = await insightsQueue.getJob(`insights-${userId}`);
  if (!job) return false;
  const state = await job.getState();
  return state === "waiting" || state === "active" || state === "delayed" || state === "prioritized";
};
