import { AccountTier, Prisma, TransactionStatus, TransactionType, WithdrawalStatus } from "@prisma/client";
import prisma from "../config/db";
import { LIMITS_UTC_OFFSET_HOURS, TIER_LIMITS } from "../config/limits";

type Db = Prisma.TransactionClient | typeof prisma;

const DAY_MS = 24 * 60 * 60 * 1000;
const OFFSET_MS = LIMITS_UTC_OFFSET_HOURS * 60 * 60 * 1000;

const naira = new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN" });
const format = (amount: Prisma.Decimal | number) => naira.format(Number(amount));

/**
 * A payment over the account's limits. 400, never 401 (the web app signs the user out on 401).
 * `remaining` is how much the user could still move, so the app can suggest a smaller amount.
 */
export class LimitError extends Error {
  readonly status = 400;
  readonly code: "PER_TRANSACTION" | "DAILY" | "BALANCE_CAP";
  readonly remaining: string;

  constructor(message: string, code: LimitError["code"], remaining: Prisma.Decimal | number) {
    super(message);
    this.name = "LimitError";
    this.code = code;
    this.remaining = new Prisma.Decimal(remaining).toFixed(2);
  }
}

/** Midnight Nigerian time at the start of today, and the next one, as UTC instants. */
export const limitDay = (now = new Date()) => {
  const start = new Date(Math.floor((now.getTime() + OFFSET_MS) / DAY_MS) * DAY_MS - OFFSET_MS);
  return { start, resetsAt: new Date(start.getTime() + DAY_MS) };
};

/**
 * What has left the wallet today: transfers sent plus withdrawals. A transfer that was reversed,
 * or a withdrawal that failed and was refunded, gives its allowance back. Admin adjustments and
 * development-only debits aren't payments the user made, so they don't count.
 */
export const spentToday = async (db: Db, userId: string, now = new Date()): Promise<Prisma.Decimal> => {
  const since = limitDay(now).start;
  const [transfers, withdrawals] = await Promise.all([
    db.transaction.aggregate({
      where: {
        userId,
        type: TransactionType.DEBIT,
        status: TransactionStatus.SUCCESSFUL,
        transferId: { not: null },
        timestamp: { gte: since },
      },
      _sum: { amount: true },
    }),
    db.withdrawal.aggregate({
      where: {
        userId,
        status: { notIn: [WithdrawalStatus.FAILED, WithdrawalStatus.REVERSED] },
        createdAt: { gte: since },
      },
      _sum: { amount: true },
    }),
  ]);
  return new Prisma.Decimal(transfers._sum.amount ?? 0).add(withdrawals._sum.amount ?? 0);
};

const tierOf = async (db: Db, userId: string): Promise<AccountTier> => {
  const user = await db.user.findUniqueOrThrow({ where: { id: userId }, select: { tier: true } });
  return user.tier;
};

/**
 * Throws a LimitError if this payment would break the per-payment or daily limit. Call it inside
 * the same database transaction (and wallet lock) as the debit, so two payments made at once
 * can't both squeeze under the limit.
 */
export const assertCanSend = async (db: Db, userId: string, amount: number | Prisma.Decimal): Promise<void> => {
  const limits = TIER_LIMITS[await tierOf(db, userId)];
  const value = new Prisma.Decimal(amount);

  if (value.gt(limits.perTransaction)) {
    throw new LimitError(
      `You can send or withdraw up to ${format(limits.perTransaction)} at a time.`,
      "PER_TRANSACTION",
      limits.perTransaction
    );
  }

  const left = Prisma.Decimal.max(new Prisma.Decimal(limits.dailyOut).sub(await spentToday(db, userId)), 0);
  if (value.gt(left)) {
    throw new LimitError(
      left.isZero()
        ? `You've reached your daily limit of ${format(limits.dailyOut)}. It resets at midnight.`
        : `This is over your daily limit of ${format(limits.dailyOut)}. You can send or withdraw up to ${format(left)} more today.`,
      "DAILY",
      left
    );
  }
};

/**
 * Throws a LimitError if adding this much would take the wallet past its tier's cap. Only for
 * money the user is about to add: money that has already been paid is always credited.
 */
export const assertCanReceive = async (db: Db, userId: string, amount: number | Prisma.Decimal): Promise<void> => {
  const { maxBalance } = TIER_LIMITS[await tierOf(db, userId)];
  if (maxBalance === null) return;

  const wallet = await db.wallet.findUniqueOrThrow({ where: { userId }, select: { balance: true } });
  const room = Prisma.Decimal.max(new Prisma.Decimal(maxBalance).sub(wallet.balance), 0);
  if (new Prisma.Decimal(amount).gt(room)) {
    throw new LimitError(
      room.isZero()
        ? `Your wallet can hold up to ${format(maxBalance)}, and it's full.`
        : `Your wallet can hold up to ${format(maxBalance)}. You can add up to ${format(room)} more.`,
      "BALANCE_CAP",
      room
    );
  }
};

/** The signed-in user's limits and how much of today's allowance is used, for the app. */
export const getLimits = async (userId: string, now = new Date()) => {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { tier: true, emailVerifiedAt: true, wallet: { select: { balance: true } } },
  });
  const limits = TIER_LIMITS[user.tier];
  const used = await spentToday(prisma, userId, now);
  const balance = new Prisma.Decimal(user.wallet?.balance ?? 0);
  const fixed = (value: Prisma.Decimal | number) => new Prisma.Decimal(value).toFixed(2);

  return {
    tier: user.tier,
    // Unverified accounts can't move money at all, whatever their tier allows
    emailVerified: user.emailVerifiedAt !== null,
    perTransaction: fixed(limits.perTransaction),
    daily: {
      limit: fixed(limits.dailyOut),
      used: fixed(used),
      remaining: fixed(Prisma.Decimal.max(new Prisma.Decimal(limits.dailyOut).sub(used), 0)),
      resetsAt: limitDay(now).resetsAt,
    },
    balance: {
      max: limits.maxBalance === null ? null : fixed(limits.maxBalance),
      current: fixed(balance),
      room: limits.maxBalance === null ? null : fixed(Prisma.Decimal.max(new Prisma.Decimal(limits.maxBalance).sub(balance), 0)),
    },
  };
};
