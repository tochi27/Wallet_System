import { randomBytes } from "crypto";
import {
  BankAccount,
  Prisma,
  TransactionStatus,
  TransactionType,
  Withdrawal,
  WithdrawalStatus,
} from "@prisma/client";
import prisma from "../../config/db";
import logger from "../../config/logger";
import { scheduleWithdrawalCheck } from "../../queues/payments.queue";
import { enqueueTransactionEvent } from "../../queues/transaction.queue";
import { invalidateBalance } from "../../utils/cache.utils";
import { getIdempotencyRecord, saveIdempotencyRecord } from "../../utils/idempotency.utils";
import { withLock } from "../../utils/lock.utils";
import { getActiveBankAccount } from "./bank-account.service";
import { initiateTransfer, PaystackError, toSubunit, verifyTransfer, type TransferStatus } from "./paystack.client";

export class InsufficientFundsError extends Error {
  constructor() {
    super("Insufficient funds");
    this.name = "InsufficientFundsError";
  }
}

export class WithdrawalNotFoundError extends Error {
  constructor() {
    super("Withdrawal not found");
    this.name = "WithdrawalNotFoundError";
  }
}

type WithdrawalWithAccount = Withdrawal & { bankAccount: BankAccount };

export type WithdrawalView = {
  reference: string;
  amount: string;
  currency: string;
  status: WithdrawalStatus;
  failureReason: string | null;
  bankAccount: { bankName: string; accountNumberLast4: string; accountName: string };
  createdAt: Date;
  completedAt: Date | null;
};

export const toWithdrawalView = (withdrawal: WithdrawalWithAccount): WithdrawalView => ({
  reference: withdrawal.reference,
  amount: withdrawal.amount.toFixed(2),
  currency: withdrawal.currency,
  status: withdrawal.status,
  failureReason: withdrawal.failureReason,
  bankAccount: {
    bankName: withdrawal.bankAccount.bankName,
    accountNumberLast4: withdrawal.bankAccount.accountNumberLast4,
    accountName: withdrawal.bankAccount.accountName,
  },
  createdAt: withdrawal.createdAt,
  completedAt: withdrawal.completedAt,
});

// At least 16 characters, as Paystack requires for transfer references
const newReference = () => `wd_${randomBytes(12).toString("hex")}`;
const idempotencyNamespace = (key: string) => `withdrawal:${key}`;

// A transfer Paystack never created is only treated as failed after this long, in case the
// original request is still in flight
const MISSING_TRANSFER_GRACE_MS = 10 * 60 * 1000;

// Paystack's reasons are written for the merchant. These are about our Paystack account, not
// the user's, so the user gets a neutral message and the operator gets the log line.
const MERCHANT_SIDE_ERRORS = [/starter business/i, /balance is not enough/i, /transfers? (are|is) (not )?(disabled|enabled)/i];

const userFacingReason = (paystackMessage: string) =>
  MERCHANT_SIDE_ERRORS.some((pattern) => pattern.test(paystackMessage))
    ? "Withdrawals are temporarily unavailable"
    : `The transfer was rejected: ${paystackMessage}`;

const withAccount = (id: string) =>
  prisma.withdrawal.findUniqueOrThrow({ where: { id }, include: { bankAccount: true } });

/**
 * Returns a withdrawal's money to the wallet — exactly once. Claiming the withdrawal (PROCESSING,
 * or SUCCESSFUL for a later reversal) and crediting the wallet share one database transaction.
 * The original debit is marked REVERSED and the refund linked to it, matching how reversals work.
 */
