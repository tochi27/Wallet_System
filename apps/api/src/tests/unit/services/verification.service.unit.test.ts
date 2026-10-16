import prisma from "../../../config/db";
import redisClient from "../../../services/redis.service";
import { queueEmail } from "../../../services/notifications/notification.service";
import {
  hashVerificationToken,
  resendVerification,
  sendVerificationEmail,
  VerificationError,
  verifyEmail,
} from "../../../services/security/verification.service";

const tx = {
  emailVerificationToken: { updateMany: jest.fn(), deleteMany: jest.fn() },
  user: { updateMany: jest.fn() },
};

jest.mock("../../../config/db", () => ({
  __esModule: true,
  default: {
    user: { findUniqueOrThrow: jest.fn() },
    emailVerificationToken: { findUnique: jest.fn(), create: jest.fn(), deleteMany: jest.fn() },
    $transaction: jest.fn(),
  },
}));
jest.mock("../../../services/redis.service", () => ({
  __esModule: true,
  default: { set: jest.fn(), incr: jest.fn(), expire: jest.fn(), ttl: jest.fn(), get: jest.fn() },
}));
jest.mock("../../../services/notifications/notification.service", () => ({ queueEmail: jest.fn() }));

const expectVerificationError = async (promise: Promise<unknown>, status: number, code: string) => {
  const error = await promise.then(
    () => null,
    (err: unknown) => err
  );
  expect(error).toBeInstanceOf(VerificationError);
  expect(error).toMatchObject({ status, code });
};

const ada = { id: "u1", name: "Ada Lovelace", email: "ada@example.com" };

describe("verification.service", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (redisClient.incr as jest.Mock).mockResolvedValue(1);
    (redisClient.ttl as jest.Mock).mockResolvedValue(-2);
    (redisClient.get as jest.Mock).mockResolvedValue(null);
    (prisma.$transaction as jest.Mock).mockImplementation(async (arg: unknown) =>
      typeof arg === "function" ? arg(tx) : Promise.all(arg as Promise<unknown>[])
    );
    tx.emailVerificationToken.updateMany.mockResolvedValue({ count: 1 });
    tx.user.updateMany.mockResolvedValue({ count: 1 });
  });

  describe("sendVerificationEmail", () => {
    it("stores only a hash of the token, replaces older links and emails the link", async () => {
      await sendVerificationEmail(ada);

      expect(prisma.emailVerificationToken.deleteMany).toHaveBeenCalledWith({ where: { userId: "u1", usedAt: null } });
      const { data } = (prisma.emailVerificationToken.create as jest.Mock).mock.calls[0][0];
      const email = (queueEmail as jest.Mock).mock.calls[0][0];
      const token = /verify-email\?token=([\w-]+)/.exec(email.text)![1];

      expect(data.tokenHash).toBe(hashVerificationToken(token));
      expect(data.tokenHash).not.toBe(token);
      expect(data.expiresAt.getTime() - Date.now()).toBeGreaterThan(23.9 * 60 * 60_000);
      expect(email.to).toBe("ada@example.com");
      expect(email.subject).toMatch(/verify your email/i);
    });

    it("starts the resend cooldown and counts towards the daily limit", async () => {
      await sendVerificationEmail(ada);

      expect(redisClient.set).toHaveBeenCalledWith("email-verify:cooldown:u1", "1", "EX", 120);
      expect(redisClient.incr).toHaveBeenCalledWith("email-verify:sent:u1");
      expect(redisClient.expire).toHaveBeenCalledWith("email-verify:sent:u1", 86400);
    });
  });

  describe("resendVerification", () => {
    beforeEach(() => {
      (prisma.user.findUniqueOrThrow as jest.Mock).mockResolvedValue({ ...ada, emailVerifiedAt: null });
    });

    it("sends a new link", async () => {
      await expect(resendVerification("u1")).resolves.toEqual({ email: "ada@example.com" });
      expect(queueEmail).toHaveBeenCalledTimes(1);
    });

    it("refuses when the email is already verified", async () => {
      (prisma.user.findUniqueOrThrow as jest.Mock).mockResolvedValue({ ...ada, emailVerifiedAt: new Date() });
      await expectVerificationError(resendVerification("u1"), 409, "ALREADY_VERIFIED");
      expect(queueEmail).not.toHaveBeenCalled();
    });

    it("refuses during the 2-minute cooldown and says how long to wait", async () => {
      (redisClient.ttl as jest.Mock).mockResolvedValue(42);
      await expectVerificationError(resendVerification("u1"), 429, "RESEND_COOLDOWN");
      await expect(resendVerification("u1")).rejects.toThrow("42 seconds");
      expect(queueEmail).not.toHaveBeenCalled();
    });

    it("refuses after 5 emails in a day", async () => {
      (redisClient.get as jest.Mock).mockResolvedValue("5");
      await expectVerificationError(resendVerification("u1"), 429, "RESEND_LIMIT");
      expect(queueEmail).not.toHaveBeenCalled();
    });
  });

  describe("verifyEmail", () => {
    const record = (overrides: Record<string, unknown> = {}) => ({
      id: "t1",
      userId: "u1",
      usedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
      user: { emailVerifiedAt: null },
      ...overrides,
    });

    it("looks the token up by its hash and marks the email verified", async () => {
      (prisma.emailVerificationToken.findUnique as jest.Mock).mockResolvedValue(record());

      await expect(verifyEmail("the-token")).resolves.toBe("verified");

      expect(prisma.emailVerificationToken.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { tokenHash: hashVerificationToken("the-token") } })
      );
      expect(tx.user.updateMany).toHaveBeenCalledWith({
        where: { id: "u1", emailVerifiedAt: null },
        data: { emailVerifiedAt: expect.any(Date) },
      });
      expect(tx.emailVerificationToken.deleteMany).toHaveBeenCalledWith({ where: { userId: "u1", usedAt: null } });
    });

    it("rejects an unknown or expired link", async () => {
      (prisma.emailVerificationToken.findUnique as jest.Mock).mockResolvedValueOnce(null);
      await expectVerificationError(verifyEmail("nope"), 400, "VERIFY_INVALID");

      (prisma.emailVerificationToken.findUnique as jest.Mock).mockResolvedValueOnce(record({ expiresAt: new Date(Date.now() - 1000) }));
      await expectVerificationError(verifyEmail("old"), 400, "VERIFY_INVALID");
      expect(tx.user.updateMany).not.toHaveBeenCalled();
    });

    it("answers 'already verified' when a used link is opened again", async () => {
      (prisma.emailVerificationToken.findUnique as jest.Mock).mockResolvedValue(
        record({ usedAt: new Date(), user: { emailVerifiedAt: new Date() } })
      );
      await expect(verifyEmail("again")).resolves.toBe("already_verified");
      expect(tx.user.updateMany).not.toHaveBeenCalled();
    });

    it("works once even if the link is opened twice at the same moment", async () => {
      (prisma.emailVerificationToken.findUnique as jest.Mock).mockResolvedValue(record());
      tx.emailVerificationToken.updateMany.mockResolvedValue({ count: 0 });

      await expect(verifyEmail("raced")).resolves.toBe("already_verified");
      expect(tx.user.updateMany).not.toHaveBeenCalled();
    });
  });
});
