import bcrypt from "bcryptjs";
import prisma from "../../../config/db";
import redisClient from "../../../services/redis.service";
import { notify, queueEmail } from "../../../services/notifications/notification.service";
import {
  changePassword,
  hashResetToken,
  PasswordError,
  requestPasswordReset,
  resetPassword,
} from "../../../services/security/password.service";

const tx = {
  passwordResetToken: { updateMany: jest.fn(), deleteMany: jest.fn() },
  user: { update: jest.fn() },
};

jest.mock("../../../config/db", () => ({
  __esModule: true,
  default: {
    user: { findUnique: jest.fn(), findUniqueOrThrow: jest.fn(), update: jest.fn() },
    passwordResetToken: { findUnique: jest.fn(), create: jest.fn(), deleteMany: jest.fn() },
    $transaction: jest.fn(),
  },
}));
jest.mock("../../../services/redis.service", () => ({ __esModule: true, default: { set: jest.fn() } }));
jest.mock("../../../services/notifications/notification.service", () => ({
  notify: jest.fn(),
  queueEmail: jest.fn(),
}));
jest.mock("bcryptjs");

const expectPasswordError = async (promise: Promise<unknown>, status: number, code: string) => {
  const error = await promise.then(
    () => null,
    (err: unknown) => err
  );
  expect(error).toBeInstanceOf(PasswordError);
  expect(error).toMatchObject({ status, code });
};

