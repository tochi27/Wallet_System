import { Worker, Job } from "bullmq";
import { bullmqConnection } from "../config/redis.config";
import type { InsightsJobData } from "../queues/insights.queue";
import { generateInsights } from "../services/insights/insights.service";

export const processInsightsJob = async (job: Job<InsightsJobData>): Promise<void> => {
  await generateInsights(job.data.userId, job.data.timezone);
};

// At most 10 refreshes a minute across all users, to stay inside the AI provider's free-tier limits
export const createInsightsWorker = (): Worker<InsightsJobData> =>
  new Worker<InsightsJobData>("insights", processInsightsJob, {
    connection: bullmqConnection,
    concurrency: 2,
    limiter: { max: 10, duration: 60_000 },
  });
