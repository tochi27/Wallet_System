import { AccountTier, DepositStatus, Prisma, Role, WithdrawalStatus } from "@prisma/client";
import prisma from "../../config/db";
import { TIER_LIMITS } from "../../config/limits";
import { notify } from "../notifications/notification.service";
import { confirmDeposit } from "../payments/deposit.service";
import { fetchBalance, fromSubunit, isPaystackConfigured, PaystackError } from "../payments/paystack.client";
import { confirmWithdrawal } from "../payments/withdrawal.service";
import { computeBalance } from "../wallet.service";
import { ledgerSummary, SYSTEM_ACCOUNTS, walletLedgerBalance, walletsOffLedger } from "../ledger/ledger.service";

// A payment still pending or processing after this long needs a human to look at it
export const STUCK_AFTER_MINUTES = 30;
// Webhook events are retried by reconciliation after 5 minutes; older than that and still
// unprocessed means something is wrong
const UNPROCESSED_EVENT_MINUTES = 5;

/** Problems with an admin request carry their own status. Never 401, which signs the admin out. */
export class AdminActionError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "AdminActionError";
    this.status = status;
  }
}

const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000);
const money = (value: Prisma.Decimal | number | string | null | undefined) =>
  new Prisma.Decimal(value ?? 0).toFixed(2);

export type Page<T> = { items: T[]; nextCursor: string | null };

// Fetch one row more than asked for: if it exists, there's another page
const toPage = <T extends { id: string }>(rows: T[], limit: number): Page<T> => {
  const items = rows.slice(0, limit);
  return { items, nextCursor: rows.length > limit ? items[items.length - 1].id : null };
};
const pageArgs = (limit: number, cursor?: string) => ({
  take: limit + 1,
  ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
});

type Audit = {
  adminId: string;
  action: string;
  targetType: "User" | "Deposit" | "Withdrawal";
  targetId: string;
  reason: string;
  details?: Prisma.InputJsonValue;
};
const audit = (tx: Prisma.TransactionClient, entry: Audit) => tx.adminAuditLog.create({ data: entry });

// ---------- Overview ----------

export const getOverview = async () => {
  const dayAgo = minutesAgo(24 * 60);
  const [users, frozen, admins, held, deposits, withdrawals, stuckDeposits, stuckWithdrawals, unprocessedEvents, mismatches] =
    await Promise.all([
      prisma.user.count(),
      prisma.user.count({ where: { frozenAt: { not: null } } }),
      prisma.user.count({ where: { role: { not: Role.USER } } }),
      prisma.wallet.aggregate({ _sum: { balance: true } }),
      prisma.deposit.aggregate({
        where: { status: DepositStatus.SUCCESSFUL, paidAt: { gte: dayAgo } },
        _sum: { amount: true },
        _count: true,
      }),
      prisma.withdrawal.aggregate({
        where: { status: WithdrawalStatus.SUCCESSFUL, completedAt: { gte: dayAgo } },
        _sum: { amount: true },
        _count: true,
      }),
      prisma.deposit.count({ where: { status: DepositStatus.PENDING, createdAt: { lt: minutesAgo(STUCK_AFTER_MINUTES) } } }),
      prisma.withdrawal.count({
        where: { status: WithdrawalStatus.PROCESSING, createdAt: { lt: minutesAgo(STUCK_AFTER_MINUTES) } },
      }),
      prisma.paystackEvent.count({ where: { processedAt: null, receivedAt: { lt: minutesAgo(UNPROCESSED_EVENT_MINUTES) } } }),
      findBalanceMismatches().then((rows) => rows.length),
    ]);
  const [pendingAdjustments, pendingVerifications, offLedger] = await Promise.all([
    prisma.adjustment.count({ where: { status: "PENDING" } }),
    prisma.tierUpgradeRequest.count({ where: { status: "PENDING" } }),
    walletsOffLedger().then((rows) => rows.length),
  ]);

  return {
    users: { total: users, frozen, admins },
    totalHeld: money(held._sum.balance),
    last24Hours: {
      deposits: { count: deposits._count, amount: money(deposits._sum.amount) },
      withdrawals: { count: withdrawals._count, amount: money(withdrawals._sum.amount) },
    },
    attention: { stuckDeposits, stuckWithdrawals, unprocessedEvents, balanceMismatches: mismatches + offLedger, pendingAdjustments, pendingVerifications },
  };
};

// ---------- Users ----------

