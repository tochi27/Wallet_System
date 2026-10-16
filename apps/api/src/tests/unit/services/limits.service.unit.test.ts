import { Prisma } from "@prisma/client";
import prisma from "../../../config/db";
import { TIER_LIMITS } from "../../../config/limits";
import {
  assertCanReceive,
  assertCanSend,
  getLimits,
  LimitError,
  limitDay,
  spentToday,
} from "../../../services/limits.service";

jest.mock("../../../config/db", () => ({
  __esModule: true,
  default: {
    user: { findUniqueOrThrow: jest.fn() },
    wallet: { findUniqueOrThrow: jest.fn() },
    transaction: { aggregate: jest.fn() },
    withdrawal: { aggregate: jest.fn() },
  },
}));

const sum = (amount: number | null) => ({ _sum: { amount: amount === null ? null : new Prisma.Decimal(amount) } });
const spent = (transfers: number | null, withdrawals: number | null = null) => {
  (prisma.transaction.aggregate as jest.Mock).mockResolvedValue(sum(transfers));
  (prisma.withdrawal.aggregate as jest.Mock).mockResolvedValue(sum(withdrawals));
};
const onTier = (tier: "TIER_1" | "TIER_2") => (prisma.user.findUniqueOrThrow as jest.Mock).mockResolvedValue({ tier });

const expectLimitError = async (promise: Promise<unknown>, code: string, remaining: string) => {
  const error = await promise.then(
    () => null,
    (err: unknown) => err
  );
  expect(error).toBeInstanceOf(LimitError);
  expect(error).toMatchObject({ status: 400, code, remaining });
};

describe("limits.service", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    onTier("TIER_1");
    spent(null);
  });

  describe("limitDay", () => {
    it("runs from midnight to midnight Nigerian time (UTC+1)", () => {
      // 23:30 UTC on the 14th is 00:30 on the 15th in Lagos
      const { start, resetsAt } = limitDay(new Date("2026-10-14T23:30:00Z"));
      expect(start.toISOString()).toBe("2026-10-14T23:00:00.000Z");
      expect(resetsAt.toISOString()).toBe("2026-10-15T23:00:00.000Z");

      // 22:30 UTC on the 14th is still the 14th in Lagos
      expect(limitDay(new Date("2026-10-14T22:30:00Z")).start.toISOString()).toBe("2026-10-13T23:00:00.000Z");
    });
  });

  describe("spentToday", () => {
    it("adds transfers sent and withdrawals that haven't failed, since midnight", async () => {
      spent(30_000, 20_000);
      const now = new Date("2026-10-15T10:00:00Z");

      await expect(spentToday(prisma, "u1", now)).resolves.toEqual(new Prisma.Decimal(50_000));

      const transfers = (prisma.transaction.aggregate as jest.Mock).mock.calls[0][0].where;
      expect(transfers).toMatchObject({ userId: "u1", type: "DEBIT", status: "SUCCESSFUL", transferId: { not: null } });
      expect(transfers.timestamp.gte.toISOString()).toBe("2026-10-14T23:00:00.000Z");
      const withdrawals = (prisma.withdrawal.aggregate as jest.Mock).mock.calls[0][0].where;
      expect(withdrawals.status).toEqual({ notIn: ["FAILED", "REVERSED"] });
    });
  });

  describe("assertCanSend", () => {
    it("allows a payment within the limits", async () => {
      spent(100_000);
      await expect(assertCanSend(prisma, "u1", 50_000)).resolves.toBeUndefined();
    });

    it("refuses a single payment over the tier's per-payment limit", async () => {
      await expectLimitError(assertCanSend(prisma, "u1", 50_000.01), "PER_TRANSACTION", "50000.00");
    });

    it("refuses a payment that would pass the daily limit and says how much is left", async () => {
      spent(120_000, 50_000);
      await expectLimitError(assertCanSend(prisma, "u1", 40_000), "DAILY", "30000.00");
      await expect(assertCanSend(prisma, "u1", 40_000)).rejects.toThrow("up to ₦30,000.00 more today");
    });

    it("says when the daily limit is used up", async () => {
      spent(200_000);
      await expect(assertCanSend(prisma, "u1", 1)).rejects.toThrow("reached your daily limit");
    });

    it("uses the higher limits on Tier 2", async () => {
      onTier("TIER_2");
      spent(1_000_000);
      await expect(assertCanSend(prisma, "u1", 500_000)).resolves.toBeUndefined();
      await expectLimitError(assertCanSend(prisma, "u1", 500_001), "PER_TRANSACTION", "500000.00");
    });
  });

  describe("assertCanReceive", () => {
    it("refuses adding money past the Tier 1 balance cap and says how much fits", async () => {
      (prisma.wallet.findUniqueOrThrow as jest.Mock).mockResolvedValue({ balance: new Prisma.Decimal(480_000) });
      await expect(assertCanReceive(prisma, "u1", 20_000)).resolves.toBeUndefined();
      await expectLimitError(assertCanReceive(prisma, "u1", 20_000.01), "BALANCE_CAP", "20000.00");
    });

    it("has no cap on Tier 2", async () => {
      onTier("TIER_2");
      await expect(assertCanReceive(prisma, "u1", 10_000_000)).resolves.toBeUndefined();
      expect(prisma.wallet.findUniqueOrThrow).not.toHaveBeenCalled();
    });
  });

  describe("getLimits", () => {
    it("reports the tier, today's usage and room left in the wallet", async () => {
      (prisma.user.findUniqueOrThrow as jest.Mock).mockResolvedValue({
        tier: "TIER_1",
        emailVerifiedAt: new Date(),
        wallet: { balance: new Prisma.Decimal(450_000) },
      });
      spent(25_000);

      const limits = await getLimits("u1", new Date("2026-10-15T10:00:00Z"));

      expect(limits).toEqual({
        tier: "TIER_1",
        emailVerified: true,
        perTransaction: "50000.00",
        daily: { limit: "200000.00", used: "25000.00", remaining: "175000.00", resetsAt: new Date("2026-10-15T23:00:00Z") },
        balance: { max: "500000.00", current: "450000.00", room: "50000.00" },
      });
    });

    it("keeps the limits in one place", () => {
      expect(TIER_LIMITS.TIER_1.perTransaction).toBeLessThan(TIER_LIMITS.TIER_2.perTransaction);
      expect(TIER_LIMITS.TIER_2.maxBalance).toBeNull();
    });
  });
});
