import { Worker, Job } from "bullmq";
import { bullmqConnection } from "../config/redis.config";
import type { PaystackEventJobData } from "../queues/paystack.queue";
import { processEvent } from "../services/payments/paystack-webhook.service";

export const processPaystackJob = async (job: Job<PaystackEventJobData>): Promise<void> => {
  await processEvent(job.data.eventId);
};

export const createPaystackWorker = (): Worker<PaystackEventJobData> =>
  new Worker<PaystackEventJobData>("paystack-events", processPaystackJob, {
    connection: bullmqConnection,
    concurrency: 5,
  });
