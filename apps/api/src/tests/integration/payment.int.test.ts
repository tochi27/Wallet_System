import { createHmac } from "crypto";
import request from "supertest";
import app from "../../app";
import { enqueuePaystackEvent } from "../../queues/paystack.queue";
import {
  addBankAccount,
  BankAccountNotFoundError,
  getBanks,
  listBankAccounts,
  lookupAccount,
  removeBankAccount,
} from "../../services/payments/bank-account.service";
import { createDeposit, DepositNotFoundError, getDeposit } from "../../services/payments/deposit.service";
import { createWithdrawal, InsufficientFundsError, listWithdrawals } from "../../services/payments/withdrawal.service";
import { PaymentsNotConfiguredError, PaystackError } from "../../services/payments/paystack.client";
import { recordEvent } from "../../services/payments/paystack-webhook.service";

const SECRET = "sk_test_integration";

jest.mock("../../config/env", () => {
  const actual = jest.requireActual("../../config/env");
  return { env: { ...actual.env, PAYSTACK_SECRET_KEY: "sk_test_integration" } };
});

jest.mock("../../middleware/auth.middleware", () => ({
  authenticate: (req: any, res: any, next: any) => {
    if (!req.headers.authorization) return res.status(401).json({ success: false, message: "No token provided" });
    req.userId = "user123";
    next();
  },
}));

jest.mock("../../services/payments/deposit.service", () => ({
  ...jest.requireActual("../../services/payments/deposit.service"),
  createDeposit: jest.fn(),
  getDeposit: jest.fn(),
}));

jest.mock("../../services/payments/bank-account.service", () => ({
  ...jest.requireActual("../../services/payments/bank-account.service"),
  getBanks: jest.fn(),
  lookupAccount: jest.fn(),
  addBankAccount: jest.fn(),
  listBankAccounts: jest.fn(),
  removeBankAccount: jest.fn(),
}));

jest.mock("../../services/payments/withdrawal.service", () => ({
  ...jest.requireActual("../../services/payments/withdrawal.service"),
  createWithdrawal: jest.fn(),
  listWithdrawals: jest.fn(),
}));

jest.mock("../../services/payments/paystack-webhook.service", () => ({
  ...jest.requireActual("../../services/payments/paystack-webhook.service"),
  recordEvent: jest.fn(),
}));

jest.mock("../../queues/paystack.queue", () => ({ enqueuePaystackEvent: jest.fn() }));

const depositView = {
  reference: "dep_abc",
  amount: "5000.00",
  currency: "NGN",
  status: "PENDING",
  authorizationUrl: "https://checkout.paystack.com/abc",
  channel: null,
  paidAt: null,
  failureReason: null,
  transactionId: null,
  createdAt: "2026-10-09T10:00:00.000Z",
};

