import { Prisma, SpendingCategory, TransactionType } from "@prisma/client";
import prisma from "../../config/db";
import { firstName } from "./pseudonymise";

// Everything insights may say is calculated here, by our code. The AI only words these facts.

const PERIOD_DAYS = 30;
const HISTORY_DAYS = 90; // for regular payments and what counts as unusual
const UNUSUAL_MULTIPLE = 3; // a spend this many times the typical spend is unusual…
const UNUSUAL_MINIMUM = new Prisma.Decimal(5000); // …if it's also at least ₦5,000
const ZERO = new Prisma.Decimal(0);

export type CategoryKey = SpendingCategory | "UNCATEGORISED";

export type PeriodSummary = { moneyIn: string; spent: string; withdrawn: string; spendCount: number };

export type InsightFacts = {
  timezone: string;
  period: { from: string; to: string };
  previousPeriod: { from: string; to: string };
  current: PeriodSummary;
  previous: PeriodSummary;
  // null when nothing was spent in the previous period
  spentChangePercent: number | null;
  categories: { category: CategoryKey; current: string; previous: string; changePercent: number | null }[];
  topRecipients: { userId: string; name: string; total: string; count: number }[];
  largestSpend: { amount: string; date: string; category: CategoryKey; recipient: string | null; recipientId: string | null; description: string | null } | null;
  regularPayments: { userId: string; name: string; typicalAmount: string; months: number }[];
  unusualSpends: { amount: string; date: string; recipient: string | null; recipientId: string | null; description: string | null; timesTypical: number }[];
  uncategorisedCount: number;
};

type Row = {
  id: string;
  type: TransactionType;
  amount: Prisma.Decimal;
  description: string | null;
  category: SpendingCategory | null;
  day: string;
  isWithdrawal: boolean;
  counterpartyId: string | null;
  counterpartyName: string | null;
};

// Calendar date (YYYY-MM-DD) of `now` in an IANA timezone
export const localDate = (timezone: string, now: Date) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);

