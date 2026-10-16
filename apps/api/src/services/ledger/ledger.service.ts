import { JournalEntryType, LedgerAccountType, Prisma } from "@prisma/client";
import prisma from "../../config/db";

/**
 * The double-entry ledger. Every money movement posts one journal entry whose lines sum to zero,
 * in the same database transaction as the movement itself. Amounts are signed: a debit is
 * positive, a credit negative. Assets (Paystack clearing) grow with debits; liabilities (user
 * wallets, payouts in transit) grow with credits. The database enforces that every entry
 * balances and that nothing is edited or deleted (see the ledger migration).
 */

export const SYSTEM_ACCOUNTS = {
  PAYSTACK_CLEARING: "paystack_clearing", // money held at Paystack
  PAYOUTS_IN_TRANSIT: "payouts_in_transit", // withdrawals sent to banks, not yet confirmed
  ADJUSTMENTS: "adjustments", // refunds, goodwill and corrections decided by admins
  DEV_FUNDING: "dev_funding", // money created by the development-only credit/debit endpoints
  OPENING_BALANCES: "opening_balances", // balances that existed before the ledger started
} as const;

export type SystemAccount = (typeof SYSTEM_ACCOUNTS)[keyof typeof SYSTEM_ACCOUNTS];
type Tx = Prisma.TransactionClient;
type AccountRef = SystemAccount | { wallet: string };

// System accounts never change once the migration creates them
const systemIds = new Map<string, string>();

const accountId = async (tx: Tx, ref: AccountRef): Promise<string> => {
  if (typeof ref === "string") {
    const cached = systemIds.get(ref);
    if (cached) return cached;
    const account = await tx.ledgerAccount.findUniqueOrThrow({ where: { code: ref }, select: { id: true } });
    systemIds.set(ref, account.id);
    return account.id;
  }
  // A user's wallet account, created on their first posting
  const user = await tx.user.findUniqueOrThrow({ where: { id: ref.wallet }, select: { name: true } });
  const account = await tx.ledgerAccount.upsert({
    where: { code: `wallet:${ref.wallet}` },
    update: {},
    create: { code: `wallet:${ref.wallet}`, name: `Wallet: ${user.name}`, type: LedgerAccountType.LIABILITY, userId: ref.wallet },
    select: { id: true },
  });
  return account.id;
};

export type Movement = {
  type: JournalEntryType;
  description: string;
  amount: Prisma.Decimal | number | string;
  // Money moves from the debited account's side to the credited one: e.g. a deposit debits
  // Paystack clearing (we now hold the money) and credits the user's wallet (we owe it to them)
  debit: AccountRef;
  credit: AccountRef;
  reference?: string | null;
  transactionId?: string | null;
  createdById?: string | null;
};

/** Posts a two-line entry. Must be called inside the transaction that moves the money. */
export const post = async (tx: Tx, movement: Movement) => {
  const amount = new Prisma.Decimal(movement.amount);
  if (amount.lte(0)) throw new Error("Ledger amounts must be positive");
  const [debitId, creditId] = await Promise.all([accountId(tx, movement.debit), accountId(tx, movement.credit)]);
  return tx.journalEntry.create({
    data: {
      type: movement.type,
      description: movement.description,
      reference: movement.reference ?? null,
      transactionId: movement.transactionId ?? null,
      createdById: movement.createdById ?? null,
      lines: {
        create: [
          { accountId: debitId, amount },
          { accountId: creditId, amount: amount.neg() },
        ],
      },
    },
  });
};

/**
 * Posts the mirror image of an earlier entry (every line negated), for reversals. Returns null
 * when the original predates the ledger: the caller then posts against opening balances.
 */
export const postReversal = async (tx: Tx, original: { transactionId?: string; reference?: string }, description: string, transactionId?: string) => {
  const entry = await tx.journalEntry.findFirst({
    where: original.reference ? { reference: original.reference, type: { not: JournalEntryType.REVERSAL } } : { transactionId: original.transactionId },
    include: { lines: true },
  });
  if (!entry) return null;
  return tx.journalEntry.create({
    data: {
      type: JournalEntryType.REVERSAL,
      description,
      reference: entry.reference,
      transactionId: transactionId ?? null,
      lines: { create: entry.lines.map((line) => ({ accountId: line.accountId, amount: new Prisma.Decimal(line.amount).neg() })) },
    },
  });
};

