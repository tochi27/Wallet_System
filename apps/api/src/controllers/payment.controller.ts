import { Request, Response } from "express";
import logger from "../config/logger";
import { enqueuePaystackEvent } from "../queues/paystack.queue";
import {
  addBankAccount,
  BankAccountLimitError,
  BankAccountNotFoundError,
  getBanks,
  isTestMode,
  listBankAccounts,
  lookupAccount,
  RecipientRejectedError,
  removeBankAccount,
} from "../services/payments/bank-account.service";
import { createDeposit, DepositNotFoundError, getDeposit } from "../services/payments/deposit.service";
import {
  createWithdrawal,
  InsufficientFundsError,
  listWithdrawals,
  WithdrawalNotFoundError,
} from "../services/payments/withdrawal.service";
import { isPaystackConfigured, PaymentsNotConfiguredError, PaystackError } from "../services/payments/paystack.client";
import { isValidSignature, recordEvent, type PaystackWebhookPayload } from "../services/payments/paystack-webhook.service";
import { getRawBody } from "../utils/rawBody.utils";
import { errorResponse, successResponse } from "../utils/response.utils";

const handlePaymentError = (res: Response, err: unknown, fallback: string) => {
  if (err instanceof PaymentsNotConfiguredError) return errorResponse(res, err.message, 503);
  if (
    err instanceof DepositNotFoundError ||
    err instanceof WithdrawalNotFoundError ||
    err instanceof BankAccountNotFoundError
  ) {
    return errorResponse(res, err.message, 404);
  }
  if (
    err instanceof InsufficientFundsError ||
    err instanceof BankAccountLimitError ||
    err instanceof RecipientRejectedError
  ) {
    return errorResponse(res, err.message, 400);
  }
  if (err instanceof Error && err.message === "Unknown bank") return errorResponse(res, "Choose a bank from the list", 400);
  if (err instanceof PaystackError) {
    logger.error({ err }, "Paystack request failed");
    return errorResponse(res, `Payment provider error: ${err.message}`, 502);
  }
  logger.error({ err }, fallback);
  return errorResponse(res, fallback, 500);
};

export const startDeposit = async (req: Request, res: Response) => {
  try {
    const idempotencyKey = req.headers["idempotency-key"] as string | undefined;
    const deposit = await createDeposit(req.userId, req.body.amount, idempotencyKey);
    return successResponse(res, "Deposit started", deposit, 200);
  } catch (err) {
    return handlePaymentError(res, err, "Could not start deposit");
  }
};

export const depositStatus = async (req: Request, res: Response) => {
  try {
    const deposit = await getDeposit(req.userId, String(req.params.reference));
    return successResponse(res, "Deposit fetched successfully", deposit, 200);
  } catch (err) {
    return handlePaymentError(res, err, "Could not fetch deposit");
  }
};

/**
 * Paystack webhook. Verifies the signature against the raw body, records the event (ignoring
 * redeliveries), queues it, and acknowledges quickly: Paystack retries anything that is not a 200.
 */
export const paystackWebhook = async (req: Request, res: Response) => {
  if (!isPaystackConfigured()) return errorResponse(res, "Payments are not configured", 503);

  const rawBody = getRawBody(req);
  if (!rawBody || !isValidSignature(rawBody, req.header("x-paystack-signature"))) {
    logger.warn({ ip: req.ip }, "Rejected Paystack webhook with an invalid signature");
    return errorResponse(res, "Invalid signature", 401);
  }

  const payload = req.body as PaystackWebhookPayload;
  if (!payload || typeof payload.event !== "string") return errorResponse(res, "Invalid payload", 400);

  try {
    const { id, duplicate, processed } = await recordEvent(payload);
    if (!processed) await enqueuePaystackEvent(id);
    if (duplicate) logger.info({ event: payload.event, id }, "Duplicate Paystack webhook");
    return res.status(200).json({ received: true });
  } catch (err) {
    // A non-200 makes Paystack retry, and the duplicate path re-queues an unprocessed event
    logger.error({ err }, "Failed to accept Paystack webhook");
    return errorResponse(res, "Could not accept webhook", 500);
  }
};

// ---------- Banks and bank accounts ----------

// Account lookups fail with Paystack 4xx when the number doesn't exist at that bank
const handleLookupError = (res: Response, err: unknown, fallback: string) => {
  if (err instanceof PaystackError && err.status === 429) {
    // Paystack's own wording is aimed at the merchant ("upgrade to live mode")
    const message = isTestMode()
      ? "Too many bank lookups today: Paystack test mode allows 3 real accounts a day. Choose \"Paystack Test Bank\" to keep testing."
      : "Too many account lookups right now. Please try again in a few minutes.";
    return errorResponse(res, message, 429);
  }
  if (err instanceof PaystackError && err.status >= 400 && err.status < 500) {
    return errorResponse(res, "We couldn't find that account. Check the account number and bank.", 400);
  }
  return handlePaymentError(res, err, fallback);
};

export const banks = async (_req: Request, res: Response) => {
  try {
    return successResponse(res, "Banks fetched successfully", await getBanks(), 200);
  } catch (err) {
    return handlePaymentError(res, err, "Could not fetch banks");
  }
};

export const resolveBankAccount = async (req: Request, res: Response) => {
  try {
    const account = await lookupAccount(req.body.bankCode, req.body.accountNumber);
    return successResponse(res, "Account resolved", account, 200);
  } catch (err) {
    return handleLookupError(res, err, "Could not look up account");
  }
};

export const saveBankAccount = async (req: Request, res: Response) => {
  try {
    const account = await addBankAccount(req.userId, req.body.bankCode, req.body.accountNumber);
    return successResponse(res, "Bank account saved", account, 200);
  } catch (err) {
    return handleLookupError(res, err, "Could not save bank account");
  }
};

export const bankAccounts = async (req: Request, res: Response) => {
  try {
    return successResponse(res, "Bank accounts fetched successfully", await listBankAccounts(req.userId), 200);
  } catch (err) {
    return handlePaymentError(res, err, "Could not fetch bank accounts");
  }
};

export const deleteBankAccount = async (req: Request, res: Response) => {
  try {
    await removeBankAccount(req.userId, String(req.params.id));
    return successResponse(res, "Bank account removed", {}, 200);
  } catch (err) {
    return handlePaymentError(res, err, "Could not remove bank account");
  }
};

// ---------- Withdrawals ----------

export const startWithdrawal = async (req: Request, res: Response) => {
  try {
    const idempotencyKey = req.headers["idempotency-key"] as string | undefined;
    const withdrawal = await createWithdrawal(req.userId, req.body.bankAccountId, req.body.amount, idempotencyKey);
    return successResponse(res, "Withdrawal started", withdrawal, 200);
  } catch (err) {
    return handlePaymentError(res, err, "Could not start withdrawal");
  }
};

export const withdrawals = async (req: Request, res: Response) => {
  try {
    return successResponse(res, "Withdrawals fetched successfully", await listWithdrawals(req.userId), 200);
  } catch (err) {
    return handlePaymentError(res, err, "Could not fetch withdrawals");
  }
};
