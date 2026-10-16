import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import prisma from "../../../config/db";
import { authenticate } from "../../../middleware/auth.middleware";
import { isBlacklisted } from "../../../utils/tokenBlacklist.utils";

jest.mock("../../../config/db", () => ({
  __esModule: true,
  default: { user: { findUnique: jest.fn() } },
}));

jest.mock("../../../utils/tokenBlacklist.utils", () => ({
  isBlacklisted: jest.fn(),
  addToBlacklistWithExpiry: jest.fn(),
}));

jest.mock("jsonwebtoken");

const mockRes = () => {
  const res = {} as Response;
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

const run = async (authorization?: string) => {
  const req = { headers: { authorization } } as unknown as Request;
  const res = mockRes();
  const next = jest.fn() as NextFunction;
  await authenticate(req, res, next);
  return { req, res, next };
};

describe("authenticate middleware", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (isBlacklisted as jest.Mock).mockResolvedValue(false);
  });

  it("returns 401 when no token is provided", async () => {
    const { res, next } = await run();

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 401 when the token is blacklisted", async () => {
    (isBlacklisted as jest.Mock).mockResolvedValue(true);

    const { res, next } = await run("Bearer revoked");

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 401 when the token is invalid or expired", async () => {
    (jwt.verify as jest.Mock).mockImplementation(() => {
      throw new Error("jwt expired");
    });

    const { res, next } = await run("Bearer expired");

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      message: "Invalid or expired token",
    });
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 401 when the user no longer exists", async () => {
    (jwt.verify as jest.Mock).mockReturnValue({ userId: "gone" });
    (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);

    const { res, next } = await run("Bearer valid");

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 401 for a token issued before the password was changed", async () => {
    const changedAt = new Date("2026-10-10T12:00:00.000Z");
    (jwt.verify as jest.Mock).mockReturnValue({ userId: "u1", iat: changedAt.getTime() / 1000 - 1 });
    (prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: "u1", passwordChangedAt: changedAt });

    const { res, next } = await run("Bearer old");

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      message: "Your password was changed. Please log in again.",
    });
    expect(next).not.toHaveBeenCalled();
  });

  it("accepts a token issued in the same second as, or after, the password change", async () => {
    const changedAt = new Date("2026-10-10T12:00:00.700Z");
    (jwt.verify as jest.Mock).mockReturnValue({ userId: "u1", iat: Math.floor(changedAt.getTime() / 1000) });
    (prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: "u1", passwordChangedAt: changedAt });

    const { next } = await run("Bearer new");

    expect(next).toHaveBeenCalled();
  });

  it("attaches userId and token and calls next for a valid token", async () => {
    (jwt.verify as jest.Mock).mockReturnValue({ userId: "u1" });
    (prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: "u1" });

    const { req, res, next } = await run("Bearer valid");

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
    expect(req.userId).toBe("u1");
    expect(req.token).toBe("valid");
  });
});

describe("authenticate middleware: role and freeze", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (isBlacklisted as jest.Mock).mockResolvedValue(false);
    (jwt.verify as jest.Mock).mockReturnValue({ userId: "u1" });
  });

  it("reads the role and frozen state fresh from the database on every request", async () => {
    (prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: "u1", role: "ADMIN", frozenAt: new Date() });

    const { req, next } = await run("Bearer valid");

    expect(next).toHaveBeenCalled();
    expect(req.userRole).toBe("ADMIN");
    expect(req.accountFrozen).toBe(true);
  });

  it("treats a user with no freeze as active", async () => {
    (prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: "u1", role: "USER", frozenAt: null });

    const { req } = await run("Bearer valid");

    expect(req.userRole).toBe("USER");
    expect(req.accountFrozen).toBe(false);
  });
});
