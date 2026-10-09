import { Queue } from "bullmq";
import { bullmqConnection } from "../config/redis.config";

export interface PaystackEventJobData {
  eventId: string;
}

export const paystackQueue = new Queue<PaystackEventJobData>("paystack-events", {
  connection: bullmqConnection,
  defaultJobOptions: {
    // We acknowledge Paystack before processing, so retries for processing failures
    // (e.g. Paystack's verify endpoint briefly down) live here rather than with Paystack
    attempts: 8,
    backoff: { type: "exponential", delay: 5000 },
    removeOnComplete: { count: 500 },
    removeOnFail: { count: 1000 },
  },
});

// jobId = event row id, so a redelivered webhook can't queue the same event twice
export const enqueuePaystackEvent = async (eventId: string): Promise<void> => {
  await paystackQueue.add("paystack.event", { eventId }, { jobId: eventId });
};
