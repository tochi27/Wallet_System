import { randomBytes } from "crypto";
import { Deposit, DepositStatus, Prisma, TransactionStatus, TransactionType } from "@prisma/client";
import prisma from "../../config/db";
import { env } from "../../config/env";
import logger from "../../config/logger";
import { enqueueTransactionEvent } from "../../queues/transaction.queue";
import { invalidateBalance } from "../../utils/cache.utils";
import { getIdempotencyRecord, saveIdempotencyRecord } from "../../utils/idempotency.utils";
import { withLock } from "../../utils/lock.utils";
import { initializeTransaction, toSubunit, verifyTransaction, type VerifiedTransaction } from "./paystack.client";

export const DEPOSIT_CURRENCY = "NGN";
export const DEPOSIT_DESCRIPTION = "Deposit via Paystack";

export class DepositNotFoundError extends Error {
  constructor() {
    super("Deposit not found");
    this.name = "DepositNotFoundError";
  }
}

export type DepositView = {
  reference: string;
  amount: string;
  currency: string;
  status: DepositStatus;
  authorizationUrl: string | null;
  channel: string | null;
  paidAt: Date | null;
  failureReason: string | null;
  transactionId: string | null;
  createdAt: Date;
};

export const toDepositView = (deposit: Deposit): DepositView => ({
  reference: deposit.reference,
  amount: deposit.amount.toFixed(2),
  currency: deposit.currency,
  status: deposit.status,
  authorizationUrl: deposit.authorizationUrl,
  channel: deposit.channel,
  paidAt: deposit.paidAt,
  failureReason: deposit.failureReason,
  transactionId: deposit.transactionId,
  createdAt: deposit.createdAt,
});

// Our own reference, sent to Paystack and echoed back on verify/webhook. Prefixed so it's
// recognisable in the Paystack dashboard.
const newReference = () => `dep_${randomBytes(12).toString("hex")}`;

// Idempotency keys share a store with credit/debit/transfer, so namespace them per operation
const idempotencyNamespace = (key: string) => `deposit:${key}`;

/**
 * Starts a deposit: records it as PENDING, then asks Paystack for a checkout link.
 * Nothing is credited here — that only happens once Paystack confirms the payment.
 */
export const createDeposit = async (
  userId: string,
  amount: number,
  idempotencyKey?: string
): Promise<DepositView> => {
  if (idempotencyKey) {
    const existing = await getIdempotencyRecord(idempotencyNamespace(idempotencyKey), userId);
    if (existing) return existing.response as DepositView;
  }

  const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
  if (!user) throw new Error("User not found");

  const deposit = await prisma.deposit.create({
    data: { userId, reference: newReference(), amount, currency: DEPOSIT_CURRENCY },
  });

  try {
    const checkout = await initializeTransaction({
      email: user.email,
      amount: toSubunit(deposit.amount),
      reference: deposit.reference,
      currency: deposit.currency,
      callbackUrl: env.PAYSTACK_CALLBACK_URL,
      metadata: { userId, depositId: deposit.id },
    });

    const updated = await prisma.deposit.update({
      where: { id: deposit.id },
      data: { authorizationUrl: checkout.authorization_url, accessCode: checkout.access_code },
    });

    const view = toDepositView(updated);
    if (idempotencyKey) await saveIdempotencyRecord(idempotencyNamespace(idempotencyKey), userId, view);
    return view;
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Could not start payment";
    await prisma.deposit.update({
      where: { id: deposit.id },
      data: { status: DepositStatus.FAILED, failureReason: reason },
    });
    throw error;
  }
};

/**
 * Credits the wallet for a confirmed payment — exactly once. The PENDING -> SUCCESSFUL claim
 * and the ledger credit share one database transaction, so a racing callback and webhook can't
 * both credit: whichever claims second sees count 0 and does nothing.
 */
