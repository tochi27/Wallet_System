import request from "supertest";
import app from "../../app";
import { findUserByEmail, registerUser } from "../../services/auth.service";
import {
  resendVerification,
  sendVerificationEmail,
  VerificationError,
  verifyEmail,
} from "../../services/security/verification.service";
import { transferFunds } from "../../services/transfer.service";

// Tests choose whether the caller has verified their email with a header
jest.mock("../../middleware/auth.middleware", () => ({
  authenticate: (req: any, res: any, next: any) => {
    if (!req.headers.authorization) return res.status(401).json({ success: false, message: "No token provided" });
    req.userId = "user123";
    req.emailVerified = req.headers["x-test-verified"] === "true";
    next();
  },
}));
jest.mock("../../services/auth.service", () => ({
  ...jest.requireActual("../../services/auth.service"),
  findUserByEmail: jest.fn(),
  registerUser: jest.fn(),
}));
jest.mock("../../services/security/verification.service", () => ({
  ...jest.requireActual("../../services/security/verification.service"),
  sendVerificationEmail: jest.fn(),
  resendVerification: jest.fn(),
  verifyEmail: jest.fn(),
}));
jest.mock("../../services/transfer.service.ts");
jest.mock("../../services/wallet.service.ts");

const UNVERIFIED = /verify your email/i;

describe("Email verification", () => {
  beforeEach(() => jest.clearAllMocks());

  describe("POST /api/auth/signup", () => {
    const signup = () =>
      request(app).post("/api/auth/signup").send({ name: "Ada Lovelace", email: "ada@example.com", password: "password123" });

    beforeEach(() => {
      (findUserByEmail as jest.Mock).mockResolvedValue(null);
      (registerUser as jest.Mock).mockResolvedValue({ id: "u1", name: "Ada Lovelace", email: "ada@example.com" });
      (sendVerificationEmail as jest.Mock).mockResolvedValue(undefined);
    });

    it("emails a verification link to the new user", async () => {
      const res = await signup();
      expect(res.status).toBe(200);
      expect(sendVerificationEmail).toHaveBeenCalledWith(expect.objectContaining({ id: "u1", email: "ada@example.com" }));
    });

    it("still signs the user up if the email can't be sent", async () => {
      (sendVerificationEmail as jest.Mock).mockRejectedValue(new Error("Redis down"));
      const res = await signup();
      expect(res.status).toBe(200);
      expect(res.body.data.user.id).toBe("u1");
    });
  });

  describe("POST /api/auth/verify-email", () => {
    const verify = (token: unknown) => request(app).post("/api/auth/verify-email").send({ token });

    it("verifies without needing to be signed in", async () => {
      (verifyEmail as jest.Mock).mockResolvedValue("verified");
      const res = await verify("the-token");
      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe("verified");
      expect(verifyEmail).toHaveBeenCalledWith("the-token");
    });

    it("says so when the email was already verified", async () => {
      (verifyEmail as jest.Mock).mockResolvedValue("already_verified");
      const res = await verify("the-token");
      expect(res.status).toBe(200);
      expect(res.body.message).toMatch(/already verified/i);
    });

    it("rejects a bad link with 400, never 401", async () => {
      (verifyEmail as jest.Mock).mockRejectedValue(
        new VerificationError("This verification link is invalid or has expired. Send yourself a new one.", 400, "VERIFY_INVALID")
      );
      const res = await verify("bad");
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/invalid or has expired/);
    });

    it("rejects a missing token without calling the service", async () => {
      const res = await verify(undefined);
      expect(res.status).toBe(400);
      expect(verifyEmail).not.toHaveBeenCalled();
    });
  });

  describe("POST /api/auth/resend-verification", () => {
    const resend = () => request(app).post("/api/auth/resend-verification").set("Authorization", "Bearer t");

    it("needs a signed-in user", async () => {
      const res = await request(app).post("/api/auth/resend-verification");
      expect(res.status).toBe(401);
    });

    it("sends a new link to the signed-in user", async () => {
      (resendVerification as jest.Mock).mockResolvedValue({ email: "ada@example.com" });
      const res = await resend();
      expect(res.status).toBe(200);
      expect(res.body.message).toContain("ada@example.com");
      expect(resendVerification).toHaveBeenCalledWith("user123");
    });

    it("passes on the cooldown as 429", async () => {
      (resendVerification as jest.Mock).mockRejectedValue(
        new VerificationError("We've just sent you a link. You can ask for another in 42 seconds.", 429, "RESEND_COOLDOWN")
      );
      const res = await resend();
      expect(res.status).toBe(429);
      expect(res.body.message).toContain("42 seconds");
    });
  });

  describe("money routes before verifying", () => {
    const routes: [string, Record<string, unknown>][] = [
      ["/api/wallet/transfer", { recipientEmail: "bob@example.com", amount: 100 }],
      ["/api/wallet/credit", { amount: 100 }],
      ["/api/wallet/debit", { amount: 100 }],
      ["/api/payments/deposits", { amount: 1000 }],
      ["/api/payments/withdrawals", { amount: 1000, bankAccountId: "b1" }],
      ["/api/payments/bank-accounts", { bankCode: "058", accountNumber: "0123456789" }],
      ["/api/payments/bank-accounts/resolve", { bankCode: "058", accountNumber: "0123456789" }],
    ];

    it.each(routes)("%s is blocked with 403 (never 401) until the email is verified", async (path, body) => {
      const res = await request(app).post(path).set("Authorization", "Bearer t").send(body);
      expect(res.status).toBe(403);
      expect(res.body.message).toMatch(UNVERIFIED);
      expect(transferFunds).not.toHaveBeenCalled();
    });

    it("lets a verified user past the check", async () => {
      const res = await request(app)
        .post("/api/wallet/transfer")
        .set("Authorization", "Bearer t")
        .set("x-test-verified", "true")
        .send({ recipientEmail: "bob@example.com", amount: 100 });
      expect(res.status).not.toBe(403);
    });

    it("still lets an unverified user see their wallet", async () => {
      const res = await request(app).get("/api/wallet/transactions").set("Authorization", "Bearer t");
      expect(res.status).not.toBe(403);
    });
  });
});