// ── Reading the ledger ──────────────────────────────────────────────────────

/** A wallet's balance according to the ledger (a liability: minus the sum of its lines). */
export const walletLedgerBalance = async (userId: string): Promise<Prisma.Decimal> => {
  const result = await prisma.ledgerLine.aggregate({ where: { account: { userId } }, _sum: { amount: true } });
  return new Prisma.Decimal(result._sum.amount ?? 0).neg();
};

/**
 * Every account's balance, shown the natural way round (assets positive when we hold money,
 * liabilities positive when we owe it), and the trial balance: the sum of every line, which the
 * database guarantees is zero.
 */
export const ledgerSummary = async () => {
  const rows = await prisma.$queryRaw<{ code: string; name: string; type: LedgerAccountType; total: Prisma.Decimal | null }[]>`
    SELECT a."code", a."name", a."type", SUM(l."amount") AS "total"
    FROM "LedgerAccount" a
    LEFT JOIN "LedgerLine" l ON l."accountId" = a."id"
    WHERE a."userId" IS NULL
    GROUP BY a."code", a."name", a."type"
    ORDER BY a."type", a."code"
  `;
  const [wallets] = await prisma.$queryRaw<{ total: Prisma.Decimal | null; n: number }[]>`
    SELECT SUM(l."amount") AS "total", COUNT(DISTINCT a."id")::int AS "n"
    FROM "LedgerAccount" a JOIN "LedgerLine" l ON l."accountId" = a."id"
    WHERE a."userId" IS NOT NULL
  `;
  const [trial] = await prisma.$queryRaw<{ total: Prisma.Decimal | null }[]>`SELECT SUM("amount") AS "total" FROM "LedgerLine"`;

  const natural = (type: LedgerAccountType, total: Prisma.Decimal | null) => {
    const value = new Prisma.Decimal(total ?? 0);
    return (type === LedgerAccountType.ASSET ? value : value.neg()).toFixed(2);
  };
  return {
    accounts: rows.map((r) => ({ code: r.code, name: r.name, type: r.type, balance: natural(r.type, r.total) })),
    userWallets: { count: wallets?.n ?? 0, balance: new Prisma.Decimal(wallets?.total ?? 0).neg().toFixed(2) },
    trialBalance: new Prisma.Decimal(trial?.total ?? 0).toFixed(2),
  };
};

/** Journal entries, newest first, with their lines; optionally only one type or one user's wallet. */
export const listJournalEntries = async ({ type, userId, limit, cursor }: { type?: JournalEntryType; userId?: string; limit: number; cursor?: string }) => {
  const rows = await prisma.journalEntry.findMany({
    where: { ...(type ? { type } : {}), ...(userId ? { lines: { some: { account: { userId } } } } : {}) },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    include: { lines: { include: { account: { select: { code: true, name: true, type: true, userId: true } } } } },
  });
  const items = rows.slice(0, limit).map((entry) => ({
    ...entry,
    lines: entry.lines
      .map((line) => ({
        account: line.account,
        // Shown the accountant's way: which side of the entry the line is on
        debit: new Prisma.Decimal(line.amount).gt(0) ? new Prisma.Decimal(line.amount).toFixed(2) : null,
        credit: new Prisma.Decimal(line.amount).lt(0) ? new Prisma.Decimal(line.amount).neg().toFixed(2) : null,
      }))
      .sort((a, b) => (a.debit ? -1 : 1) - (b.debit ? -1 : 1)),
  }));
  return { items, nextCursor: rows.length > limit ? items[items.length - 1].id : null };
};

/** Wallets whose stored balance disagrees with their ledger account. Should always be empty. */
export const walletsOffLedger = () =>
  prisma.$queryRaw<{ userId: string; name: string; email: string; stored: Prisma.Decimal; ledger: Prisma.Decimal }[]>`
    SELECT w."userId", u."name", u."email", w."balance" AS "stored", COALESCE(-SUM(l."amount"), 0) AS "ledger"
    FROM "Wallet" w
    JOIN "User" u ON u."id" = w."userId"
    LEFT JOIN "LedgerAccount" a ON a."userId" = w."userId"
    LEFT JOIN "LedgerLine" l ON l."accountId" = a."id"
    GROUP BY w."userId", u."name", u."email", w."balance"
    HAVING w."balance" <> COALESCE(-SUM(l."amount"), 0)
    LIMIT 200
  `;
