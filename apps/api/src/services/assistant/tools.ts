import { Prisma, SpendingCategory, TransactionStatus, TransactionType } from "@prisma/client";
import { z } from "zod";
import prisma from "../../config/db";
import { CATEGORY_LABELS } from "../insights/categories";
import type { Pseudonymiser } from "../insights/pseudonymise";
import { naira, type InsightContent } from "../insights/writer";
import { getTransactionDetail } from "../statement.service";
import { HELP_TOPICS, type HelpTopic } from "./help";

// Everything here is read-only and scoped to ctx.userId, which comes from the session, never from
// the model. There is deliberately no tool that moves money or changes anything.

export type Contact = { userId: string; name: string; email: string; paidBefore: boolean };

export type ToolContext = {
  userId: string;
  timezone: string;
  today: string; // YYYY-MM-DD in the user's timezone
  pseudonyms: Pseudonymiser;
  contactsByAlias: Map<string, Contact>;
  aliasByUserId: Map<string, string>;
  // Short references ("t1") shown to the model instead of real transaction IDs
  refs: Map<string, string>;
  // Figures that appeared in tool results this turn: the only ones an answer may quote
  figures: { amounts: Set<string>; percents: Set<number> };
};

const MAX_RESULTS = 20;
const MAX_RANGE_DAYS = 366;

// ── helpers ────────────────────────────────────────────────────────────────

const money = (ctx: ToolContext, value: Prisma.Decimal | string | number) => {
  const decimal = new Prisma.Decimal(value);
  ctx.figures.amounts.add(decimal.toFixed(2));
  return naira(decimal.toFixed(2));
};

// Text that already contains figures (help answers, stored insights): its ₦ amounts and
// percentages become quotable too
const registerFigures = (ctx: ToolContext, text: string) => {
  for (const match of text.matchAll(/₦\s?([\d,]+(?:\.\d+)?)/g)) ctx.figures.amounts.add(new Prisma.Decimal(match[1].replace(/,/g, "")).toFixed(2));
  for (const match of text.matchAll(/(\d+(?:\.\d+)?)\s?%/g)) ctx.figures.percents.add(Number(match[1]));
  return text;
};

const ref = (ctx: ToolContext, transactionId: string) => {
  for (const [key, id] of ctx.refs) if (id === transactionId) return key;
  const key = `t${ctx.refs.size + 1}`;
  ctx.refs.set(key, transactionId);
  return key;
};

const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");

const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

// Defaults to the last 30 days; never longer than a year; never past today
const range = (ctx: ToolContext, from?: string, to?: string) => {
  const end = to && to <= ctx.today ? to : ctx.today;
  let start = from ?? addDays(end, -29);
  if (start > end) start = end;
  if (start < addDays(end, -(MAX_RANGE_DAYS - 1))) start = addDays(end, -(MAX_RANGE_DAYS - 1));
  return { from: start, to: end };
};

// The local calendar day of t."timestamp" (always qualified: some queries join Transaction to itself)
const localDay = (timezone: string) => Prisma.sql`((t."timestamp" AT TIME ZONE 'UTC') AT TIME ZONE ${timezone})::date`;

const humanDate = (date: Date, timezone: string) =>
  new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: timezone }).format(date);

const kindLabel = (tx: { type: TransactionType; transferId: string | null; reversalOf: string | null }, isWithdrawal: boolean) => {
  if (tx.reversalOf) return "refund or reversal";
  if (tx.transferId) return tx.type === TransactionType.CREDIT ? "money received from a person" : "money sent to a person";
  if (isWithdrawal) return "withdrawal to own bank account";
  return tx.type === TransactionType.CREDIT ? "deposit" : "payment";
};

// Which other user each transfer was with, for a set of transfer IDs
const counterparties = async (ctx: ToolContext, transferIds: string[]) => {
  if (transferIds.length === 0) return new Map<string, string>();
  const legs = await prisma.transaction.findMany({
    where: { transferId: { in: transferIds }, userId: { not: ctx.userId } },
    select: { transferId: true, userId: true },
  });
  return new Map(legs.map((leg) => [leg.transferId!, ctx.aliasByUserId.get(leg.userId) ?? "someone"]));
};

