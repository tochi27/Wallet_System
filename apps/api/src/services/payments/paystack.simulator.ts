import { createHash } from "crypto";
import redisClient from "../redis.service";
import type { CreatedRecipient, InitiatedTransfer, VerifiedTransfer } from "./paystack.client";

/**
 * Development-only stand-in for Paystack's transfer side, enabled by PAYSTACK_SIMULATE_PAYOUTS.
 * Env validation refuses it in production or with a live key.
 *
 * Behaviour, so every path can be exercised locally:
 * - transfers start "pending" and settle about 5 seconds later
 * - an amount whose kobo ends in 13 (e.g. ₦100.13) fails, to exercise refunds
 * - everything else succeeds
 */

const SETTLE_AFTER_MS = 5_000;
const transferKey = (reference: string) => `paystack-sim:transfer:${reference}`;

export const simulateCreateRecipient = (input: {
  name: string;
  accountNumber: string;
  bankCode: string;
}): CreatedRecipient => {
  const digest = createHash("sha256").update(`${input.bankCode}:${input.accountNumber}`).digest("hex");
  return {
    recipient_code: `RCP_sim_${digest.slice(0, 16)}`,
    details: { account_number: input.accountNumber, account_name: input.name, bank_code: input.bankCode },
  };
};

export const simulateInitiateTransfer = async (input: {
  amount: number;
  reference: string;
}): Promise<InitiatedTransfer> => {
  const stored = JSON.stringify({ amount: input.amount, startedAt: Date.now() });
  // NX: re-initiating the same reference behaves like Paystack (no second transfer)
  await redisClient.set(transferKey(input.reference), stored, "EX", 86_400, "NX");
  return { status: "pending", transfer_code: `TRF_sim_${input.reference}`, reference: input.reference };
};

export const simulateVerifyTransfer = async (reference: string): Promise<VerifiedTransfer | null> => {
  const stored = await redisClient.get(transferKey(reference));
  if (!stored) return null;
  const { amount, startedAt } = JSON.parse(stored) as { amount: number; startedAt: number };
  if (Date.now() - startedAt < SETTLE_AFTER_MS) {
    return { status: "pending", reference, reason: null, transfer_code: `TRF_sim_${reference}` };
  }
  const fails = amount % 100 === 13;
  return {
    status: fails ? "failed" : "success",
    reference,
    reason: fails ? "Simulated failure: destination account rejected the transfer" : null,
    transfer_code: `TRF_sim_${reference}`,
  };
};
