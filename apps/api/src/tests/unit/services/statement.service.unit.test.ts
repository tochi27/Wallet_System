import { PassThrough } from "stream";
import { Prisma, TransactionStatus, TransactionType } from "@prisma/client";
import prisma from "../../../config/db";
import { getStatement, StatementTooLargeError } from "../../../services/statement.service";
import { renderStatementCsv, renderStatementPdf } from "../../../services/statement.render";

jest.mock("../../../config/db", () => ({
  __esModule: true,
  default: {
    user: { findUniqueOrThrow: jest.fn() },
    transaction: { findMany: jest.fn() },
    $queryRaw: jest.fn(),
  },
}));

const d = (value: number | string) => new Prisma.Decimal(value);

const row = (overrides: Record<string, unknown>) => ({
  id: "t",
  reference: "ref-12345678",
  type: TransactionType.CREDIT,
  status: TransactionStatus.SUCCESSFUL,
  amount: d(0),
  description: null,
  transferId: null,
  reversalOf: null,
  timestamp: new Date("2026-10-02T09:00:00Z"),
  ...overrides,
});

describe("statement", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (prisma.user.findUniqueOrThrow as jest.Mock).mockResolvedValue({ name: "Ada Lovelace", email: "ada@example.com" });
    (prisma.transaction.findMany as jest.Mock).mockResolvedValue([]);
  });

  const mockRows = (opening: number | null, rows: ReturnType<typeof row>[]) => {
    (prisma.$queryRaw as jest.Mock).mockResolvedValueOnce([{ opening: opening === null ? null : d(opening) }]).mockResolvedValueOnce(rows);
  };

  it("runs the balance from the opening balance and totals money in and out", async () => {
    mockRows(1000, [
      row({ id: "a", amount: d(500), description: "Salary" }),
      row({ id: "b", type: TransactionType.DEBIT, amount: d(200) }),
    ]);

    const statement = await getStatement("u1", "2026-10-01", "2026-10-31", "Africa/Lagos");

    expect(statement.openingBalance.toFixed(2)).toBe("1000.00");
    expect(statement.rows.map((r) => r.balance.toFixed(2))).toEqual(["1500.00", "1300.00"]);
    expect(statement.moneyIn.toFixed(2)).toBe("500.00");
    expect(statement.moneyOut.toFixed(2)).toBe("200.00");
    expect(statement.closingBalance.toFixed(2)).toBe("1300.00");
    expect(statement.rows[1].description).toBe("Withdrawal");
  });

  it("starts from zero for a new account", async () => {
    mockRows(null, []);

    const statement = await getStatement("u1", "2026-10-01", "2026-10-31", "UTC");

    expect(statement.openingBalance.toFixed(2)).toBe("0.00");
    expect(statement.closingBalance.toFixed(2)).toBe("0.00");
  });

  it("names the other party on transfers and marks reversed entries", async () => {
    mockRows(0, [
      row({ id: "a", amount: d(100), transferId: "tr-1", description: "Dinner" }),
      row({ id: "b", type: TransactionType.DEBIT, amount: d(50), status: TransactionStatus.REVERSED }),
    ]);
    (prisma.transaction.findMany as jest.Mock).mockResolvedValue([{ transferId: "tr-1", user: { name: "Grace Hopper" } }]);

    const statement = await getStatement("u1", "2026-10-01", "2026-10-31", "UTC");

    expect(statement.rows[0].description).toBe("Dinner (from Grace Hopper)");
    expect(statement.rows[1].description).toBe("Withdrawal [reversed]");
  });

  it("refuses periods with too many transactions", async () => {
    mockRows(0, Array.from({ length: 5001 }, (_, i) => row({ id: `t${i}` })));

    await expect(getStatement("u1", "2026-01-01", "2026-12-31", "UTC")).rejects.toBeInstanceOf(StatementTooLargeError);
  });

  describe("CSV", () => {
    it("quotes cells and neutralises spreadsheet formulas typed into descriptions", async () => {
      mockRows(0, [row({ amount: d(10), description: '=HYPERLINK("http://evil","click")' })]);
      const statement = await getStatement("u1", "2026-10-01", "2026-10-31", "UTC");

      const csv = renderStatementCsv(statement);

      expect(csv.startsWith("﻿")).toBe(true);
      expect(csv).toContain(`"'=HYPERLINK(""http://evil"",""click"")"`);
      expect(csv).toContain('"10.00","","10.00"');
    });
  });

  describe("PDF", () => {
    it("produces a PDF document", async () => {
      mockRows(0, [row({ amount: d(10), description: "Withdrawal to Zenith Bank ••1234" })]);
      const statement = await getStatement("u1", "2026-10-01", "2026-10-31", "UTC");

      const out = new PassThrough();
      const chunks: Buffer[] = [];
      out.on("data", (chunk: Buffer) => chunks.push(chunk));
      const done = new Promise((resolve) => out.on("end", resolve));
      renderStatementPdf(statement, out);
      await done;

      const pdf = Buffer.concat(chunks);
      expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
      expect(pdf.length).toBeGreaterThan(1000);
      // One short statement = one page (the footer must not spill onto extra pages)
      expect(pdf.toString("latin1").match(/\/Type \/Page\b/g)).toHaveLength(1);
    });
  });
});
