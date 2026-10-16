import request from "supertest";
import app from "../../app";
import { AdminActionError, getUserDetail, setUserTier } from "../../services/admin/admin.service";
import { getLimits, LimitError } from "../../services/limits.service";
import { createDeposit } from "../../services/payments/deposit.service";
import { verifyPin } from "../../services/security/pin.service";
import { transferFunds } from "../../services/transfer.service";

// Tests choose the caller's role with a header
jest.mock("../../middleware/auth.middleware", () => ({
  authenticate: (req: any, res: any, next: any) => {
    if (!req.headers.authorization) return res.status(401).json({ success: false, message: "No token provided" });
    req.userId = "caller";
    req.userRole = req.headers["x-test-role"] ?? "USER";
    req.emailVerified = true;
    next();
  },
}));
jest.mock("../../services/limits.service", () => ({
  ...jest.requireActual("../../services/limits.service"),
  getLimits: jest.fn(),
}));
jest.mock("../../services/admin/admin.service", () => ({
  ...jest.requireActual("../../services/admin/admin.service"),
  setUserTier: jest.fn(),
  getUserDetail: jest.fn(),
}));
jest.mock("../../services/payments/deposit.service", () => ({
  ...jest.requireActual("../../services/payments/deposit.service"),
  createDeposit: jest.fn(),
}));
jest.mock("../../services/payments/paystack.client", () => ({
  ...jest.requireActual("../../services/payments/paystack.client"),
  isPaystackConfigured: () => true,
}));
jest.mock("../../services/security/pin.service", () => ({
  ...jest.requireActual("../../services/security/pin.service"),
  verifyPin: jest.fn(),
}));
jest.mock("../../services/transfer.service.ts");

const user = { Authorization: "Bearer token" };
const owner = { ...user, "x-test-role": "OWNER" };

describe("Account limits and tiers", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (verifyPin as jest.Mock).mockResolvedValue(undefined);
  });

  describe("GET /api/account/limits", () => {
    it("returns the signed-in user's limits", async () => {
      (getLimits as jest.Mock).mockResolvedValue({ tier: "TIER_1", perTransaction: "50000.00" });

      const res = await request(app).get("/api/account/limits").set(user);

      expect(res.status).toBe(200);
      expect(res.body.data.tier).toBe("TIER_1");
      expect(getLimits).toHaveBeenCalledWith("caller");
    });
  });

  describe("payments over the limits", () => {
    it("refuses a transfer over the daily limit with 400 and the amount left", async () => {
      (transferFunds as jest.Mock).mockRejectedValue(
        new LimitError("This is over your daily limit of ₦200,000.00. You can send or withdraw up to ₦30,000.00 more today.", "DAILY", 30_000)
      );

      const res = await request(app)
        .post("/api/wallet/transfer")
        .set(user)
        .send({ receiverEmail: "bob@example.com", amount: 40_000, pin: "1234" });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain("₦30,000.00 more today");
    });

    it("refuses adding money past the balance cap with 400", async () => {
      (createDeposit as jest.Mock).mockRejectedValue(
        new LimitError("Your wallet can hold up to ₦500,000.00. You can add up to ₦20,000.00 more.", "BALANCE_CAP", 20_000)
      );

      const res = await request(app).post("/api/payments/deposits").set(user).send({ amount: 50_000 });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain("₦20,000.00 more");
    });
  });

  describe("POST /api/admin/users/:id/tier", () => {
    it("is for staff who can manage users", async () => {
      const res = await request(app).post("/api/admin/users/u2/tier").set(user).send({ tier: "TIER_2", reason: "ID checked" });
      expect(res.status).toBe(403);
      expect(setUserTier).not.toHaveBeenCalled();
    });

    it("changes the tier with the admin's id and reason, then returns the user", async () => {
      (getUserDetail as jest.Mock).mockResolvedValue({ id: "u2", tier: "TIER_2" });

      const res = await request(app).post("/api/admin/users/u2/tier").set(owner).send({ tier: "TIER_2", reason: " ID checked on a call " });

      expect(res.status).toBe(200);
      expect(setUserTier).toHaveBeenCalledWith("caller", "u2", "TIER_2", "ID checked on a call");
      expect(res.body.data.tier).toBe("TIER_2");
    });

    it("needs a valid tier and a reason", async () => {
      const bad = await request(app).post("/api/admin/users/u2/tier").set(owner).send({ tier: "TIER_9", reason: "x" });
      expect(bad.status).toBe(400);
      expect(setUserTier).not.toHaveBeenCalled();
    });

    it("passes on the service's refusal", async () => {
      (setUserTier as jest.Mock).mockRejectedValue(new AdminActionError("This account is already on Tier 2", 409));
      const res = await request(app).post("/api/admin/users/u2/tier").set(owner).send({ tier: "TIER_2", reason: "ID checked" });
      expect(res.status).toBe(409);
    });
  });
});