// ── tools ──────────────────────────────────────────────────────────────────

type Tool<S extends z.ZodType> = {
  description: string;
  schema: S;
  run: (ctx: ToolContext, args: z.infer<S>) => Promise<unknown>;
};
const tool = <S extends z.ZodType>(t: Tool<S>) => t;

export const TOOLS = {
  get_balance: tool({
    description: "The user's current wallet balance.",
    schema: z.object({}),
    run: async (ctx) => {
      const wallet = await prisma.wallet.findUnique({ where: { userId: ctx.userId }, select: { balance: true } });
      return { balance: money(ctx, wallet?.balance ?? 0) };
    },
  }),

  spending_summary: tool({
    description:
      "Totals for a date range (default: the last 30 days): money in, money spent, money withdrawn to the user's own bank, and spending by category. Use this for any total; never add amounts up yourself.",
    schema: z.object({ from: isoDay.optional(), to: isoDay.optional() }),
    run: async (ctx, args) => {
      const { from, to } = range(ctx, args.from, args.to);
      const day = localDay(ctx.timezone);
      const rows = await prisma.$queryRaw<{ type: TransactionType; category: SpendingCategory | null; isWithdrawal: boolean; total: Prisma.Decimal; n: number }[]>`
        SELECT t."type", t."category", (w."id" IS NOT NULL) AS "isWithdrawal", SUM(t."amount") AS "total", COUNT(*)::int AS "n"
        FROM "Transaction" t
        LEFT JOIN "Withdrawal" w ON w."debitTransactionId" = t."id"
        WHERE t."userId" = ${ctx.userId} AND t."status" = 'SUCCESSFUL' AND t."reversalOf" IS NULL
          AND ${day} BETWEEN ${from}::date AND ${to}::date
        GROUP BY 1, 2, 3
      `;
      const sum = (filter: (r: (typeof rows)[number]) => boolean) =>
        rows.filter(filter).reduce((acc, r) => acc.add(r.total), new Prisma.Decimal(0));
      const spends = rows.filter((r) => r.type === TransactionType.DEBIT && !r.isWithdrawal);
      const byCategory = new Map<string, Prisma.Decimal>();
      for (const r of spends) {
        const key = r.category ? CATEGORY_LABELS[r.category] : CATEGORY_LABELS.UNCATEGORISED;
        byCategory.set(key, (byCategory.get(key) ?? new Prisma.Decimal(0)).add(r.total));
      }
      return {
        from,
        to,
        moneyIn: money(ctx, sum((r) => r.type === TransactionType.CREDIT)),
        spent: money(ctx, sum((r) => r.type === TransactionType.DEBIT && !r.isWithdrawal)),
        withdrawnToOwnBank: money(ctx, sum((r) => r.type === TransactionType.DEBIT && r.isWithdrawal)),
        numberOfPayments: spends.reduce((n, r) => n + r.n, 0),
        spendingByCategory: [...byCategory.entries()]
          .sort(([, a], [, b]) => b.comparedTo(a))
          .map(([category, total]) => ({ category, total: money(ctx, total) })),
      };
    },
  }),

  search_transactions: tool({
    description:
      "Find the user's transactions, newest first (at most 20). Filter by words in the note, category, direction (in = money received, out = money spent or sent), a person (their placeholder, e.g. 'Person A'), dates and amounts. Also returns how many matched and the total of the completed ones.",
    schema: z.object({
      text: z.string().max(100).optional(),
      category: z.enum(SpendingCategory).optional(),
      direction: z.enum(["in", "out"]).optional(),
      person: z.string().max(40).optional(),
      from: isoDay.optional(),
      to: isoDay.optional(),
      minAmount: z.number().nonnegative().optional(),
      maxAmount: z.number().nonnegative().optional(),
      limit: z.number().int().min(1).max(MAX_RESULTS).optional(),
    }),
    run: async (ctx, args) => {
      const where: Prisma.TransactionWhereInput = { userId: ctx.userId };
      if (args.text) where.description = { contains: args.text, mode: "insensitive" };
      if (args.category) where.category = args.category;
      if (args.direction) where.type = args.direction === "in" ? TransactionType.CREDIT : TransactionType.DEBIT;
      if (args.minAmount !== undefined || args.maxAmount !== undefined) where.amount = { gte: args.minAmount, lte: args.maxAmount };
      if (args.from || args.to) {
        const { from, to } = range(ctx, args.from, args.to);
        // Whole local days, padded by the largest timezone offset and then trimmed exactly below
        where.timestamp = { gte: new Date(`${addDays(from, -1)}T00:00:00Z`), lt: new Date(`${addDays(to, 2)}T00:00:00Z`) };
      }
      if (args.person) {
        const contact = ctx.contactsByAlias.get(args.person.trim());
        if (!contact) return { matched: 0, transactions: [], note: `No one called ${args.person} in this user's transactions` };
        const theirLegs = await prisma.transaction.findMany({
          where: { userId: contact.userId, transferId: { not: null } },
          select: { transferId: true },
        });
        where.transferId = { in: theirLegs.map((l) => l.transferId!) };
      }

      let rows = await prisma.transaction.findMany({ where, orderBy: [{ timestamp: "desc" }, { id: "desc" }], take: 500 });
      if (args.from || args.to) {
        const { from, to } = range(ctx, args.from, args.to);
        const local = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: ctx.timezone }).format(d);
        rows = rows.filter((r) => local(r.timestamp) >= from && local(r.timestamp) <= to);
      }

      const completed = rows.filter((r) => r.status === TransactionStatus.SUCCESSFUL && !r.reversalOf);
      const shown = rows.slice(0, args.limit ?? 10);
      const withdrawals = new Set(
        (await prisma.withdrawal.findMany({ where: { debitTransactionId: { in: shown.map((r) => r.id) } }, select: { debitTransactionId: true } })).map(
          (w) => w.debitTransactionId
        )
      );
      const people = await counterparties(ctx, shown.flatMap((r) => (r.transferId ? [r.transferId] : [])));

      return {
        matched: rows.length,
        totalOfCompletedMatches: money(ctx, completed.reduce((acc, r) => acc.add(r.amount), new Prisma.Decimal(0))),
        showing: shown.length,
        transactions: shown.map((r) => ({
          ref: ref(ctx, r.id),
          date: humanDate(r.timestamp, ctx.timezone),
          direction: r.type === TransactionType.CREDIT ? "in" : "out",
          kind: kindLabel(r, withdrawals.has(r.id)),
          amount: money(ctx, r.amount),
          status: r.status.toLowerCase(),
          note: ctx.pseudonyms.scrub(r.description) || null,
          category: r.category ? CATEGORY_LABELS[r.category] : null,
          person: r.transferId ? (people.get(r.transferId) ?? null) : null,
        })),
      };
    },
  }),

  get_transaction: tool({
    description: "Full detail of one transaction by its ref (e.g. 't3'), including why a withdrawal or deposit failed.",
    schema: z.object({ ref: z.string() }),
    run: async (ctx, args) => {
      const id = ctx.refs.get(args.ref);
      if (!id) return { error: "Unknown ref. Search for the transaction first." };
      const detail = await getTransactionDetail(ctx.userId, id);
      const tx = detail.transaction;
      const people = await counterparties(ctx, tx.transferId ? [tx.transferId] : []);
      return {
        ref: args.ref,
        kind: kindLabel(tx, Boolean(detail.withdrawal && detail.withdrawal.reference)),
        amount: money(ctx, tx.amount),
        status: tx.status.toLowerCase(),
        date: humanDate(tx.timestamp, ctx.timezone),
        note: ctx.pseudonyms.scrub(tx.description) || null,
        category: tx.category ? CATEGORY_LABELS[tx.category] : null,
        person: tx.transferId ? (people.get(tx.transferId) ?? null) : null,
        withdrawal: detail.withdrawal && {
          bank: `${detail.withdrawal.bankAccount.bankName} ending ${detail.withdrawal.bankAccount.accountNumberLast4}`,
          status: detail.withdrawal.status.toLowerCase(),
          failureReason: detail.withdrawal.failureReason,
          refunded: ["FAILED", "REVERSED"].includes(detail.withdrawal.status),
        },
        deposit: detail.deposit && { paidWith: detail.deposit.channel },
        reversed: Boolean(detail.reversedBy),
      };
    },
  }),

  top_people: tool({
    description: "The people the user sent the most money to (direction 'out') or received the most from ('in') in a date range (default: the last 30 days).",
    schema: z.object({ direction: z.enum(["in", "out"]).optional(), from: isoDay.optional(), to: isoDay.optional() }),
    run: async (ctx, args) => {
      const { from, to } = range(ctx, args.from, args.to);
      const type = args.direction === "in" ? TransactionType.CREDIT : TransactionType.DEBIT;
      const rows = await prisma.$queryRaw<{ userId: string; total: Prisma.Decimal; n: number }[]>`
        SELECT cp."userId", SUM(t."amount") AS "total", COUNT(*)::int AS "n"
        FROM "Transaction" t
        JOIN "Transaction" cp ON cp."transferId" = t."transferId" AND cp."id" <> t."id"
        WHERE t."userId" = ${ctx.userId} AND t."type"::text = ${type} AND t."status" = 'SUCCESSFUL' AND t."reversalOf" IS NULL
          AND ${localDay(ctx.timezone)} BETWEEN ${from}::date AND ${to}::date
        GROUP BY cp."userId"
        ORDER BY 2 DESC
        LIMIT 5
      `;
      return {
        from,
        to,
        people: rows.map((r) => ({ person: ctx.aliasByUserId.get(r.userId) ?? "someone", total: money(ctx, r.total), payments: r.n })),
      };
    },
  }),

  get_insights: tool({
    description: "The user's latest monthly spending insights, if they have any.",
    schema: z.object({}),
    run: async (ctx) => {
      const insight = await prisma.spendingInsight.findUnique({ where: { userId: ctx.userId } });
      if (!insight) return { available: false };
      const content = insight.content as unknown as InsightContent;
      const scrub = (text: string) => ctx.pseudonyms.scrub(registerFigures(ctx, text));
      return {
        available: true,
        period: `${insight.periodFrom} to ${insight.periodTo}`,
        headline: scrub(content.headline),
        insights: content.insights.map((i) => `${scrub(i.title)}: ${scrub(i.body)}`),
      };
    },
  }),

  app_help: tool({
    description: "How PurpleWallet works: limits, PIN, deposits, withdrawals, statements, security. Use it for any question about the app instead of guessing.",
    schema: z.object({ topic: z.enum(Object.keys(HELP_TOPICS) as [HelpTopic, ...HelpTopic[]]) }),
    run: async (ctx, args) => ({ topic: args.topic, answer: registerFigures(ctx, HELP_TOPICS[args.topic]) }),
  }),
} as const;

export type ToolName = keyof typeof TOOLS;

// The final answer. Calling it ends the turn.
export const respondSchema = z.object({
  answer: z.string().min(1).max(1200),
  transactionRefs: z.array(z.string()).max(10).optional(),
  action: z
    .object({
      type: z.enum(["send_money", "withdraw"]),
      person: z.string().max(40).optional(),
      amount: z.number().positive().optional(),
    })
    .optional(),
});

export const RESPOND_DESCRIPTION =
  "Give the final answer. Optionally list the refs of transactions it's about (shown to the user as evidence) and an action button: send_money (to a person, with an amount) or withdraw (an amount) when the user asks to do that. The user still reviews and confirms with their PIN.";
