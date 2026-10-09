import { BankAccount } from "@prisma/client";
import prisma from "../../config/db";
import { env } from "../../config/env";
import redisClient from "../redis.service";
import { createTransferRecipient, listBanks, PaystackError, resolveAccount } from "./paystack.client";

const CURRENCY = "NGN";
const BANKS_CACHE_KEY = `paystack:banks:${CURRENCY}`;
const BANKS_TTL_SECONDS = 24 * 60 * 60;
export const MAX_BANK_ACCOUNTS = 5;

// Paystack's test mode resolves any account number at this code (as "TEST ACCOUNT …") without
// using up the 3-per-day limit on real lookups, but it isn't in the bank list
const TEST_BANK = { name: "Paystack Test Bank", code: "001" };

export class BankAccountNotFoundError extends Error {
  constructor() {
    super("Bank account not found");
    this.name = "BankAccountNotFoundError";
  }
}

export class BankAccountLimitError extends Error {
  constructor() {
    super(`You can save up to ${MAX_BANK_ACCOUNTS} bank accounts`);
    this.name = "BankAccountLimitError";
  }
}

// The account exists (the lookup worked) but Paystack won't accept it as a payout destination
export class RecipientRejectedError extends Error {
  constructor() {
    super("This account can't receive withdrawals. Try a different account.");
    this.name = "RecipientRejectedError";
  }
}

export type Bank = { name: string; code: string };

export type BankAccountView = {
  id: string;
  bankCode: string;
  bankName: string;
  accountNumberLast4: string;
  accountName: string;
  createdAt: Date;
};

export const toBankAccountView = (account: BankAccount): BankAccountView => ({
  id: account.id,
  bankCode: account.bankCode,
  bankName: account.bankName,
  accountNumberLast4: account.accountNumberLast4,
  accountName: account.accountName,
  createdAt: account.createdAt,
});

export const isTestMode = () => env.PAYSTACK_SECRET_KEY?.startsWith("sk_test_") ?? false;

/** Banks that can receive transfers, cached for a day (the list rarely changes). */
export const getBanks = async (): Promise<Bank[]> => {
  const cached = await redisClient.get(BANKS_CACHE_KEY);
  let banks: Bank[];
  if (cached) {
    banks = JSON.parse(cached) as Bank[];
  } else {
    const all = await listBanks(CURRENCY);
    banks = all
      .filter((bank) => bank.active && bank.supports_transfer && !bank.is_deleted)
      .map((bank) => ({ name: bank.name, code: bank.code }))
      .sort((a, b) => a.name.localeCompare(b.name));
    await redisClient.set(BANKS_CACHE_KEY, JSON.stringify(banks), "EX", BANKS_TTL_SECONDS);
  }
  return isTestMode() ? [TEST_BANK, ...banks] : banks;
};

const bankName = async (bankCode: string) => {
  const bank = (await getBanks()).find((b) => b.code === bankCode);
  if (!bank) throw new Error("Unknown bank");
  return bank.name;
};

/** Looks up the name on an account, so the user can confirm it before saving. */
export const lookupAccount = async (bankCode: string, accountNumber: string) => {
  const name = await bankName(bankCode);
  const resolved = await resolveAccount(accountNumber, bankCode);
  return { bankCode, bankName: name, accountNumber: resolved.account_number, accountName: resolved.account_name };
};

/**
 * Saves a payout account. The account is looked up again here — the name shown to the user
 * earlier is never trusted from the client — then registered with Paystack as a recipient.
 */
export const addBankAccount = async (
  userId: string,
  bankCode: string,
  accountNumber: string
): Promise<BankAccountView> => {
  const activeCount = await prisma.bankAccount.count({ where: { userId, isActive: true } });
  if (activeCount >= MAX_BANK_ACCOUNTS) throw new BankAccountLimitError();

  const account = await lookupAccount(bankCode, accountNumber);
  let recipient;
  try {
    recipient = await createTransferRecipient({
      name: account.accountName,
      accountNumber: account.accountNumber,
      bankCode,
      currency: CURRENCY,
    });
  } catch (error) {
    // e.g. Paystack's test bank (001) resolves names but can't be a payout recipient
    if (error instanceof PaystackError && error.status >= 400 && error.status < 500) throw new RecipientRejectedError();
    throw error;
  }

  // Paystack returns the same recipient for the same account, so re-adding a removed account
  // brings the old record back instead of duplicating it
  const saved = await prisma.bankAccount.upsert({
    where: { userId_recipientCode: { userId, recipientCode: recipient.recipient_code } },
    update: { isActive: true, accountName: account.accountName, bankName: account.bankName },
    create: {
      userId,
      bankCode,
      bankName: account.bankName,
      accountNumberLast4: account.accountNumber.slice(-4),
      accountName: account.accountName,
      recipientCode: recipient.recipient_code,
    },
  });
  return toBankAccountView(saved);
};

export const listBankAccounts = async (userId: string): Promise<BankAccountView[]> => {
  const accounts = await prisma.bankAccount.findMany({
    where: { userId, isActive: true },
    orderBy: { createdAt: "asc" },
  });
  return accounts.map(toBankAccountView);
};

/** Hides an account from the user. The record stays, since past withdrawals point at it. */
export const removeBankAccount = async (userId: string, id: string): Promise<void> => {
  const result = await prisma.bankAccount.updateMany({
    where: { id, userId, isActive: true },
    data: { isActive: false },
  });
  if (result.count === 0) throw new BankAccountNotFoundError();
};

export const getActiveBankAccount = async (userId: string, id: string): Promise<BankAccount> => {
  const account = await prisma.bankAccount.findFirst({ where: { id, userId, isActive: true } });
  if (!account) throw new BankAccountNotFoundError();
  return account;
};