export const searchUsers = async (search: string | undefined, limit: number, cursor?: string) => {
  const term = search?.trim();
  const rows = await prisma.user.findMany({
    where: term
      ? {
          OR: [
            { email: { contains: term, mode: "insensitive" } },
            { name: { contains: term, mode: "insensitive" } },
            { id: term },
          ],
        }
      : {},
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    ...pageArgs(limit, cursor),
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      createdAt: true,
      frozenAt: true,
      wallet: { select: { balance: true } },
    },
  });
  const page = toPage(rows, limit);
  return {
    ...page,
    items: page.items.map(({ wallet, ...user }) => ({ ...user, balance: money(wallet?.balance) })),
  };
};

/** Everything support needs about one user. Never the password or PIN hash, or full account numbers. */
export const getUserDetail = async (userId: string) => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      createdAt: true,
      emailNotifications: true,
      passwordChangedAt: true,
      frozenAt: true,
      frozenReason: true,
      emailVerifiedAt: true,
      tier: true,
      transactionPinHash: true,
      pinFailedAttempts: true,
      pinLockedUntil: true,
      wallet: { select: { balance: true } },
    },
  });
  if (!user) throw new AdminActionError("User not found", 404);

  const [computed, ledgerBalance, adjustments, transactions, deposits, withdrawals, bankAccounts, devices, auditLog] = await Promise.all([
    computeBalance(userId),
    walletLedgerBalance(userId),
    prisma.adjustment.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 10,
      include: { requestedBy: { select: { name: true } }, decidedBy: { select: { name: true } } },
    }),
    prisma.transaction.findMany({
      where: { userId },
      orderBy: [{ timestamp: "desc" }, { id: "desc" }],
      take: 20,
      select: { id: true, type: true, status: true, amount: true, description: true, timestamp: true },
    }),
    prisma.deposit.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: { reference: true, amount: true, status: true, channel: true, failureReason: true, createdAt: true, paidAt: true },
    }),
    prisma.withdrawal.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: {
        reference: true,
        amount: true,
        status: true,
        failureReason: true,
        createdAt: true,
        completedAt: true,
        bankAccount: { select: { bankName: true, accountNumberLast4: true, accountName: true } },
      },
    }),
    prisma.bankAccount.findMany({
      where: { userId, isActive: true },
      orderBy: { createdAt: "desc" },
      select: { id: true, bankName: true, accountNumberLast4: true, accountName: true, createdAt: true },
    }),
    prisma.knownDevice.findMany({
      where: { userId },
      orderBy: { lastSeenAt: "desc" },
      take: 10,
      select: { label: true, lastSeenAt: true, createdAt: true },
    }),
    listAuditLog({ targetId: userId, limit: 10 }).then((page) => page.items),
  ]);

  const { transactionPinHash, pinLockedUntil, wallet, ...profile } = user;
  const stored = new Prisma.Decimal(wallet?.balance ?? 0);
  return {
    ...profile,
    hasPin: transactionPinHash !== null,
    pinLockedUntil: pinLockedUntil && pinLockedUntil > new Date() ? pinLockedUntil : null,
    // Three-way check: stored balance, the sum of transactions, and the ledger must all agree
    balance: {
      stored: money(stored),
      computed: money(computed),
      ledger: money(ledgerBalance),
      matches: stored.equals(computed) && stored.equals(ledgerBalance),
    },
    adjustments: adjustments.map((a) => ({ ...a, amount: money(a.amount) })),
    transactions: transactions.map((t) => ({ ...t, amount: money(t.amount) })),
    deposits: deposits.map((d) => ({ ...d, amount: money(d.amount) })),
    withdrawals: withdrawals.map((w) => ({ ...w, amount: money(w.amount) })),
    bankAccounts,
    devices,
    auditLog,
  };
};

const loadTarget = async (userId: string) => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, role: true, tier: true, frozenAt: true, pinLockedUntil: true, pinFailedAttempts: true },
  });
  if (!user) throw new AdminActionError("User not found", 404);
  return user;
};

