import { Prisma } from "@prisma/client";
import prisma from "../../../config/db";
import { getWalletStats } from "../../../services/stats.service";

jest.mock("../../../config/db", () => ({
  __esModule: true,
  default: {
    $queryRaw: jest.fn(),
    wallet: { findUnique: jest.fn() },
  },
}));

const d = (value: number | string) => new Prisma.Decimal(value);

const row = (day: string, moneyIn: number, moneyOut: number, sent = 0, received = 0) => ({
  day,
  moneyIn: d(moneyIn),
  moneyOut: d(moneyOut),
  sent: d(sent),
  received: d(received),
});

// 2026-10-08 10:00 UTC — still 2026-10-08 in Lagos (UTC+1)
const NOW = new Date("2026-10-08T10:00:00Z");

describe("stats.service — getWalletStats", () => {
  beforeEach(() => jest.clearAllMocks());

  it("splits days into current and previous periods and totals each", async () => {
    (prisma.$queryRaw as jest.Mock).mockResolvedValue([
      row("2026-10-08", 150.5, 25, 25, 0),
      row("2026-10-05", 0, 50),
      row("2026-10-01", 100, 0, 0, 100), // previous period
    ]);
    (prisma.wallet.findUnique as jest.Mock).mockResolvedValue({ balance: d(175.5) });

    const stats = await getWalletStats("u1", 7, "UTC", NOW);

    expect(stats.current).toEqual({
      from: "2026-10-02",
      to: "2026-10-08",
      moneyIn: "150.50",
      moneyOut: "75.00",
      sent: "25.00",
      received: "0.00",
      net: "75.50",
    });
    expect(stats.previous).toMatchObject({
      from: "2026-09-25",
      to: "2026-10-01",
      moneyIn: "100.00",
      received: "100.00",
      net: "100.00",
    });
  });

  it("returns a zero-filled daily series covering both periods, oldest first", async () => {
    (prisma.$queryRaw as jest.Mock).mockResolvedValue([row("2026-10-08", 10, 0)]);
    (prisma.wallet.findUnique as jest.Mock).mockResolvedValue({ balance: d(10) });

    const stats = await getWalletStats("u1", 7, "UTC", NOW);

    expect(stats.daily).toHaveLength(14);
    expect(stats.daily[0]).toEqual({ date: "2026-09-25", moneyIn: "0.00", moneyOut: "0.00" });
    expect(stats.daily[13]).toEqual({ date: "2026-10-08", moneyIn: "10.00", moneyOut: "0.00" });
  });

  it("derives the balance at period start and the percentage change", async () => {
    (prisma.$queryRaw as jest.Mock).mockResolvedValue([row("2026-10-07", 50, 0)]);
    (prisma.wallet.findUnique as jest.Mock).mockResolvedValue({ balance: d(250) });

    const stats = await getWalletStats("u1", 30, "UTC", NOW);

    expect(stats.balance).toEqual({
      current: "250.00",
      atPeriodStart: "200.00",
      change: "50.00",
      changePercent: 25,
    });
  });

  it("reports a null percentage when the period started from zero", async () => {
    (prisma.$queryRaw as jest.Mock).mockResolvedValue([row("2026-10-08", 100, 0)]);
    (prisma.wallet.findUnique as jest.Mock).mockResolvedValue({ balance: d(100) });

    const stats = await getWalletStats("u1", 7, "UTC", NOW);

    expect(stats.balance.changePercent).toBeNull();
    expect(stats.balance.atPeriodStart).toBe("0.00");
  });

  it("uses the caller's timezone to decide what 'today' is", async () => {
    (prisma.$queryRaw as jest.Mock).mockResolvedValue([]);
    (prisma.wallet.findUnique as jest.Mock).mockResolvedValue({ balance: d(0) });

    // 23:30 UTC on Oct 8 is already Oct 9 in Lagos
    const stats = await getWalletStats("u1", 1, "Africa/Lagos", new Date("2026-10-08T23:30:00Z"));

    expect(stats.current.from).toBe("2026-10-09");
    expect(stats.previous.from).toBe("2026-10-08");
  });

  it("treats a missing wallet as a zero balance", async () => {
    (prisma.$queryRaw as jest.Mock).mockResolvedValue([]);
    (prisma.wallet.findUnique as jest.Mock).mockResolvedValue(null);

    const stats = await getWalletStats("u1", 7, "UTC", NOW);

    expect(stats.balance.current).toBe("0.00");
    expect(stats.current.net).toBe("0.00");
  });
});
