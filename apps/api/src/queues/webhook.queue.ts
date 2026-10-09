import { Queue } from "bullmq";
import { bullmqConnection } from "../config/redis.config";

export interface WebhookJobData {
  webhookId: string;
  url: string;
  secret: string;
  event: string;
  payload: object;
}

export const webhookQueue = new Queue<WebhookJobData>("webhook-dispatch", {
  connection: bullmqConnection,
  defaultJobOptions: {
    attempts: 4,
    backoff: { type: "exponential", delay: 2000 },
    removeOnComplete: { count: 100 },
    removeOnFail: { count: 500 },
  },
});