describe("password.service", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (redisClient.set as jest.Mock).mockResolvedValue("OK");
    (bcrypt.hash as jest.Mock).mockResolvedValue("new-hash");
    (prisma.$transaction as jest.Mock).mockImplementation(async (arg: unknown) =>
      typeof arg === "function" ? arg(tx) : Promise.all(arg as Promise<unknown>[])
    );
    tx.passwordResetToken.updateMany.mockResolvedValue({ count: 1 });
  });

  describe("requestPasswordReset", () => {
    it("never resets a shared demo account's password", async () => {
      await expect(requestPasswordReset("demo@purplewallet.demo")).resolves.toBe("demo");
      expect(queueEmail).not.toHaveBeenCalled();
    });

    beforeEach(() => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: "u1", name: "Ada Lovelace", email: "ada@example.com" });
    });

    it("stores only a hash of the token and emails the link", async () => {
      await expect(requestPasswordReset("ada@example.com")).resolves.toBe("sent");

      const email = (queueEmail as jest.Mock).mock.calls[0][0];
      const token = /reset-password\?token=([A-Za-z0-9_-]+)/.exec(email.text)?.[1];
      expect(token).toHaveLength(43); // 32 random bytes, base64url
      expect(email.to).toBe("ada@example.com");
      expect(email.html).toContain(`/reset-password?token=${token}`);

      const stored = (prisma.passwordResetToken.create as jest.Mock).mock.calls[0][0].data;
      expect(stored.tokenHash).toBe(hashResetToken(token!));
      expect(JSON.stringify(stored)).not.toContain(token);
      expect(stored.expiresAt.getTime() - Date.now()).toBeGreaterThan(29 * 60_000);
      expect(stored.expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(30 * 60_000);
    });

    it("replaces earlier unused links", async () => {
      await requestPasswordReset("ada@example.com");

      expect(prisma.passwordResetToken.deleteMany).toHaveBeenCalledWith({ where: { userId: "u1", usedAt: null } });
    });

    it("never puts the link in an in-app notification", async () => {
      await requestPasswordReset("ada@example.com");

      expect(notify).not.toHaveBeenCalled();
    });

    it("sends nothing for an unknown email", async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(requestPasswordReset("nobody@example.com")).resolves.toBe("no_account");
      expect(prisma.passwordResetToken.create).not.toHaveBeenCalled();
      expect(queueEmail).not.toHaveBeenCalled();
    });

    it("sends at most one email per address every 2 minutes, keyed case-insensitively", async () => {
      (redisClient.set as jest.Mock).mockResolvedValue(null);

      await expect(requestPasswordReset("Ada@Example.com")).resolves.toBe("cooldown");

      expect(prisma.user.findUnique).not.toHaveBeenCalled();
      expect(queueEmail).not.toHaveBeenCalled();
      const [key, , , seconds, mode] = (redisClient.set as jest.Mock).mock.calls[0];
      expect(key).not.toContain("ada");
      expect(seconds).toBe(120);
      expect(mode).toBe("NX");

      await requestPasswordReset("ada@example.com");
      expect((redisClient.set as jest.Mock).mock.calls[1][0]).toBe(key);
    });
  });

  describe("resetPassword", () => {
    const validToken = (overrides: Record<string, unknown> = {}) => ({
      id: "t1",
      userId: "u1",
      usedAt: null,
      expiresAt: new Date(Date.now() + 10 * 60_000),
      ...overrides,
    });

    it("sets the new password, signs out every session and clears a PIN lockout", async () => {
      (prisma.passwordResetToken.findUnique as jest.Mock).mockResolvedValue(validToken());

      await resetPassword("raw-token", "new-password");

      expect(prisma.passwordResetToken.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { tokenHash: hashResetToken("raw-token") } })
      );
      const data = tx.user.update.mock.calls[0][0].data;
      expect(data).toMatchObject({ password: "new-hash", pinFailedAttempts: 0, pinLockedUntil: null });
      expect(data.passwordChangedAt).toBeInstanceOf(Date);
      expect(notify).toHaveBeenCalledWith(expect.objectContaining({ userId: "u1", type: "security.password_changed" }));
    });

    it("claims the token atomically so it works only once", async () => {
      (prisma.passwordResetToken.findUnique as jest.Mock).mockResolvedValue(validToken());
      tx.passwordResetToken.updateMany.mockResolvedValue({ count: 0 }); // another request used it first

      await expectPasswordError(resetPassword("raw-token", "new-password"), 400, "RESET_INVALID");

      expect(tx.passwordResetToken.updateMany.mock.calls[0][0].where).toMatchObject({ id: "t1", usedAt: null });
      expect(tx.user.update).not.toHaveBeenCalled();
      expect(notify).not.toHaveBeenCalled();
    });

    it.each([
      ["unknown", null],
      ["already used", validToken({ usedAt: new Date() })],
      ["expired", validToken({ expiresAt: new Date(Date.now() - 1000) })],
    ])("refuses an %s token", async (_label, record) => {
      (prisma.passwordResetToken.findUnique as jest.Mock).mockResolvedValue(record);

      await expectPasswordError(resetPassword("raw-token", "new-password"), 400, "RESET_INVALID");

      expect(tx.user.update).not.toHaveBeenCalled();
    });
  });

  describe("changePassword", () => {
    beforeEach(() => {
      (prisma.user.findUniqueOrThrow as jest.Mock).mockResolvedValue({ password: "current-hash" });
    });

    it("changes the password, signs out every session and voids pending reset links", async () => {
      (bcrypt.compare as jest.Mock).mockResolvedValueOnce(true).mockResolvedValueOnce(false);

      await changePassword("u1", "old-password", "new-password");

      const data = (prisma.user.update as jest.Mock).mock.calls[0][0].data;
      expect(data.password).toBe("new-hash");
      expect(data.passwordChangedAt).toBeInstanceOf(Date);
      expect(prisma.passwordResetToken.deleteMany).toHaveBeenCalledWith({ where: { userId: "u1", usedAt: null } });
      expect(notify).toHaveBeenCalledWith(expect.objectContaining({ type: "security.password_changed" }));
    });

    it("rejects a wrong current password with 400, never 401", async () => {
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      await expectPasswordError(changePassword("u1", "wrong", "new-password"), 400, "PASSWORD_INCORRECT");
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it("refuses to 'change' to the same password", async () => {
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      await expectPasswordError(changePassword("u1", "same-password", "same-password"), 400, "PASSWORD_UNCHANGED");
      expect(prisma.user.update).not.toHaveBeenCalled();
    });
  });
});