const refundWithdrawal = async (
  withdrawalId: string,
  outcome: typeof WithdrawalStatus.FAILED | typeof WithdrawalStatus.REVERSED,
  reason: string
): Promise<void> => {
  const withdrawal = await prisma.withdrawal.findUniqueOrThrow({ where: { id: withdrawalId } });
  const claimable: WithdrawalStatus[] =
    outcome === WithdrawalStatus.REVERSED
      ? [WithdrawalStatus.PROCESSING, WithdrawalStatus.SUCCESSFUL]
      : [WithdrawalStatus.PROCESSING];

  const refund = await withLock(withdrawal.userId, () =>
    prisma.$transaction(async (tx) => {
      const claimed = await tx.withdrawal.updateMany({
        where: { id: withdrawalId, status: { in: claimable } },
        data: { status: outcome, failureReason: reason, completedAt: new Date() },
      });
      if (claimed.count === 0) return null;

      const wallet = await tx.wallet.findUnique({ where: { userId: withdrawal.userId } });
      if (!wallet) throw new Error("Wallet not found");
      const balanceBefore = wallet.balance;
      const balanceAfter = new Prisma.Decimal(balanceBefore).add(withdrawal.amount);
      await tx.wallet.update({ where: { userId: withdrawal.userId }, data: { balance: balanceAfter } });

      await tx.transaction.update({
        where: { id: withdrawal.debitTransactionId },
        data: { status: TransactionStatus.REVERSED },
      });
      const credit = await tx.transaction.create({
        data: {
          userId: withdrawal.userId,
          type: TransactionType.CREDIT,
          status: TransactionStatus.SUCCESSFUL,
          amount: withdrawal.amount,
          balanceBefore,
          balanceAfter,
          description: outcome === WithdrawalStatus.REVERSED ? "Refund: withdrawal reversed" : "Refund: withdrawal failed",
          reversalOf: withdrawal.debitTransactionId,
        },
      });
      await tx.withdrawal.update({ where: { id: withdrawalId }, data: { refundTransactionId: credit.id } });
      return credit;
    })
  );

  if (!refund) return;

  await invalidateBalance(withdrawal.userId);
  await enqueueTransactionEvent(
    {
      event: "REVERSAL",
      userId: withdrawal.userId,
      transactionId: refund.id,
      originalId: withdrawal.debitTransactionId,
      amount: refund.amount.toString(),
      reference: refund.reference,
      timestamp: refund.timestamp.toISOString(),
    },
    refund.id
  );
  logger.info({ reference: withdrawal.reference, outcome, reason }, "Withdrawal refunded");
};

const markSuccessful = (withdrawalId: string) =>
  prisma.withdrawal.updateMany({
    where: { id: withdrawalId, status: WithdrawalStatus.PROCESSING },
    data: { status: WithdrawalStatus.SUCCESSFUL, completedAt: new Date() },
  });

/** Moves a withdrawal on according to what Paystack says happened to its transfer. */
const applyTransferStatus = async (withdrawalId: string, status: TransferStatus, reason: string | null) => {
  switch (status) {
    case "success":
      await markSuccessful(withdrawalId);
      return;
    case "reversed":
      await refundWithdrawal(withdrawalId, WithdrawalStatus.REVERSED, reason ?? "The transfer was reversed");
      return;
    case "failed":
    case "abandoned":
    case "blocked":
    case "rejected":
      await refundWithdrawal(withdrawalId, WithdrawalStatus.FAILED, reason ?? `The transfer ${status}`);
      return;
    case "otp":
      // Transfers waiting for OTP never complete on their own; the Paystack account needs
      // "Confirm transfers before sending" turned off for automated payouts
      logger.error({ withdrawalId }, "Paystack transfer is waiting for OTP — disable transfer OTP in Paystack settings");
      await refundWithdrawal(withdrawalId, WithdrawalStatus.FAILED, "Withdrawals are temporarily unavailable");
      return;
    default:
      // pending / processing / queued / received: still on its way
      return;
  }
};

/**
 * Sends the Paystack transfer for a freshly debited withdrawal. A definite rejection refunds at
 * once; an unknown outcome (timeout, Paystack error) leaves it PROCESSING for the follow-up checks
 * to settle — retrying blindly could pay out twice.
 */
const sendTransfer = async (withdrawal: Withdrawal, account: BankAccount) => {
  try {
    const transfer = await initiateTransfer({
      amount: toSubunit(withdrawal.amount),
      recipient: account.recipientCode,
      reference: withdrawal.reference,
      reason: "Wallet withdrawal",
    });
    await prisma.withdrawal.update({ where: { id: withdrawal.id }, data: { transferCode: transfer.transfer_code } });
    await applyTransferStatus(withdrawal.id, transfer.status, null);
  } catch (error) {
    if (error instanceof PaystackError && error.status >= 400 && error.status < 500) {
      logger.error({ err: error, reference: withdrawal.reference }, "Paystack rejected the transfer");
      await refundWithdrawal(withdrawal.id, WithdrawalStatus.FAILED, userFacingReason(error.message));
      return;
    }
    logger.warn({ err: error, reference: withdrawal.reference }, "Transfer outcome unknown; will check with Paystack");
  }
  await scheduleWithdrawalCheck(withdrawal.reference);
};

