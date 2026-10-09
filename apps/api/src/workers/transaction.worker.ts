import { Worker, Job } from "bullmq";
import { bullmqConnection } from "../config/redis.config";
import { TransactionEvent } from "../queues/transaction.queue";
import { dispatchWebhooksForUser } from "../services/webhook.service";
import logger from "../config/logger";

const processTransactionEvent = async (job: Job<TransactionEvent>): Promise<void> => {
  const data = job.data;

  const dispatch = (userId: string) =>
    dispatchWebhooksForUser(userId, data.event, data).catch((err) =>
      logger.error({ err, userId }, "Webhook dispatch error")
    );

  if (data.event === "TRANSFER") {
    await Promise.all([dispatch(data.senderId), dispatch(data.receiverId)]);
  } else {
    await dispatch(data.userId);
  }
};

export const createTransactionWorker = (): Worker<TransactionEvent> =>
  new Worker<TransactionEvent>("transactions", processTransactionEvent, {
    connection: bullmqConnection,
    concurrency: 5,
  });