const settleDeposit = async (deposit: Deposit, payment: VerifiedTransaction): Promise<void> => {
  const ledger = await withLock(deposit.userId, () =>
    prisma.$transaction(async (tx) => {
      const claimed = await tx.deposit.updateMany({
        where: { id: deposit.id, status: DepositStatus.PENDING },
        data: {
          status: DepositStatus.SUCCESSFUL,
          channel: payment.channel,
          paidAt: payment.paid_at ? new Date(payment.paid_at) : new Date(),
        },
      });
      if (claimed.count === 0) return null;

      const wallet = await tx.wallet.findUnique({ where: { userId: deposit.userId } });
      if (!wallet) throw new Error("Wallet not found");

      const balanceBefore = wallet.balance;
      const balanceAfter = new Prisma.Decimal(balanceBefore).add(deposit.amount);
      await tx.wallet.update({ where: { userId: deposit.userId }, data: { balance: balanceAfter } });

      const credit = await tx.transaction.create({
        data: {
          userId: deposit.userId,
          type: TransactionType.CREDIT,
          status: TransactionStatus.SUCCESSFUL,
          amount: deposit.amount,
          balanceBefore,
          balanceAfter,
          description: DEPOSIT_DESCRIPTION,
        },
      });
      await tx.deposit.update({ where: { id: deposit.id }, data: { transactionId: credit.id } });
      return credit;
    })
  );

  if (!ledger) return;

  await invalidateBalance(deposit.userId);
  await enqueueTransactionEvent(
    {
      event: "CREDIT",
      userId: deposit.userId,
      transactionId: ledger.id,
      amount: ledger.amount.toString(),
      reference: ledger.reference,
      timestamp: ledger.timestamp.toISOString(),
    },
    ledger.id
  );
  logger.info({ reference: deposit.reference, amount: deposit.amount.toString() }, "Deposit credited");
};

const markFailed = (depositId: string, reason: string) =>
  prisma.deposit.updateMany({
    where: { id: depositId, status: DepositStatus.PENDING },
    data: { status: DepositStatus.FAILED, failureReason: reason },
  });

/**
 * Asks Paystack what happened to a pending deposit and acts on it. Safe to call any number of
 * times, from the redirect, the webhook, or a background check: only a PENDING deposit can
 * change, and only once.
 *
 * Never trusts the caller — the outcome comes from Paystack's Verify endpoint, and the amount,
 * currency and reference must match what we asked for before anything is credited.
 */
export const confirmDeposit = async (reference: string): Promise<Deposit> => {
  const deposit = await prisma.deposit.findUnique({ where: { reference } });
  if (!deposit) throw new DepositNotFoundError();
  if (deposit.status !== DepositStatus.PENDING) return deposit;

  const payment = await verifyTransaction(reference);

  if (payment.status === "success") {
    const expected = toSubunit(deposit.amount);
    if (payment.reference !== deposit.reference || payment.amount !== expected || payment.currency !== deposit.currency) {
      logger.error(
        { reference, expected, paid: payment.amount, currency: payment.currency },
        "Paystack payment does not match the deposit — not crediting"
      );
      await markFailed(deposit.id, "Payment details did not match the deposit");
    } else {
      await settleDeposit(deposit, payment);
    }
  } else if (payment.status === "failed" || payment.status === "reversed") {
    await markFailed(deposit.id, payment.gateway_response ?? `Payment ${payment.status}`);
  }
  // Any other status (abandoned, ongoing, pending…) leaves the deposit PENDING — the customer
  // may still complete the payment.

  return prisma.deposit.findUniqueOrThrow({ where: { id: deposit.id } });
};

/**
 * Returns a user's deposit. While it's still pending, checks with Paystack first so the
 * callback page sees the result without waiting for the webhook.
 */
export const getDeposit = async (userId: string, reference: string): Promise<DepositView> => {
  const deposit = await prisma.deposit.findFirst({ where: { reference, userId } });
  if (!deposit) throw new DepositNotFoundError();
  if (deposit.status !== DepositStatus.PENDING) return toDepositView(deposit);

  try {
    return toDepositView(await confirmDeposit(reference));
  } catch (error) {
    // Paystack being briefly unreachable shouldn't break the status page; report it as pending
    logger.warn({ err: error, reference }, "Could not verify deposit with Paystack");
    return toDepositView(deposit);
  }
};