/**
 * Withdraws to a saved bank account. The wallet is debited first, under the wallet lock, so the
 * money can't also be spent while the payout is in flight.
 */
export const createWithdrawal = async (
  userId: string,
  bankAccountId: string,
  amount: number,
  idempotencyKey?: string
): Promise<WithdrawalView> => {
  if (idempotencyKey) {
    const existing = await getIdempotencyRecord(idempotencyNamespace(idempotencyKey), userId);
    if (existing) return existing.response as WithdrawalView;
  }

  const account = await getActiveBankAccount(userId, bankAccountId);
  const reference = newReference();

  const { withdrawal, debit } = await withLock(userId, () =>
    prisma.$transaction(async (tx) => {
      const wallet = await tx.wallet.findUnique({ where: { userId } });
      if (!wallet) throw new Error("Wallet not found");
      if (new Prisma.Decimal(wallet.balance).lt(amount)) throw new InsufficientFundsError();

      const balanceBefore = wallet.balance;
      const balanceAfter = new Prisma.Decimal(balanceBefore).sub(amount);
      await tx.wallet.update({ where: { userId }, data: { balance: balanceAfter } });

      const debit = await tx.transaction.create({
        data: {
          userId,
          type: TransactionType.DEBIT,
          status: TransactionStatus.SUCCESSFUL,
          amount,
          balanceBefore,
          balanceAfter,
          description: `Withdrawal to ${account.bankName} ••${account.accountNumberLast4}`,
        },
      });
      const withdrawal = await tx.withdrawal.create({
        data: { userId, bankAccountId, reference, amount, debitTransactionId: debit.id },
      });
      return { withdrawal, debit };
    })
  );

  await invalidateBalance(userId);
  await enqueueTransactionEvent(
    {
      event: "DEBIT",
      userId,
      transactionId: debit.id,
      amount: debit.amount.toString(),
      reference: debit.reference,
      timestamp: debit.timestamp.toISOString(),
    },
    debit.id
  );

  await sendTransfer(withdrawal, account);

  const view = toWithdrawalView(await withAccount(withdrawal.id));
  if (idempotencyKey) await saveIdempotencyRecord(idempotencyNamespace(idempotencyKey), userId, view);
  return view;
};

/**
 * Asks Paystack what happened to a withdrawal's transfer and acts on it. Safe to repeat — used by
 * the webhook, the follow-up check after sending, and the periodic reconciliation.
 */
export const confirmWithdrawal = async (reference: string): Promise<Withdrawal> => {
  const withdrawal = await prisma.withdrawal.findUnique({ where: { reference } });
  if (!withdrawal) throw new WithdrawalNotFoundError();

  const open = withdrawal.status === WithdrawalStatus.PROCESSING || withdrawal.status === WithdrawalStatus.SUCCESSFUL;
  if (!open) return withdrawal;

  const transfer = await verifyTransfer(reference);
  if (!transfer) {
    const age = Date.now() - withdrawal.createdAt.getTime();
    if (withdrawal.status === WithdrawalStatus.PROCESSING && age > MISSING_TRANSFER_GRACE_MS) {
      await refundWithdrawal(withdrawal.id, WithdrawalStatus.FAILED, "The transfer could not be started");
    }
  } else if (withdrawal.status === WithdrawalStatus.PROCESSING || transfer.status === "reversed") {
    await applyTransferStatus(withdrawal.id, transfer.status, transfer.reason);
  }

  return prisma.withdrawal.findUniqueOrThrow({ where: { id: withdrawal.id } });
};

export const listWithdrawals = async (userId: string, limit = 20): Promise<WithdrawalView[]> => {
  const withdrawals = await prisma.withdrawal.findMany({
    where: { userId },
    include: { bankAccount: true },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
  return withdrawals.map(toWithdrawalView);
};