describe("Payments routes", () => {
  beforeEach(() => jest.clearAllMocks());

  // ---------- POST /deposits ----------
  describe("POST /api/payments/deposits", () => {
    it("starts a deposit and passes the idempotency key through", async () => {
      (createDeposit as jest.Mock).mockResolvedValue(depositView);

      const res = await request(app)
        .post("/api/payments/deposits")
        .set("Authorization", "Bearer token")
        .set("Idempotency-Key", "key-1")
        .send({ amount: 5000 });

      expect(res.status).toBe(200);
      expect(res.body.data.authorizationUrl).toBe("https://checkout.paystack.com/abc");
      expect(createDeposit).toHaveBeenCalledWith("user123", 5000, "key-1");
    });

    it.each([
      [{ amount: 50 }, "The minimum deposit is ₦100"],
      [{ amount: 100.555 }, "Amount can have at most 2 decimal places"],
      [{ amount: 20_000_000 }, "The maximum deposit is ₦10,000,000"],
      [{ amount: "5000" }, "Amount must be a number"],
    ])("rejects %j", async (body, message) => {
      const res = await request(app).post("/api/payments/deposits").set("Authorization", "Bearer token").send(body);

      expect(res.status).toBe(400);
      expect(res.body.message).toBe(message);
      expect(createDeposit).not.toHaveBeenCalled();
    });

    it("returns 503 when payments are not configured", async () => {
      (createDeposit as jest.Mock).mockRejectedValue(new PaymentsNotConfiguredError());

      const res = await request(app).post("/api/payments/deposits").set("Authorization", "Bearer token").send({ amount: 5000 });

      expect(res.status).toBe(503);
    });

    it("returns 502 with Paystack's message when Paystack rejects the request", async () => {
      (createDeposit as jest.Mock).mockRejectedValue(new PaystackError("Invalid key", 401));

      const res = await request(app).post("/api/payments/deposits").set("Authorization", "Bearer token").send({ amount: 5000 });

      expect(res.status).toBe(502);
      expect(res.body.message).toBe("Payment provider error: Invalid key");
    });

    it("requires authentication", async () => {
      const res = await request(app).post("/api/payments/deposits").send({ amount: 5000 });
      expect(res.status).toBe(401);
    });
  });

  // ---------- GET /deposits/:reference ----------
  describe("GET /api/payments/deposits/:reference", () => {
    it("returns the caller's deposit", async () => {
      (getDeposit as jest.Mock).mockResolvedValue({ ...depositView, status: "SUCCESSFUL" });

      const res = await request(app).get("/api/payments/deposits/dep_abc").set("Authorization", "Bearer token");

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe("SUCCESSFUL");
      expect(getDeposit).toHaveBeenCalledWith("user123", "dep_abc");
    });

    it("returns 404 for a deposit that is missing or belongs to someone else", async () => {
      (getDeposit as jest.Mock).mockRejectedValue(new DepositNotFoundError());

      const res = await request(app).get("/api/payments/deposits/dep_other").set("Authorization", "Bearer token");

      expect(res.status).toBe(404);
    });
  });

  // ---------- POST /paystack/webhook ----------
  describe("POST /api/payments/paystack/webhook", () => {
    const body = JSON.stringify({ event: "charge.success", data: { id: 42, reference: "dep_abc" } });
    const signature = createHmac("sha512", SECRET).update(body).digest("hex");

    const send = (sig?: string, payload = body) => {
      const req = request(app).post("/api/payments/paystack/webhook").set("Content-Type", "application/json");
      if (sig) req.set("x-paystack-signature", sig);
      return req.send(payload);
    };

    it("accepts a correctly signed event, records it and queues it", async () => {
      (recordEvent as jest.Mock).mockResolvedValue({ id: "evt-1", duplicate: false, processed: false });

      const res = await send(signature);

      expect(res.status).toBe(200);
      expect(recordEvent).toHaveBeenCalledWith({ event: "charge.success", data: { id: 42, reference: "dep_abc" } });
      expect(enqueuePaystackEvent).toHaveBeenCalledWith("evt-1");
    });

    it("acknowledges an already-processed redelivery without queuing it again", async () => {
      (recordEvent as jest.Mock).mockResolvedValue({ id: "evt-1", duplicate: true, processed: true });

      const res = await send(signature);

      expect(res.status).toBe(200);
      expect(enqueuePaystackEvent).not.toHaveBeenCalled();
    });

    it("rejects a missing or wrong signature", async () => {
      expect((await send()).status).toBe(401);
      expect((await send("ab".repeat(64))).status).toBe(401);
      expect(recordEvent).not.toHaveBeenCalled();
    });

    it("rejects a body that was changed after signing", async () => {
      const res = await send(signature, body.replace("dep_abc", "dep_xyz"));

      expect(res.status).toBe(401);
    });

    it("returns 500 so Paystack retries when the event cannot be stored", async () => {
      (recordEvent as jest.Mock).mockRejectedValue(new Error("DB down"));

      const res = await send(signature);

      expect(res.status).toBe(500);
    });
  });

  // ---------- Banks and bank accounts ----------
  describe("bank accounts", () => {
    const auth = { Authorization: "Bearer token" };

    it("lists banks", async () => {
      (getBanks as jest.Mock).mockResolvedValue([{ name: "Zenith Bank", code: "057" }]);

      const res = await request(app).get("/api/payments/banks").set(auth);

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([{ name: "Zenith Bank", code: "057" }]);
    });

    it.each([
      [{ bankCode: "057", accountNumber: "12345" }, "Account numbers are 10 digits"],
      [{ bankCode: "", accountNumber: "0123456789" }, "Choose a bank"],
    ])("validates %j before looking it up", async (body, message) => {
      const res = await request(app).post("/api/payments/bank-accounts/resolve").set(auth).send(body);

      expect(res.status).toBe(400);
      expect(res.body.message).toBe(message);
      expect(lookupAccount).not.toHaveBeenCalled();
    });

    it("resolves the account name", async () => {
      (lookupAccount as jest.Mock).mockResolvedValue({ accountName: "ADA LOVELACE", bankName: "Zenith Bank" });

      const res = await request(app)
        .post("/api/payments/bank-accounts/resolve")
        .set(auth)
        .send({ bankCode: "057", accountNumber: "0123456789" });

      expect(res.status).toBe(200);
      expect(res.body.data.accountName).toBe("ADA LOVELACE");
    });

    it("turns a failed Paystack lookup into a clear 400", async () => {
      (lookupAccount as jest.Mock).mockRejectedValue(new PaystackError("Could not resolve account name", 422));

      const res = await request(app)
        .post("/api/payments/bank-accounts/resolve")
        .set(auth)
        .send({ bankCode: "057", accountNumber: "0123456789" });

      expect(res.status).toBe(400);
      expect(res.body.message).toBe("We couldn't find that account. Check the account number and bank.");
    });

    it("explains the Paystack lookup limit in plain words, pointing to the test bank in test mode", async () => {
      (lookupAccount as jest.Mock).mockRejectedValue(
        new PaystackError("Test mode daily limit of 3 live bank resolves exceeded. Use test bank codes 001 or upgrade to live mode.", 429)
      );

      const res = await request(app)
        .post("/api/payments/bank-accounts/resolve")
        .set(auth)
        .send({ bankCode: "057", accountNumber: "0123456789" });

      expect(res.status).toBe(429);
      expect(res.body.message).toMatch(/Paystack Test Bank/);
      expect(res.body.message).not.toMatch(/upgrade to live mode/);
    });

    it("saves, lists and removes accounts", async () => {
      (addBankAccount as jest.Mock).mockResolvedValue({ id: "acct-1" });
      (listBankAccounts as jest.Mock).mockResolvedValue([{ id: "acct-1" }]);
      (removeBankAccount as jest.Mock).mockResolvedValue(undefined);

      const saved = await request(app)
        .post("/api/payments/bank-accounts")
        .set(auth)
        .send({ bankCode: "057", accountNumber: "0123456789" });
      const listed = await request(app).get("/api/payments/bank-accounts").set(auth);
      const removed = await request(app).delete("/api/payments/bank-accounts/acct-1").set(auth);

      expect(saved.status).toBe(200);
      expect(addBankAccount).toHaveBeenCalledWith("user123", "057", "0123456789");
      expect(listed.body.data).toEqual([{ id: "acct-1" }]);
      expect(removed.status).toBe(200);
      expect(removeBankAccount).toHaveBeenCalledWith("user123", "acct-1");
    });

    it("returns 404 when removing an account the caller does not own", async () => {
      (removeBankAccount as jest.Mock).mockRejectedValue(new BankAccountNotFoundError());

      const res = await request(app).delete("/api/payments/bank-accounts/not-mine").set(auth);

      expect(res.status).toBe(404);
    });
  });

  // ---------- Withdrawals ----------
  describe("withdrawals", () => {
    const auth = { Authorization: "Bearer token" };
    const accountId = "7c9e6679-7425-40de-944b-e07fc1f90ae7";

    it("starts a withdrawal with the idempotency key", async () => {
      (createWithdrawal as jest.Mock).mockResolvedValue({ reference: "wd_1", status: "PROCESSING" });

      const res = await request(app)
        .post("/api/payments/withdrawals")
        .set(auth)
        .set("Idempotency-Key", "key-9")
        .send({ bankAccountId: accountId, amount: 2500 });

      expect(res.status).toBe(200);
      expect(createWithdrawal).toHaveBeenCalledWith("user123", accountId, 2500, "key-9");
    });

    it.each([
      [{ bankAccountId: "not-a-uuid", amount: 2500 }, "Choose a bank account"],
      [{ bankAccountId: accountId, amount: 50 }, "The minimum withdrawal is ₦100"],
      [{ bankAccountId: accountId, amount: 6_000_000 }, "The maximum withdrawal is ₦5,000,000"],
    ])("rejects %j", async (body, message) => {
      const res = await request(app).post("/api/payments/withdrawals").set(auth).send(body);

      expect(res.status).toBe(400);
      expect(res.body.message).toBe(message);
    });

    it("returns 400 for insufficient funds", async () => {
      (createWithdrawal as jest.Mock).mockRejectedValue(new InsufficientFundsError());

      const res = await request(app)
        .post("/api/payments/withdrawals")
        .set(auth)
        .send({ bankAccountId: accountId, amount: 2500 });

      expect(res.status).toBe(400);
      expect(res.body.message).toBe("Insufficient funds");
    });

    it("lists the caller's withdrawals", async () => {
      (listWithdrawals as jest.Mock).mockResolvedValue([{ reference: "wd_1" }]);

      const res = await request(app).get("/api/payments/withdrawals").set(auth);

      expect(res.status).toBe(200);
      expect(listWithdrawals).toHaveBeenCalledWith("user123");
    });
  });
});
