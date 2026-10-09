import { Prisma } from "@prisma/client";
import { env } from "../../config/env";
import { simulateCreateRecipient, simulateInitiateTransfer, simulateVerifyTransfer } from "./paystack.simulator";

const REQUEST_TIMEOUT_MS = 15_000;

export class PaymentsNotConfiguredError extends Error {
  constructor() {
    super("Payments are not configured");
    this.name = "PaymentsNotConfiguredError";
  }
}

export class PaystackError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "PaystackError";
    this.status = status;
  }
}

type PaystackEnvelope<T> = { status: boolean; message: string; data: T };

export const isPaystackConfigured = (): boolean => Boolean(env.PAYSTACK_SECRET_KEY);

const secretKey = (): string => {
  if (!env.PAYSTACK_SECRET_KEY) throw new PaymentsNotConfiguredError();
  return env.PAYSTACK_SECRET_KEY;
};

const request = async <T>(path: string, init: { method?: "GET" | "POST"; body?: unknown } = {}): Promise<T> => {
  let res: Response;
  try {
    res = await fetch(`${env.PAYSTACK_BASE_URL}${path}`, {
      method: init.method ?? "GET",
      headers: {
        Authorization: `Bearer ${secretKey()}`,
        "Content-Type": "application/json",
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    if (err instanceof PaymentsNotConfiguredError) throw err;
    throw new PaystackError("Could not reach Paystack", 0);
  }

  const payload = (await res.json().catch(() => null)) as PaystackEnvelope<T> | null;
  if (!res.ok || !payload?.status) {
    throw new PaystackError(payload?.message ?? `Paystack request failed (${res.status})`, res.status);
  }
  return payload.data;
};

// Paystack amounts are integers in the currency's subunit (kobo for NGN). Decimal maths keeps
// e.g. 1000.10 from becoming 100009.99999 kobo.
export const toSubunit = (amount: Prisma.Decimal | number | string): number =>
  new Prisma.Decimal(amount).mul(100).toDecimalPlaces(0).toNumber();

export const fromSubunit = (subunit: number): Prisma.Decimal => new Prisma.Decimal(subunit).div(100);

export type InitializeTransactionInput = {
  email: string;
  amount: number; // subunit
  reference: string;
  currency: string;
  callbackUrl: string;
  metadata?: Record<string, unknown>;
};

export type InitializedTransaction = {
  authorization_url: string;
  access_code: string;
  reference: string;
};

export const initializeTransaction = (input: InitializeTransactionInput) =>
  request<InitializedTransaction>("/transaction/initialize", {
    method: "POST",
    body: {
      email: input.email,
      amount: input.amount,
      reference: input.reference,
      currency: input.currency,
      callback_url: input.callbackUrl,
      metadata: input.metadata,
    },
  });

// The fields we rely on from Verify Transaction; Paystack returns many more
export type VerifiedTransaction = {
  id: number;
  status: "success" | "failed" | "abandoned" | "reversed" | "ongoing" | "pending" | "processing" | "queued";
  reference: string;
  amount: number; // subunit
  currency: string;
  channel: string | null;
  paid_at: string | null;
  gateway_response: string | null;
};

export const verifyTransaction = (reference: string) =>
  request<VerifiedTransaction>(`/transaction/verify/${encodeURIComponent(reference)}`);

// ── Banks and payout recipients ─────────────────────────────────────────────

export type PaystackBank = {
  name: string;
  code: string;
  active: boolean;
  supports_transfer: boolean;
  is_deleted: boolean | null;
};

export const listBanks = (currency: string) =>
  request<PaystackBank[]>(`/bank?currency=${encodeURIComponent(currency)}&perPage=500`);

export type ResolvedAccount = { account_number: string; account_name: string };

export const resolveAccount = (accountNumber: string, bankCode: string) =>
  request<ResolvedAccount>(
    `/bank/resolve?account_number=${encodeURIComponent(accountNumber)}&bank_code=${encodeURIComponent(bankCode)}`
  );

export type CreatedRecipient = {
  recipient_code: string;
  details: { account_number: string; account_name: string | null; bank_code: string };
};

export const createTransferRecipient = async (input: {
  name: string;
  accountNumber: string;
  bankCode: string;
  currency: string;
}): Promise<CreatedRecipient> => {
  if (env.PAYSTACK_SIMULATE_PAYOUTS) return simulateCreateRecipient(input);
  return request<CreatedRecipient>("/transferrecipient", {
    method: "POST",
    body: {
      type: "nuban",
      name: input.name,
      account_number: input.accountNumber,
      bank_code: input.bankCode,
      currency: input.currency,
    },
  });
};

// ── Transfers (payouts) ─────────────────────────────────────────────────────

export type TransferStatus = "pending" | "success" | "failed" | "reversed" | "otp" | "processing" | "received" | "queued" | "abandoned" | "blocked" | "rejected";

export type InitiatedTransfer = {
  status: TransferStatus;
  transfer_code: string;
  reference: string;
};

export const initiateTransfer = (input: {
  amount: number; // subunit
  recipient: string;
  reference: string;
  reason: string;
}): Promise<InitiatedTransfer> => {
  if (env.PAYSTACK_SIMULATE_PAYOUTS) return simulateInitiateTransfer(input);
  return request<InitiatedTransfer>("/transfer", {
    method: "POST",
    body: { source: "balance", amount: input.amount, recipient: input.recipient, reference: input.reference, reason: input.reason },
  });
};

export type VerifiedTransfer = {
  status: TransferStatus;
  reference: string;
  reason: string | null;
  transfer_code: string;
};

/** Returns null when Paystack has no transfer with this reference (it was never created). */
export const verifyTransfer = async (reference: string): Promise<VerifiedTransfer | null> => {
  if (env.PAYSTACK_SIMULATE_PAYOUTS) return simulateVerifyTransfer(reference);
  try {
    return await request<VerifiedTransfer>(`/transfer/verify/${encodeURIComponent(reference)}`);
  } catch (error) {
    if (error instanceof PaystackError && error.status === 404) return null;
    throw error;
  }
};