/** Stops money leaving the account. The user can still sign in, see their wallet and receive money. */
export const freezeUser = async (adminId: string, userId: string, reason: string) => {
  if (adminId === userId) throw new AdminActionError("You can't freeze your own account", 400);
  const target = await loadTarget(userId);
  if (target.role !== Role.USER) throw new AdminActionError("Staff accounts can't be frozen. Remove their staff role first.", 400);

  await prisma.$transaction(async (tx) => {
    // Conditional update, so two admins freezing at once record one freeze, not two
    const { count } = await tx.user.updateMany({
      where: { id: userId, frozenAt: null },
      data: { frozenAt: new Date(), frozenReason: reason },
    });
    if (count === 0) throw new AdminActionError("This account is already frozen", 409);
    await audit(tx, { adminId, action: "user.freeze", targetType: "User", targetId: userId, reason });
  });

  // The internal reason stays internal: it may describe a fraud investigation
  await notify({
    userId,
    type: "security.account_frozen",
    title: "Your account is on hold",
    body: "We've put your account on hold, so you can't send or withdraw money for now. You can still sign in, see your wallet and receive money. Please contact support.",
    actionPath: "/wallet",
  });
};

export const unfreezeUser = async (adminId: string, userId: string, reason: string) => {
  await loadTarget(userId);
  await prisma.$transaction(async (tx) => {
    const { count } = await tx.user.updateMany({
      where: { id: userId, frozenAt: { not: null } },
      data: { frozenAt: null, frozenReason: null },
    });
    if (count === 0) throw new AdminActionError("This account isn't frozen", 409);
    await audit(tx, { adminId, action: "user.unfreeze", targetType: "User", targetId: userId, reason });
  });

  await notify({
    userId,
    type: "security.account_unfrozen",
    title: "Your account is active again",
    body: "The hold on your account has been lifted. You can send and withdraw money again.",
    actionPath: "/wallet",
  });
};

const TIER_NAMES: Record<AccountTier, string> = { TIER_1: "Tier 1", TIER_2: "Tier 2" };
const naira = new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", maximumFractionDigits: 0 });

/**
 * Moves a user to another tier, which changes how much they can send, withdraw and hold. Staff
 * do this once they've checked who the user is (until there's an ID-check provider).
 */
export const setUserTier = async (adminId: string, userId: string, tier: AccountTier, reason: string) => {
  if (adminId === userId) throw new AdminActionError("You can't change your own tier. Ask another admin.", 400);
  const target = await loadTarget(userId);

  await prisma.$transaction(async (tx) => {
    // Conditional update, so two admins changing it at once record one change, not two
    const { count } = await tx.user.updateMany({ where: { id: userId, tier: { not: tier } }, data: { tier } });
    if (count === 0) throw new AdminActionError(`This account is already on ${TIER_NAMES[tier]}`, 409);
    await audit(tx, {
      adminId,
      action: "user.tier_change",
      targetType: "User",
      targetId: userId,
      reason,
      details: { from: target.tier, to: tier },
    });
  });

  const limits = TIER_LIMITS[tier];
  const cap = limits.maxBalance === null ? "no limit on your balance" : `a balance of up to ${naira.format(limits.maxBalance)}`;
  await notify({
    userId,
    type: "account.tier_changed",
    title: "Your limits have changed",
    body: `Your account is now ${TIER_NAMES[tier]}: up to ${naira.format(limits.perTransaction)} per payment, ${naira.format(limits.dailyOut)} a day, and ${cap}.`,
    actionPath: "/settings",
  });
};

/** Clears a transaction PIN lockout, e.g. after support has confirmed who the user is. */
export const unlockPin = async (adminId: string, userId: string, reason: string) => {
  const target = await loadTarget(userId);
  const locked = target.pinLockedUntil !== null && target.pinLockedUntil > new Date();
  if (!locked) throw new AdminActionError("This user's PIN isn't locked", 409);

  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: userId }, data: { pinFailedAttempts: 0, pinLockedUntil: null } });
    await audit(tx, { adminId, action: "user.unlock_pin", targetType: "User", targetId: userId, reason });
  });

  await notify({
    userId,
    type: "security.pin_unlocked",
    title: "Transfers and withdrawals unlocked",
    body: "Support has unlocked your transaction PIN, so you can send and withdraw money again. If you didn't ask for this, change your password and PIN now.",
    actionPath: "/settings",
  });
};

// ---------- Payments ----------

type PaymentFilter = { status?: string; stuck?: boolean; search?: string; limit: number; cursor?: string };

const userSummary = { select: { id: true, name: true, email: true } } as const;

