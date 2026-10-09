import { Prisma } from "@prisma/client";
import prisma from "../config/db";

const ZERO = new Prisma.Decimal(0);

type DailyRow = {
  day: string;
  moneyIn: Prisma.Decimal;
  moneyOut: Prisma.Decimal;
  sent: Prisma.Decimal;
  received: Prisma.Decimal;
};

export type PeriodTotals = {
  from: string;
  to: string;
  moneyIn: string;
  moneyOut: string;
  sent: string;
  received: string;
  net: string;
};

export type WalletStats = {
  days: number;
  timezone: string;
  current: PeriodTotals;
  previous: PeriodTotals;
  balance: {
    current: string;
    atPeriodStart: string;
    change: string;
    changePercent: number | null;
  };
  daily: { date: string; moneyIn: string; moneyOut: string }[];
};

// Calendar date (YYYY-MM-DD) of `now` in an IANA timezone
const localDate = (timezone: string, now: Date) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);

const addDays = (isoDate: string, n: number) => {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

const money = (value: Prisma.Decimal) => value.toFixed(2);

/**
 * Totals for the last `days` calendar days (including today) and the `days` before that,
 * bucketed by day in the caller's timezone.
 *
 * Counts SUCCESSFUL and REVERSED rows: a reversal marks the original REVERSED and records an
 * opposite SUCCESSFUL entry, so counting both makes a reversed transaction net to zero —
 * matching how the stored balance actually moved.
 */
export const getWalletStats = async (
  userId: string,
  days: number,
  timezone: string,
  now: Date = new Date()
): Promise<WalletStats> => {
  const today = localDate(timezone, now);
  const currentFrom = addDays(today, -(days - 1));
  const previousFrom = addDays(currentFrom, -days);
  // Coarse UTC bound lets Postgres skip old rows; the exact cut is on the local date (offsets are within ±14h)
  const coarseFrom = new Date(`${addDays(previousFrom, -1)}T00:00:00Z`);

  const [rows, wallet] = await Promise.all([
    prisma.$queryRaw<DailyRow[]>`
      SELECT
        to_char(local_day, 'YYYY-MM-DD') AS day,
        SUM(CASE WHEN type = 'CREDIT' THEN amount ELSE 0 END) AS "moneyIn",
        SUM(CASE WHEN type = 'DEBIT' THEN amount ELSE 0 END) AS "moneyOut",
        SUM(CASE WHEN type = 'DEBIT' AND "transferId" IS NOT NULL AND "reversalOf" IS NULL THEN amount ELSE 0 END) AS sent,
        SUM(CASE WHEN type = 'CREDIT' AND "transferId" IS NOT NULL AND "reversalOf" IS NULL THEN amount ELSE 0 END) AS received
      FROM (
        SELECT
          (("timestamp" AT TIME ZONE 'UTC') AT TIME ZONE ${timezone})::date AS local_day,
          type, amount, "transferId", "reversalOf"
        FROM "Transaction"
        WHERE "userId" = ${userId}
          AND status IN ('SUCCESSFUL', 'REVERSED')
          AND "timestamp" >= ${coarseFrom}
      ) t
      WHERE local_day >= ${previousFrom}::date
      GROUP BY local_day
    `,
    prisma.wallet.findUnique({ where: { userId }, select: { balance: true } }),
  ]);

  const byDay = new Map(rows.map((row) => [row.day, row]));
  const series = Array.from({ length: days * 2 }, (_, i) => {
    const date = addDays(previousFrom, i);
    const row = byDay.get(date);
    return {
      date,
      moneyIn: new Prisma.Decimal(row?.moneyIn ?? ZERO),
      moneyOut: new Prisma.Decimal(row?.moneyOut ?? ZERO),
      sent: new Prisma.Decimal(row?.sent ?? ZERO),
      received: new Prisma.Decimal(row?.received ?? ZERO),
    };
  });

  const totals = (from: string, slice: typeof series) => {
    const sum = (key: "moneyIn" | "moneyOut" | "sent" | "received") =>
      slice.reduce((acc, day) => acc.add(day[key]), ZERO);
    const moneyIn = sum("moneyIn");
    const moneyOut = sum("moneyOut");
    return {
      raw: { net: moneyIn.sub(moneyOut) },
      out: {
        from,
        to: slice[slice.length - 1].date,
        moneyIn: money(moneyIn),
        moneyOut: money(moneyOut),
        sent: money(sum("sent")),
        received: money(sum("received")),
        net: money(moneyIn.sub(moneyOut)),
      },
    };
  };

  const previous = totals(previousFrom, series.slice(0, days));
  const current = totals(currentFrom, series.slice(days));

  const balance = new Prisma.Decimal(wallet?.balance ?? ZERO);
  const atPeriodStart = balance.sub(current.raw.net);
  const changePercent = atPeriodStart.gt(0)
    ? Number(current.raw.net.div(atPeriodStart).mul(100).toFixed(2))
    : null;

  return {
    days,
    timezone,
    current: current.out,
    previous: previous.out,
    balance: {
      current: money(balance),
      atPeriodStart: money(atPeriodStart),
      change: money(current.raw.net),
      changePercent,
    },
    daily: series.map((day) => ({
      date: day.date,
      moneyIn: money(day.moneyIn),
      moneyOut: money(day.moneyOut),
    })),
  };
};
