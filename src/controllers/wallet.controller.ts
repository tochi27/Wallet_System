import { Request, Response } from "express";
import {
  creditWallet,
  debitWallet,
  getBalance,
  computeBalance,
  getTransactions,
} from "../services/wallet.service";
import { transferFunds } from "../services/transfer.service";
import { reverseTransaction } from "../services/reversal.service";
import { errorResponse, successResponse } from "../utils/response.utils";
import { transactionsQuerySchema } from "../validators/wallet.validators";

export const credit = async (req: Request, res: Response) => {
  try {
    if (!req.userId) return errorResponse(res, "User ID not found in request", 500);

    const { amount, description } = req.body;
    const idempotencyKey = req.headers["idempotency-key"] as string | undefined;
    const transaction = await creditWallet(req.userId, amount, description, idempotencyKey);

    return successResponse(res, "Wallet credited successfully", transaction, 200);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to credit wallet";
    return errorResponse(res, message, 500);
  }
};

export const debit = async (req: Request, res: Response) => {
  try {
    if (!req.userId) return errorResponse(res, "User ID not found in request", 500);

    const { amount, description } = req.body;
    const idempotencyKey = req.headers["idempotency-key"] as string | undefined;
    const transaction = await debitWallet(req.userId, amount, description, idempotencyKey);

    return successResponse(res, "Wallet debited successfully", transaction, 200);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to debit wallet";
    const status = message === "Insufficient funds" ? 400 : 500;
    return errorResponse(res, message, status);
  }
};

export const balance = async (req: Request, res: Response) => {
  try {
    if (!req.userId) return errorResponse(res, "User ID not found in request", 500);

    const [wallet, computed] = await Promise.all([
      getBalance(req.userId),
      computeBalance(req.userId),
    ]);

    return successResponse(res, "Wallet balance fetched successfully", {
      balance: wallet?.balance,
      computed,
    }, 200);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to fetch balance";
    return errorResponse(res, message, 500);
  }
};

export const transactions = async (req: Request, res: Response) => {
  try {
    if (!req.userId) return errorResponse(res, "User ID not found in request", 500);

    const parsed = transactionsQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      const message = parsed.error.issues[0]?.message ?? "Invalid query parameters";
      return errorResponse(res, message, 400);
    }

    const { limit, cursor } = parsed.data;
    const result = await getTransactions(req.userId, limit, cursor);
    return successResponse(res, "Transaction history fetched successfully", result, 200);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to fetch transactions";
    return errorResponse(res, message, 500);
  }
};

export const transfer = async (req: Request, res: Response) => {
  try {
    if (!req.userId) return errorResponse(res, "User ID not found in request", 500);

    const { receiverEmail, amount, description } = req.body;
    if (!receiverEmail) return errorResponse(res, "receiverEmail is required", 400);

    const idempotencyKey = req.headers["idempotency-key"] as string | undefined;

    const result = await transferFunds(
      req.userId,
      receiverEmail,
      amount,
      description,
      idempotencyKey
    );

    return successResponse(res, "Transfer successful", result, 200);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Transfer failed";
    const clientErrors = ["Insufficient funds", "Receiver not found", "Cannot transfer to yourself"];
    const status = clientErrors.includes(message) ? 400 : 500;
    return errorResponse(res, message, status);
  }
};

export const reverse = async (req: Request, res: Response) => {
  try {
    if (!req.userId) return errorResponse(res, "User ID not found in request", 500);

    const { transactionId } = req.params;
    const result = await reverseTransaction(transactionId, req.userId);

    return successResponse(res, "Transaction reversed successfully", result, 200);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Reversal failed";

    if (message === "Transaction not found") return errorResponse(res, message, 404);
    if (message === "Transaction has already been reversed") return errorResponse(res, message, 409);

    const clientErrors = [
      "Cannot reverse a reversal",
      "Insufficient funds to reverse this transaction",
      "Receiver has insufficient funds for reversal",
      "Paired transfer transaction is not reversible",
    ];
    const status = clientErrors.includes(message) ? 400 : 500;
    return errorResponse(res, message, status);
  }
};
