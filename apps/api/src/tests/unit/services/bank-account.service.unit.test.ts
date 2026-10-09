import prisma from "../../../config/db";
import { env } from "../../../config/env";
import redisClient from "../../../services/redis.service";
import {
  createTransferRecipient,
  listBanks,
  PaystackError,
  resolveAccount,
} from "../../../services/payments/paystack.client";
import {
  addBankAccount,
  BankAccountLimitError,
  BankAccountNotFoundError,
  getBanks,
  RecipientRejectedError,
  removeBankAccount,
} from "../../../services/payments/bank-account.service";

jest.mock("../../../config/env", () => ({ env: { PAYSTACK_SECRET_KEY: "sk_live_x" } }));

jest.mock("../../../config/db", () => ({
  __esModule: true,
  default: {
    bankAccount: {
      count: jest.fn(),
      upsert: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      updateMany: jest.fn(),
    },
  },
}));

jest.mock("../../../services/redis.service", () => ({
  __esModule: true,
  default: { get: jest.fn(), set: jest.fn() },
}));

jest.mock("../../../services/payments/paystack.client", () => ({
  ...jest.requireActual("../../../services/payments/paystack.client"),
  listBanks: jest.fn(),
  resolveAccount: jest.fn(),
  createTransferRecipient: jest.fn(),
}));

const paystackBanks = [
  { name: "Zenith Bank", code: "057", active: true, supports_transfer: true, is_deleted: false },
  { name: "Access Bank", code: "044", active: true, supports_transfer: true, is_deleted: false },
  { name: "Old Bank", code: "999", active: false, supports_transfer: true, is_deleted: false },
  { name: "No Payouts MFB", code: "888", active: true, supports_transfer: false, is_deleted: false },
];

const setKey = (key: string) => {
  (env as { PAYSTACK_SECRET_KEY?: string }).PAYSTACK_SECRET_KEY = key;
};

describe("bank-account.service", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setKey("sk_live_x");
    (redisClient.get as jest.Mock).mockResolvedValue(null);
    (listBanks as jest.Mock).mockResolvedValue(paystackBanks);
  });

  describe("getBanks", () => {
    it("keeps only active banks that accept transfers, sorted, and caches them for a day", async () => {
      const banks = await getBanks();

      expect(banks).toEqual([
        { name: "Access Bank", code: "044" },
        { name: "Zenith Bank", code: "057" },
      ]);
      expect(redisClient.set).toHaveBeenCalledWith("paystack:banks:NGN", JSON.stringify(banks), "EX", 86400);
    });

    it("serves the cached list without calling Paystack", async () => {
      (redisClient.get as jest.Mock).mockResolvedValue(JSON.stringify([{ name: "Zenith Bank", code: "057" }]));

      await getBanks();

      expect(listBanks).not.toHaveBeenCalled();
    });

    it("offers Paystack's test bank first when using a test key", async () => {
      setKey("sk_test_x");

      const banks = await getBanks();

      expect(banks[0]).toEqual({ name: "Paystack Test Bank", code: "001" });
    });
  });

  describe("addBankAccount", () => {
    beforeEach(() => {
      (prisma.bankAccount.count as jest.Mock).mockResolvedValue(0);
      (resolveAccount as jest.Mock).mockResolvedValue({ account_number: "0123456789", account_name: "ADA LOVELACE" });
      (createTransferRecipient as jest.Mock).mockResolvedValue({ recipient_code: "RCP_1" });
      (prisma.bankAccount.upsert as jest.Mock).mockImplementation(({ create }) =>
        Promise.resolve({ id: "acct-1", createdAt: new Date(), isActive: true, ...create })
      );
    });

    it("looks the account up itself, registers the recipient, and keeps only the last 4 digits", async () => {
      const saved = await addBankAccount("user-1", "057", "0123456789");

      expect(resolveAccount).toHaveBeenCalledWith("0123456789", "057");
      expect(createTransferRecipient).toHaveBeenCalledWith({
        name: "ADA LOVELACE",
        accountNumber: "0123456789",
        bankCode: "057",
        currency: "NGN",
      });
      const { create } = (prisma.bankAccount.upsert as jest.Mock).mock.calls[0][0];
      expect(create).toEqual({
        userId: "user-1",
        bankCode: "057",
        bankName: "Zenith Bank",
        accountNumberLast4: "6789",
        accountName: "ADA LOVELACE",
        recipientCode: "RCP_1",
      });
      expect(JSON.stringify(saved)).not.toContain("0123456789");
      expect(saved).not.toHaveProperty("recipientCode");
    });

    it("re-activates a previously removed account instead of duplicating it", async () => {
      await addBankAccount("user-1", "057", "0123456789");

      expect(prisma.bankAccount.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId_recipientCode: { userId: "user-1", recipientCode: "RCP_1" } },
          update: expect.objectContaining({ isActive: true }),
        })
      );
    });

    it("limits how many accounts a user can save", async () => {
      (prisma.bankAccount.count as jest.Mock).mockResolvedValue(5);

      await expect(addBankAccount("user-1", "057", "0123456789")).rejects.toBeInstanceOf(BankAccountLimitError);
      expect(resolveAccount).not.toHaveBeenCalled();
    });

    it("explains when Paystack accepts the lookup but refuses the account as a payout recipient", async () => {
      (createTransferRecipient as jest.Mock).mockRejectedValue(new PaystackError("Cannot resolve account", 400));

      await expect(addBankAccount("user-1", "057", "0123456789")).rejects.toBeInstanceOf(RecipientRejectedError);
      expect(prisma.bankAccount.upsert).not.toHaveBeenCalled();
    });

    it("rejects a bank that isn't in the list", async () => {
      await expect(addBankAccount("user-1", "123", "0123456789")).rejects.toThrow("Unknown bank");
    });
  });

  describe("removeBankAccount", () => {
    it("deactivates only the caller's own account", async () => {
      (prisma.bankAccount.updateMany as jest.Mock).mockResolvedValue({ count: 1 });

      await removeBankAccount("user-1", "acct-1");

      expect(prisma.bankAccount.updateMany).toHaveBeenCalledWith({
        where: { id: "acct-1", userId: "user-1", isActive: true },
        data: { isActive: false },
      });
    });

    it("reports a missing account", async () => {
      (prisma.bankAccount.updateMany as jest.Mock).mockResolvedValue({ count: 0 });

      await expect(removeBankAccount("user-1", "nope")).rejects.toBeInstanceOf(BankAccountNotFoundError);
    });
  });
});
