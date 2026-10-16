import request from "supertest";
import app from "../../app";
import {
  changePassword,
  PasswordError,
  requestPasswordReset,
  resetPassword,
} from "../../services/security/password.service";
import { revokeToken } from "../../utils/tokenBlacklist.utils";

jest.mock("../../middleware/auth.middleware", () => ({
  authenticate: (req: any, res: any, next: any) => {
    if (!req.headers.authorization) return res.status(401).json({ success: false, message: "No token provided" });
    req.userId = "user123";
    req.token = "old-token";
    next();
  },
}));
jest.mock("../../services/security/password.service", () => ({
  ...jest.requireActual("../../services/security/password.service"),
  requestPasswordReset: jest.fn(),
  resetPassword: jest.fn(),
  changePassword: jest.fn(),
}));
jest.mock("../../utils/tokenBlacklist.utils", () => ({
  isBlacklisted: jest.fn().mockResolvedValue(false),
  addToBlacklistWithExpiry: jest.fn(),
  revokeToken: jest.fn(),
}));

const GENERIC = "If an account exists for that email, we've sent a link to reset the password.";
const invalidLink = new PasswordError("This reset link is invalid or has expired. Request a new one.", 400, "RESET_INVALID");

describe("Forgot, reset and change password", () => {
  beforeEach(() => jest.clearAllMocks());

  describe("POST /api/auth/forgot-password", () => {
    const forgot = (email: unknown) => request(app).post("/api/auth/forgot-password").send({ email });

    it("answers identically whether or not the email has an account", async () => {
      (requestPasswordReset as jest.Mock).mockResolvedValueOnce("sent").mockResolvedValueOnce("no_account");

      const known = await forgot("ada@example.com");
      const unknown = await forgot("nobody@example.com");

      expect(known.status).toBe(200);
      expect(unknown.status).toBe(200);
      expect(known.body).toEqual(unknown.body);
      expect(known.body.message).toBe(GENERIC);
      expect(requestPasswordReset).toHaveBeenCalledWith("ada@example.com");
    });

    it("gives the same answer during the cooldown or if the email can't be queued", async () => {
      (requestPasswordReset as jest.Mock).mockResolvedValueOnce("cooldown").mockRejectedValueOnce(new Error("Redis down"));

      const cooling = await forgot("ada@example.com");
      const failed = await forgot("ada@example.com");

      expect(cooling.body.message).toBe(GENERIC);
      expect(failed.status).toBe(200);
      expect(failed.body.message).toBe(GENERIC);
    });

    it("rejects an invalid email", async () => {
      const res = await forgot("not-an-email");

      expect(res.status).toBe(400);
      expect(requestPasswordReset).not.toHaveBeenCalled();
    });
  });

  describe("POST /api/auth/reset-password", () => {
    const reset = (body: object) => request(app).post("/api/auth/reset-password").send(body);

    it("resets the password", async () => {
      const res = await reset({ token: "raw-token", password: "new-password" });

      expect(res.status).toBe(200);
      expect(resetPassword).toHaveBeenCalledWith("raw-token", "new-password");
    });

    it("explains an invalid or expired link with 400, never 401", async () => {
      (resetPassword as jest.Mock).mockRejectedValue(invalidLink);

      const res = await reset({ token: "used-token", password: "new-password" });

      expect(res.status).toBe(400);
      expect(res.body.message).toBe("This reset link is invalid or has expired. Request a new one.");
    });

    it.each([
      [{ token: "raw-token", password: "short" }, "Password must be at least 8 characters"],
      [{ token: "raw-token" }, "Password must be at least 8 characters"],
      [{ password: "new-password" }, "This reset link is invalid or has expired. Request a new one."],
    ])("rejects %j", async (body, message) => {
      const res = await reset(body);

      expect(res.status).toBe(400);
      expect(res.body.message).toBe(message);
      expect(resetPassword).not.toHaveBeenCalled();
    });
  });

  describe("PUT /api/account/password", () => {
    const change = (body: object) =>
      request(app).put("/api/account/password").set({ Authorization: "Bearer old-token" }).send(body);

    it("changes the password, revokes this token and returns a fresh one", async () => {
      const res = await change({ currentPassword: "old-password", newPassword: "new-password" });

      expect(res.status).toBe(200);
      expect(changePassword).toHaveBeenCalledWith("user123", "old-password", "new-password");
      expect(revokeToken).toHaveBeenCalledWith("old-token");
      expect(typeof res.body.data.token).toBe("string");
      expect(res.body.data.token).not.toBe("old-token");
    });

    it("returns 400 for a wrong current password so the user stays signed in", async () => {
      (changePassword as jest.Mock).mockRejectedValue(
        new PasswordError("Your current password is incorrect", 400, "PASSWORD_INCORRECT")
      );

      const res = await change({ currentPassword: "wrong", newPassword: "new-password" });

      expect(res.status).toBe(400);
      expect(res.body.message).toBe("Your current password is incorrect");
      expect(revokeToken).not.toHaveBeenCalled();
    });

    it.each([
      [{ newPassword: "new-password" }, "Enter your current password"],
      [{ currentPassword: "old-password", newPassword: "short" }, "Password must be at least 8 characters"],
    ])("rejects %j", async (body, message) => {
      const res = await change(body);

      expect(res.status).toBe(400);
      expect(res.body.message).toBe(message);
      expect(changePassword).not.toHaveBeenCalled();
    });

    it("requires a signed-in user", async () => {
      const res = await request(app).put("/api/account/password").send({ currentPassword: "a", newPassword: "new-password" });

      expect(res.status).toBe(401);
    });
  });
});
