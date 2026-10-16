import bcrypt from "bcryptjs";
import prisma from "../../../config/db";
import { findUserById, registerUser } from "../../../services/auth.service";

jest.mock("../../../config/db", () => ({
  __esModule: true,
  default: {
    user: {
      create: jest.fn(),
      findUnique: jest.fn(),
    },
  },
}));

jest.mock("bcryptjs");

const publicFields = { id: true, name: true, email: true, createdAt: true };

describe("auth.service", () => {
  beforeEach(() => jest.clearAllMocks());

  describe("registerUser", () => {
    it("hashes the password and never selects it back", async () => {
      (bcrypt.hash as jest.Mock).mockResolvedValue("hashed-pw");
      (prisma.user.create as jest.Mock).mockResolvedValue({ id: "u1" });

      await registerUser("Tochi", "new@test.com", "password123");

      expect(bcrypt.hash).toHaveBeenCalledWith("password123", 10);
      const args = (prisma.user.create as jest.Mock).mock.calls[0][0];
      expect(args.data.password).toBe("hashed-pw");
      expect(args.data.wallet).toEqual({ create: { balance: 0 } });
      expect(args.select).toEqual(publicFields);
    });
  });

  describe("findUserById", () => {
    const row = (overrides: Record<string, unknown> = {}) => ({
      id: "u1",
      name: "Ada",
      email: "ada@example.com",
      createdAt: new Date(),
      emailNotifications: true,
      passwordChangedAt: null,
      transactionPinHash: "$2a$10$hash",
      pinLockedUntil: null,
      ...overrides,
    });

    it("reports an active PIN lock and hides an expired one", async () => {
      const until = new Date(Date.now() + 10 * 60_000);
      (prisma.user.findUnique as jest.Mock).mockResolvedValueOnce(row({ pinLockedUntil: until }));
      (prisma.user.findUnique as jest.Mock).mockResolvedValueOnce(row({ pinLockedUntil: new Date(Date.now() - 1000) }));

      expect((await findUserById("u1"))?.pinLockedUntil).toEqual(until);
      expect((await findUserById("u1"))?.pinLockedUntil).toBeNull();
    });

    it("includes when the password was last changed", async () => {
      const changed = new Date("2026-10-10T12:00:00Z");
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(row({ passwordChangedAt: changed }));

      expect((await findUserById("u1"))?.passwordChangedAt).toEqual(changed);
    });

    it("looks up by id and selects public fields plus own settings", async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);

      await findUserById("u1");

      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { id: "u1" },
        select: {
          ...publicFields,
          emailNotifications: true,
          aiInsightsEnabled: true,
          passwordChangedAt: true,
          role: true,
          frozenAt: true,
          emailVerifiedAt: true,
          transactionPinHash: true,
          pinLockedUntil: true,
        },
      });
    });

    it("reports whether the email is verified, not when", async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValueOnce(row({ emailVerifiedAt: new Date() }));
      (prisma.user.findUnique as jest.Mock).mockResolvedValueOnce(row({ emailVerifiedAt: null }));

      const verified = await findUserById("u1");
      expect(verified?.emailVerified).toBe(true);
      expect(verified).not.toHaveProperty("emailVerifiedAt");
      expect((await findUserById("u1"))?.emailVerified).toBe(false);
    });

    it("reports hasPin without ever returning the PIN hash", async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue({
        id: "u1",
        name: "Ada",
        email: "ada@example.com",
        createdAt: new Date(),
        emailNotifications: true,
        transactionPinHash: "$2a$10$hash",
      });

      const profile = await findUserById("u1");

      expect(profile).toMatchObject({ id: "u1", hasPin: true, emailNotifications: true });
      expect(profile).not.toHaveProperty("transactionPinHash");
    });
  });
});
