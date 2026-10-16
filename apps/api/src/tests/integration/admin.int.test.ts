import request from "supertest";
import app from "../../app";
import { ACCOUNT_FROZEN_MESSAGE } from "../../middleware/frozen.middleware";
import {
  AdminActionError,
  freezeUser,
  getOverview,
  getUserDetail,
  listDeposits,
  recheckWithdrawal,
  unlockPin,
} from "../../services/admin/admin.service";
import { verifyPin } from "../../services/security/pin.service";
import { transferFunds } from "../../services/transfer.service";
import { validateAmount } from "../../utils/validateAmount.utils";

// Tests choose the caller's role and frozen state with headers
jest.mock("../../middleware/auth.middleware", () => ({
  authenticate: (req: any, res: any, next: any) => {
    if (!req.headers.authorization) return res.status(401).json({ success: false, message: "No token provided" });
    req.userId = "caller";
    req.userRole = req.headers["x-test-role"] ?? "USER";
    req.accountFrozen = req.headers["x-test-frozen"] === "true";
    req.emailVerified = true;
    next();
  },
}));
jest.mock("../../services/admin/admin.service", () => ({
  ...jest.requireActual("../../services/admin/admin.service"),
  getOverview: jest.fn(),
  getUserDetail: jest.fn(),
  freezeUser: jest.fn(),
  unlockPin: jest.fn(),
  listDeposits: jest.fn(),
  recheckWithdrawal: jest.fn(),
}));
jest.mock("../../services/security/pin.service", () => ({
  ...jest.requireActual("../../services/security/pin.service"),
  verifyPin: jest.fn(),
}));
jest.mock("../../services/transfer.service.ts");
jest.mock("../../utils/validateAmount.utils.ts");

const admin = { Authorization: "Bearer token", "x-test-role": "OWNER" };
const user = { Authorization: "Bearer token" };

describe("Admin API", () => {
  beforeEach(() => jest.clearAllMocks());

  describe("access", () => {
    it("requires a signed-in user", async () => {
      expect((await request(app).get("/api/admin/overview")).status).toBe(401);
    });

    it.each([
      ["get", "/api/admin/overview"],
      ["get", "/api/admin/users"],
      ["post", "/api/admin/users/u2/freeze"],
      ["get", "/api/admin/reconciliation"],
      ["get", "/api/admin/audit-log"],
    ] as const)("refuses %s %s to non-admins with 403", async (method, path) => {
      const res = await request(app)[method](path).set(user).send({ reason: "testing" });

      expect(res.status).toBe(403);
      expect(res.body.message).toBe("Admins only");
      expect(freezeUser).not.toHaveBeenCalled();
    });

    it("serves admins", async () => {
      (getOverview as jest.Mock).mockResolvedValue({ users: { total: 3 } });

      const res = await request(app).get("/api/admin/overview").set(admin);

      expect(res.status).toBe(200);
      expect(res.body.data.users.total).toBe(3);
    });
  });

  describe("user actions", () => {
    it("freezes with the admin's id and the reason, then returns the updated user", async () => {
      (getUserDetail as jest.Mock).mockResolvedValue({ id: "u2", frozenAt: "2026-10-12T10:00:00.000Z" });

      const res = await request(app).post("/api/admin/users/u2/freeze").set(admin).send({ reason: "  Chargeback investigation " });

      expect(res.status).toBe(200);
      expect(freezeUser).toHaveBeenCalledWith("caller", "u2", "Chargeback investigation");
      expect(res.body.data.id).toBe("u2");
    });

    it.each([[{}], [{ reason: "  " }], [{ reason: "ok" }]])("requires a reason (%j)", async (body) => {
      const res = await request(app).post("/api/admin/users/u2/unlock-pin").set(admin).send(body);

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/Give a reason/);
      expect(unlockPin).not.toHaveBeenCalled();
    });

    it("passes service errors through with their status", async () => {
      (freezeUser as jest.Mock).mockRejectedValue(new AdminActionError("You can't freeze your own account", 400));

      const res = await request(app).post("/api/admin/users/caller/freeze").set(admin).send({ reason: "testing" });

      expect(res.status).toBe(400);
      expect(res.body.message).toBe("You can't freeze your own account");
    });
  });

  describe("payments", () => {
    it("parses list filters from the query string", async () => {
      (listDeposits as jest.Mock).mockResolvedValue({ items: [], nextCursor: null });

      const res = await request(app).get("/api/admin/deposits?stuck=true&limit=10").set(admin);

      expect(res.status).toBe(200);
      expect(listDeposits).toHaveBeenCalledWith(expect.objectContaining({ stuck: true, limit: 10 }));
    });

    it("rejects an unknown status", async () => {
      const res = await request(app).get("/api/admin/deposits?status=LOST").set(admin);

      expect(res.status).toBe(400);
      expect(listDeposits).not.toHaveBeenCalled();
    });

    it("rechecks a withdrawal", async () => {
      (recheckWithdrawal as jest.Mock).mockResolvedValue({ reference: "wd_1", before: "PROCESSING", after: "FAILED" });

      const res = await request(app).post("/api/admin/withdrawals/wd_1/recheck").set(admin);

      expect(res.status).toBe(200);
      expect(recheckWithdrawal).toHaveBeenCalledWith("caller", "wd_1");
      expect(res.body.data.after).toBe("FAILED");
    });
  });

  describe("frozen accounts", () => {
    const frozen = { ...user, "x-test-frozen": "true" };

    it("can't send money (403, never 401)", async () => {
      (validateAmount as jest.Mock).mockReturnValue(100);

      const res = await request(app)
        .post("/api/wallet/transfer")
        .set(frozen)
        .send({ receiverEmail: "grace@example.com", amount: 100, pin: "1357" });

      expect(res.status).toBe(403);
      expect(res.body.message).toBe(ACCOUNT_FROZEN_MESSAGE);
      expect(verifyPin).not.toHaveBeenCalled();
      expect(transferFunds).not.toHaveBeenCalled();
    });

    it.each([
      ["/api/payments/withdrawals", { bankAccountId: "b1", amount: 1000, pin: "1357" }],
      ["/api/payments/bank-accounts", { bankCode: "057", accountNumber: "0123456789" }],
    ])("can't use %s", async (path, body) => {
      const res = await request(app).post(path).set(frozen).send(body);

      expect(res.status).toBe(403);
      expect(res.body.message).toBe(ACCOUNT_FROZEN_MESSAGE);
    });
  });
});
