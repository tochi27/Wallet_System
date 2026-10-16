import { Queue } from "bullmq";
import { bullmqConnection } from "../config/redis.config";
import logger from "../config/logger";

export type PaymentsJobData = { kind: "check-withdrawal"; reference: string } | { kind: "reconcile" } | { kind: "purge-kyc" };

// Follow-up checks and periodic reconciliation for Paystack money movement
export const paymentsQueue = new Queue<PaymentsJobData>("payments-maintenance", {
  connection: bullmqConnection,
  defaultJobOptions: {
    removeOnComplete: true,
    removeOnFail: { count: 500 },
  },
});

const RECONCILE_EVERY_MS = 5 * 60 * 1000;

/**
 * Checks a withdrawal with Paystack shortly after its transfer is sent, then with growing gaps
 * while it's still processing (the job throws until it settles). Covers environments where
 * Paystack's webhook can't reach us, such as local development.
 */
export const scheduleWithdrawalCheck = async (reference: string): Promise<void> => {
  try {
    await paymentsQueue.add(
      "check-withdrawal",
      { kind: "check-withdrawal", reference },
      { jobId: `check-withdrawal-${reference}`, delay: 6_000, attempts: 8, backoff: { type: "exponential", delay: 15_000 } }
    );
  } catch (err) {
    // The periodic reconciliation still picks the withdrawal up
    logger.error({ err, reference }, "Failed to schedule withdrawal check");
  }
};

/** Registers the repeating reconciliation run. Idempotent across restarts. */
export const startPaymentsReconciliation = () =>
  paymentsQueue.upsertJobScheduler(
    "payments-reconcile",
    { every: RECONCILE_EVERY_MS },
    { name: "reconcile", data: { kind: "reconcile" } }
  );

// Deletes the ID photos of upgrade requests rejected over 30 days ago, once a day
export const startKycPurge = () =>
  paymentsQueue.upsertJobScheduler("kyc-purge", { every: 24 * 60 * 60 * 1000 }, { name: "purge-kyc", data: { kind: "purge-kyc" } });
