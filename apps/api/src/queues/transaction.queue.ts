import { Queue } from "bullmq";
import { bullmqConnection } from "../config/redis.config";
import logger from "../config/logger";

export type TransactionEvent =
  | { event: "CREDIT" | "DEBIT"; userId: string; transactionId: string; amount: string; reference: string; timestamp: string }
  | { event: "TRANSFER"; senderId: string; receiverId: string; transferId: string; amount: string; senderRef: string; receiverRef: string; timestamp: string }
  | { event: "REVERSAL"; userId: string; transactionId: string; originalId: string; amount: string; reference: string; timestamp: string };

export const transactionQueue = new Queue<TransactionEvent>("transactions", {
  connection: bullmqConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential", delay: 1000 },
    removeOnComplete: { count: 100 },
    removeOnFail: { count: 200 },
  },
});

// Non-fatal enqueue — queue failure must never roll back a committed transaction
export const enqueueTransactionEvent = async (
  data: TransactionEvent,
  jobId: string
): Promise<void> => {
  try {
    await transactionQueue.add("transaction.completed", data, { jobId });
  } catch (err) {
    logger.error({ err }, "Failed to enqueue transaction event");
  }
};
