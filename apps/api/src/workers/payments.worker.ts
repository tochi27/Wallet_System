import { Worker, Job } from "bullmq";
import { WithdrawalStatus } from "@prisma/client";
import { bullmqConnection } from "../config/redis.config";
import type { PaymentsJobData } from "../queues/payments.queue";
import { reconcilePayments } from "../services/payments/reconcile.service";
import { confirmWithdrawal } from "../services/payments/withdrawal.service";

export const processPaymentsJob = async (job: Job<PaymentsJobData>): Promise<void> => {
  if (job.data.kind === "reconcile") {
    await reconcilePayments();
    return;
  }
  const withdrawal = await confirmWithdrawal(job.data.reference);
  // Throwing makes BullMQ retry with backoff until the transfer settles
  if (withdrawal.status === WithdrawalStatus.PROCESSING) {
    throw new Error("Withdrawal still processing");
  }
};

export const createPaymentsWorker = (): Worker<PaymentsJobData> =>
  new Worker<PaymentsJobData>("payments-maintenance", processPaymentsJob, {
    connection: bullmqConnection,
    concurrency: 2,
  });
