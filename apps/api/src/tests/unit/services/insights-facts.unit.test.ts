import { Prisma } from "@prisma/client";
import prisma from "../../../config/db";
import { buildFacts } from "../../../services/insights/facts.service";

jest.mock("../../../config/db", () => ({ __esModule: true, default: { $queryRaw: jest.fn() } }));

// 2026-10-14 10:00 UTC: the current period is 2026-09-15..2026-10-14 in Lagos
const NOW = new Date("2026-10-14T10:00:00Z");

let n = 0;
const row = (day: string, amount: number, overrides: Record<string, unknown> = {}) => ({
  id: `t${++n}`,
  type: "DEBIT",
  amount: new Prisma.Decimal(amount),
  description: null,
  category: null,
  day,
  isWithdrawal: false,
  counterpartyId: null,
  counterpartyName: null,
  ...overrides,
});
const landlord = { counterpartyId: "u-landlord", counterpartyName: "Emeka Nwosu" };

describe("buildFacts", () => {
  beforeEach(() => jest.clearAllMocks());

  it("compares spending, money in and withdrawals across the two periods", async () => {
    (prisma.$queryRaw as jest.Mock).mockResolvedValue([
      row("2026-09-01", 10000, { category: "FOOD" }), // previous period
      row("2026-10-01", 15000, { category: "FOOD" }),
      row("2026-10-02", 5000, { category: "TRANSPORT" }),
      row("2026-10-03", 50000, { isWithdrawal: true }), // to own bank: not spending
      row("2026-10-04", 90000, { type: "CREDIT" }),
    ]);

    const facts = await buildFacts("u1", "Africa/Lagos", NOW);

    expect(facts.period).toEqual({ from: "2026-09-15", to: "2026-10-14" });
    expect(facts.current).toEqual({ moneyIn: "90000.00", spent: "20000.00", withdrawn: "50000.00", spendCount: 2 });
    expect(facts.previous.spent).toBe("10000.00");
    expect(facts.spentChangePercent).toBe(100);
    expect(facts.categories).toEqual([
      { category: "FOOD", current: "15000.00", previous: "10000.00", changePercent: 50 },
      { category: "TRANSPORT", current: "5000.00", previous: "0.00", changePercent: null },
    ]);
  });

  it("spots a regular payment and doesn't call it unusual", async () => {
    (prisma.$queryRaw as jest.Mock).mockResolvedValue([
      row("2026-07-20", 150000, landlord),
      row("2026-08-20", 150000, landlord),
      row("2026-09-20", 150000, landlord),
      ...["2026-09-25", "2026-09-28", "2026-10-02", "2026-10-05", "2026-10-08"].map((d) => row(d, 5000)),
      row("2026-10-10", 95000, { description: "Phone repair" }),
    ]);

    const facts = await buildFacts("u1", "Africa/Lagos", NOW);

    expect(facts.regularPayments).toEqual([{ userId: "u-landlord", name: "Emeka", typicalAmount: "150000.00", months: 3 }]);
    expect(facts.unusualSpends.map((u) => u.description)).toEqual(["Phone repair"]);
    expect(facts.topRecipients[0]).toMatchObject({ name: "Emeka", total: "150000.00", count: 1 });
    expect(facts.uncategorisedCount).toBe(7);
  });

  it("reports no change percentage when nothing was spent before", async () => {
    (prisma.$queryRaw as jest.Mock).mockResolvedValue([row("2026-10-01", 1000)]);

    const facts = await buildFacts("u1", "Africa/Lagos", NOW);

    expect(facts.spentChangePercent).toBeNull();
    expect(facts.largestSpend).toMatchObject({ amount: "1000.00", category: "UNCATEGORISED" });
  });
});
