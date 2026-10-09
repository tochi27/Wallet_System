import { DepositStatus, WithdrawalStatus } from "@prisma/client";
import prisma from "../../config/db";
import logger from "../../config/logger";
import { enqueuePaystackEvent } from "../../queues/paystack.queue";
import { confirmDeposit } from "./deposit.service";
import { isPaystackConfigured } from "./paystack.client";
import { confirmWithdrawal } from "./withdrawal.service";

const BATCH = 50;
const MINUTE = 60 * 1000;
// A checkout nobody completed within a day is treated as abandoned
const ABANDON_DEPOSITS_AFTER_MS = 24 * 60 * MINUTE;

const ago = (ms: number) => new Date(Date.now() - ms);

/**
 * Catches anything the webhook and follow-up checks missed: deposits still pending, withdrawals
 * still processing, and stored webhook events that never got processed. Every step it takes is
 * idempotent, so overlapping with a webhook is harmless.
 */
export const reconcilePayments = async (): Promise<void> => {
  if (!isPaystackConfigured()) return;
  const summary = { deposits: 0, abandoned: 0, withdrawals: 0, events: 0, errors: 0 };

  const deposits = await prisma.deposit.findMany({
    where: { status: DepositStatus.PENDING, createdAt: { lt: ago(2 * MINUTE) } },
    orderBy: { createdAt: "asc" },
    take: BATCH,
  });
  for (const deposit of deposits) {
    try {
      const result = await confirmDeposit(deposit.reference);
      summary.deposits++;
      if (result.status === DepositStatus.PENDING && deposit.createdAt < ago(ABANDON_DEPOSITS_AFTER_MS)) {
        await prisma.deposit.updateMany({
          where: { id: deposit.id, status: DepositStatus.PENDING },
          data: { status: DepositStatus.ABANDONED, failureReason: "Payment was not completed" },
        });
        summary.abandoned++;
      }
    } catch (err) {
      summary.errors++;
      logger.warn({ err, reference: deposit.reference }, "Reconcile: deposit check failed");
    }
  }

  const withdrawals = await prisma.withdrawal.findMany({
    where: { status: WithdrawalStatus.PROCESSING, createdAt: { lt: ago(MINUTE) } },
    orderBy: { createdAt: "asc" },
    take: BATCH,
  });
  for (const withdrawal of withdrawals) {
    try {
      await confirmWithdrawal(withdrawal.reference);
      summary.withdrawals++;
    } catch (err) {
      summary.errors++;
      logger.warn({ err, reference: withdrawal.reference }, "Reconcile: withdrawal check failed");
    }
  }

  const events = await prisma.paystackEvent.findMany({
    where: { processedAt: null, receivedAt: { lt: ago(5 * MINUTE) } },
    orderBy: { receivedAt: "asc" },
    take: BATCH,
    select: { id: true },
  });
  for (const event of events) {
    try {
      await enqueuePaystackEvent(event.id);
      summary.events++;
    } catch (err) {
      summary.errors++;
      logger.warn({ err, eventId: event.id }, "Reconcile: could not re-queue event");
    }
  }

  if (Object.values(summary).some((count) => count > 0)) logger.info(summary, "Payments reconciled");
};