export const listDeposits = async ({ status, stuck, search, limit, cursor }: PaymentFilter) => {
  const where: Prisma.DepositWhereInput = stuck
    ? { status: DepositStatus.PENDING, createdAt: { lt: minutesAgo(STUCK_AFTER_MINUTES) } }
    : status
      ? { status: status as DepositStatus }
      : {};
  if (search?.trim()) where.reference = { contains: search.trim(), mode: "insensitive" };

  const rows = await prisma.deposit.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    ...pageArgs(limit, cursor),
    select: {
      id: true,
      reference: true,
      amount: true,
      status: true,
      channel: true,
      failureReason: true,
      createdAt: true,
      paidAt: true,
      user: userSummary,
    },
  });
  const page = toPage(rows, limit);
  return { ...page, items: page.items.map((d) => ({ ...d, amount: money(d.amount) })) };
};

export const listWithdrawals = async ({ status, stuck, search, limit, cursor }: PaymentFilter) => {
  const where: Prisma.WithdrawalWhereInput = stuck
    ? { status: WithdrawalStatus.PROCESSING, createdAt: { lt: minutesAgo(STUCK_AFTER_MINUTES) } }
    : status
      ? { status: status as WithdrawalStatus }
      : {};
  if (search?.trim()) where.reference = { contains: search.trim(), mode: "insensitive" };

  const rows = await prisma.withdrawal.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    ...pageArgs(limit, cursor),
    select: {
      id: true,
      reference: true,
      amount: true,
      status: true,
      failureReason: true,
      createdAt: true,
      completedAt: true,
      user: userSummary,
      bankAccount: { select: { bankName: true, accountNumberLast4: true, accountName: true } },
    },
  });
  const page = toPage(rows, limit);
  return { ...page, items: page.items.map((w) => ({ ...w, amount: money(w.amount) })) };
};

const paystackFailure = (error: unknown): never => {
  if (error instanceof PaystackError) throw new AdminActionError(`Paystack: ${error.message}`, 502);
  throw error;
};

/**
 * Asks Paystack for the deposit's latest status. Settlement goes through the same exactly-once
 * code as the webhook, so rechecking any number of times can't credit twice.
 */
export const recheckDeposit = async (adminId: string, reference: string) => {
  const before = await prisma.deposit.findUnique({ where: { reference }, select: { id: true, status: true } });
  if (!before) throw new AdminActionError("Deposit not found", 404);

  const after = await confirmDeposit(reference).catch(paystackFailure);
  await prisma.$transaction((tx) =>
    audit(tx, {
      adminId,
      action: "deposit.recheck",
      targetType: "Deposit",
      targetId: before.id,
      reason: "Manual status check",
      details: { reference, before: before.status, after: after.status },
    })
  );
  return { reference, before: before.status, after: after.status };
};

/** Same as recheckDeposit, for withdrawals: a failed transfer is refunded exactly once. */
export const recheckWithdrawal = async (adminId: string, reference: string) => {
  const before = await prisma.withdrawal.findUnique({ where: { reference }, select: { id: true, status: true } });
  if (!before) throw new AdminActionError("Withdrawal not found", 404);

  const after = await confirmWithdrawal(reference).catch(paystackFailure);
  await prisma.$transaction((tx) =>
    audit(tx, {
      adminId,
      action: "withdrawal.recheck",
      targetType: "Withdrawal",
      targetId: before.id,
      reason: "Manual status check",
      details: { reference, before: before.status, after: after.status },
    })
  );
  return { reference, before: before.status, after: after.status };
};

// ---------- Paystack events ----------

export const listPaystackEvents = async (filter: {
  processed?: boolean;
  event?: string;
  search?: string;
  limit: number;
  cursor?: string;
}) => {
  const where: Prisma.PaystackEventWhereInput = {};
  if (filter.processed !== undefined) where.processedAt = filter.processed ? { not: null } : null;
  if (filter.event) where.event = filter.event;
  if (filter.search?.trim()) where.reference = { contains: filter.search.trim(), mode: "insensitive" };

  const rows = await prisma.paystackEvent.findMany({
    where,
    orderBy: [{ receivedAt: "desc" }, { id: "desc" }],
    ...pageArgs(filter.limit, filter.cursor),
    select: { id: true, event: true, reference: true, receivedAt: true, processedAt: true },
  });
  return toPage(rows, filter.limit);
};

export const getPaystackEvent = async (id: string) => {
  const event = await prisma.paystackEvent.findUnique({ where: { id } });
  if (!event) throw new AdminActionError("Event not found", 404);
  return event;
};

// ---------- Reconciliation ----------

type MismatchRow = { userId: string; name: string; email: string; stored: Prisma.Decimal; computed: Prisma.Decimal };

/**
 * Wallets whose stored balance differs from the sum of their completed transactions. Reversed
 * transactions count too: a reversal marks the original REVERSED and adds an opposite entry.
 */