const addDays = (isoDate: string, n: number) => {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

const money = (value: Prisma.Decimal) => value.toFixed(2);
const sum = (rows: Row[]) => rows.reduce((acc, row) => acc.add(row.amount), ZERO);
const percentChange = (current: Prisma.Decimal, previous: Prisma.Decimal) =>
  previous.gt(0) ? Math.round(current.sub(previous).div(previous).mul(100).toNumber()) : null;

const median = (values: Prisma.Decimal[]) => {
  if (values.length === 0) return ZERO;
  const sorted = [...values].sort((a, b) => a.comparedTo(b));
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : sorted[mid - 1].add(sorted[mid]).div(2);
};

/**
 * The last 30 days against the 30 before, in the user's timezone. Counts only completed
 * transactions: a reversed transaction and its reversal are both left out, as is the refund of a
 * failed withdrawal, so the figures reflect money that actually moved.
 */
export const buildFacts = async (userId: string, timezone: string, now: Date = new Date()): Promise<InsightFacts> => {
  const today = localDate(timezone, now);
  const currentFrom = addDays(today, -(PERIOD_DAYS - 1));
  const previousFrom = addDays(currentFrom, -PERIOD_DAYS);
  const historyFrom = addDays(today, -(HISTORY_DAYS - 1));
  // Coarse UTC bound lets Postgres skip old rows; the exact cut is on the local date (offsets are within ±14h)
  const coarseFrom = new Date(`${addDays(historyFrom, -1)}T00:00:00Z`);

  const rows = await prisma.$queryRaw<Row[]>`
    SELECT * FROM (
      SELECT t."id", t."type", t."amount", t."description", t."category",
             to_char(((t."timestamp" AT TIME ZONE 'UTC') AT TIME ZONE ${timezone})::date, 'YYYY-MM-DD') AS "day",
             (w."id" IS NOT NULL) AS "isWithdrawal",
             cp."userId" AS "counterpartyId",
             cu."name" AS "counterpartyName"
      FROM "Transaction" t
      LEFT JOIN "Withdrawal" w ON w."debitTransactionId" = t."id"
      LEFT JOIN "Transaction" cp ON t."transferId" IS NOT NULL AND cp."transferId" = t."transferId" AND cp."id" <> t."id"
      LEFT JOIN "User" cu ON cu."id" = cp."userId"
      WHERE t."userId" = ${userId}
        AND t."status" = 'SUCCESSFUL'
        AND t."reversalOf" IS NULL
        AND t."timestamp" >= ${coarseFrom}
    ) r
    WHERE r."day" >= ${historyFrom}
    ORDER BY r."day" ASC
  `;

  const inPeriod = (from: string, to: string) => rows.filter((r) => r.day >= from && r.day <= to);
  const isSpend = (r: Row) => r.type === TransactionType.DEBIT && !r.isWithdrawal;
  const summarise = (slice: Row[]): PeriodSummary => {
    const spends = slice.filter(isSpend);
    return {
      moneyIn: money(sum(slice.filter((r) => r.type === TransactionType.CREDIT))),
      spent: money(sum(spends)),
      withdrawn: money(sum(slice.filter((r) => r.type === TransactionType.DEBIT && r.isWithdrawal))),
      spendCount: spends.length,
    };
  };

  const currentRows = inPeriod(currentFrom, today);
  const previousRows = inPeriod(previousFrom, addDays(currentFrom, -1));
  const currentSpends = currentRows.filter(isSpend);
  const previousSpends = previousRows.filter(isSpend);
  const historySpends = rows.filter(isSpend);
  const categoryOf = (r: Row): CategoryKey => r.category ?? "UNCATEGORISED";

  // Categories, biggest this period first
  const categoryKeys = new Set<CategoryKey>([...currentSpends, ...previousSpends].map(categoryOf));
  const categories = [...categoryKeys]
    .map((category) => {
      const current = sum(currentSpends.filter((r) => categoryOf(r) === category));
      const previous = sum(previousSpends.filter((r) => categoryOf(r) === category));
      return { category, current, previous };
    })
    .sort((a, b) => b.current.comparedTo(a.current) || b.previous.comparedTo(a.previous))
    .map(({ category, current, previous }) => ({
      category,
      current: money(current),
      previous: money(previous),
      changePercent: percentChange(current, previous),
    }));

  // People paid most this period
  const byRecipient = new Map<string, { name: string; total: Prisma.Decimal; count: number }>();
  for (const r of currentSpends) {
    if (!r.counterpartyId || !r.counterpartyName) continue;
    const entry = byRecipient.get(r.counterpartyId) ?? { name: firstName(r.counterpartyName), total: ZERO, count: 0 };
    byRecipient.set(r.counterpartyId, { ...entry, total: entry.total.add(r.amount), count: entry.count + 1 });
  }
  const topRecipients = [...byRecipient.entries()]
    .sort(([, a], [, b]) => b.total.comparedTo(a.total))
    .slice(0, 3)
    .map(([id, e]) => ({ userId: id, name: e.name, total: money(e.total), count: e.count }));

  const largest = currentSpends.reduce<Row | null>((max, r) => (!max || r.amount.gt(max.amount) ? r : max), null);

  // Regular payments: the same person paid in each of the last three 30-day blocks, in similar amounts
  const block = (day: string) => (day >= currentFrom ? 0 : day >= previousFrom ? 1 : 2);
  const byPayee = new Map<string, Row[]>();
  for (const r of historySpends) {
    if (r.counterpartyId) byPayee.set(r.counterpartyId, [...(byPayee.get(r.counterpartyId) ?? []), r]);
  }
  const regularPayments = [...byPayee.entries()]
    .filter(([, payments]) => new Set(payments.map((p) => block(p.day))).size === 3)
    .map(([id, payments]) => ({ id, payments, typical: median(payments.map((p) => p.amount)) }))
    .filter(({ payments, typical }) => payments.every((p) => p.amount.sub(typical).abs().lte(typical.mul(0.25))))
    .slice(0, 3)
    .map(({ id, payments, typical }) => ({
      userId: id,
      name: firstName(payments[0].counterpartyName ?? "Someone"),
      typicalAmount: money(typical),
      months: 3,
    }));

  // Unusual: far above this user's typical spend over the last 90 days. A big regular payment
  // (like rent) is expected, so it never counts.
  const typicalSpend = median(historySpends.map((r) => r.amount));
  const regularPayees = new Set(regularPayments.map((r) => r.userId));
  const unusualSpends = currentSpends
    .filter((r) => !(r.counterpartyId && regularPayees.has(r.counterpartyId)))
    .filter((r) => typicalSpend.gt(0) && r.amount.gte(typicalSpend.mul(UNUSUAL_MULTIPLE)) && r.amount.gte(UNUSUAL_MINIMUM))
    .sort((a, b) => b.amount.comparedTo(a.amount))
    .slice(0, 2)
    .map((r) => ({
      amount: money(r.amount),
      date: r.day,
      recipient: r.counterpartyName ? firstName(r.counterpartyName) : null,
      recipientId: r.counterpartyId,
      description: r.description,
      timesTypical: Math.floor(r.amount.div(typicalSpend).toNumber()),
    }));

  const current = summarise(currentRows);
  const previous = summarise(previousRows);

  return {
    timezone,
    period: { from: currentFrom, to: today },
    previousPeriod: { from: previousFrom, to: addDays(currentFrom, -1) },
    current,
    previous,
    spentChangePercent: percentChange(new Prisma.Decimal(current.spent), new Prisma.Decimal(previous.spent)),
    categories,
    topRecipients,
    largestSpend: largest
      ? {
          amount: money(largest.amount),
          date: largest.day,
          category: categoryOf(largest),
          recipient: largest.counterpartyName ? firstName(largest.counterpartyName) : null,
          recipientId: largest.counterpartyId,
          description: largest.description,
        }
      : null,
    regularPayments,
    unusualSpends,
    uncategorisedCount: currentSpends.filter((r) => r.category === null).length,
  };
};