const findBalanceMismatches = () =>
  // Same rule as computeBalance: a wallet with an opening-balance entry starts from it and counts
  // only later transactions; any other wallet counts its whole history
  prisma.$queryRaw<MismatchRow[]>`
    WITH opening AS (
      SELECT a."userId", -l."amount" AS "amount", e."createdAt" AS "since"
      FROM "LedgerLine" l
      JOIN "LedgerAccount" a ON a."id" = l."accountId"
      JOIN "JournalEntry" e ON e."id" = l."entryId"
      WHERE e."type" = 'OPENING_BALANCE' AND a."userId" IS NOT NULL
    )
    SELECT w."userId", u."name", u."email", w."balance" AS "stored",
           COALESCE(o."amount", 0) + COALESCE(SUM(CASE WHEN t."type" = 'CREDIT' THEN t."amount" ELSE -t."amount" END), 0) AS "computed"
    FROM "Wallet" w
    JOIN "User" u ON u."id" = w."userId"
    LEFT JOIN opening o ON o."userId" = w."userId"
    LEFT JOIN "Transaction" t ON t."userId" = w."userId"
      AND t."status" IN ('SUCCESSFUL', 'REVERSED')
      AND (o."since" IS NULL OR t."timestamp" > o."since")
    GROUP BY w."userId", u."name", u."email", w."balance", o."amount"
    HAVING w."balance" <> COALESCE(o."amount", 0) + COALESCE(SUM(CASE WHEN t."type" = 'CREDIT' THEN t."amount" ELSE -t."amount" END), 0)
    ORDER BY u."email"
    LIMIT 200`;

export const getReconciliation = async () => {
  const [mismatches, held, wallets, ledger, offLedger] = await Promise.all([
    findBalanceMismatches(),
    prisma.wallet.aggregate({ _sum: { balance: true } }),
    prisma.wallet.count(),
    ledgerSummary(),
    walletsOffLedger(),
  ]);

  let paystack: { available: true; balance: string } | { available: false; message: string };
  if (!isPaystackConfigured()) {
    paystack = { available: false, message: "Paystack isn't configured" };
  } else {
    try {
      const ngn = (await fetchBalance()).find((entry) => entry.currency === "NGN");
      paystack = { available: true, balance: money(fromSubunit(ngn?.balance ?? 0)) };
    } catch (error) {
      paystack = { available: false, message: error instanceof Error ? error.message : "Could not reach Paystack" };
    }
  }

  return {
    wallets,
    totalHeld: money(held._sum.balance),
    paystack,
    // The ledger's own view: system account balances and the trial balance (always zero)
    ledger: {
      ...ledger,
      paystackClearing: ledger.accounts.find((a) => a.code === SYSTEM_ACCOUNTS.PAYSTACK_CLEARING)?.balance ?? "0.00",
    },
    // Wallets whose stored balance disagrees with their ledger account (should be none)
    offLedger: offLedger.map((row) => ({
      userId: row.userId,
      name: row.name,
      email: row.email,
      stored: money(row.stored),
      ledger: money(row.ledger),
      difference: money(new Prisma.Decimal(row.stored).sub(row.ledger)),
    })),
    mismatches: mismatches.map((row) => ({
      userId: row.userId,
      name: row.name,
      email: row.email,
      stored: money(row.stored),
      computed: money(row.computed),
      difference: money(new Prisma.Decimal(row.stored).sub(row.computed)),
    })),
  };
};

// ---------- Audit log ----------

export const listAuditLog = async ({ targetId, limit, cursor }: { targetId?: string; limit: number; cursor?: string }) => {
  const rows = await prisma.adminAuditLog.findMany({
    where: targetId ? { targetId } : {},
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    ...pageArgs(limit, cursor),
    include: { admin: { select: { id: true, name: true, email: true } } },
  });
  const page = toPage(rows, limit);

  // targetId isn't a foreign key (it can be a deposit or withdrawal too), so look users up in one query
  const userIds = [...new Set(page.items.filter((e) => e.targetType === "User").map((e) => e.targetId))];
  const users = userIds.length
    ? await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true, email: true } })
    : [];
  const byId = new Map(users.map((u) => [u.id, u]));

  return {
    ...page,
    items: page.items.map((entry) => ({
      ...entry,
      targetUser: entry.targetType === "User" ? (byId.get(entry.targetId) ?? null) : null,
    })),
  };
};
