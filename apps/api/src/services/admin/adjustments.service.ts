import {
  Role,
  AdjustmentDirection,
  AdjustmentKind,
  AdjustmentStatus,
  JournalEntryType,
  Prisma,
  TransactionStatus,
  TransactionType,
} from "@prisma/client";
import bcrypt from "bcryptjs";
import prisma from "../../config/db";
import logger from "../../config/logger";
import { enqueueTransactionEvent } from "../../queues/transaction.queue";
import { invalidateBalance } from "../../utils/cache.utils";
import { withLock } from "../../utils/lock.utils";
import { post, SYSTEM_ACCOUNTS } from "../ledger/ledger.service";
import { formatNaira, notify } from "../notifications/notification.service";
import { AdminActionError } from "./admin.service";

// Up to this amount one admin can adjust a balance; above it a second, different admin must approve
export const APPROVAL_THRESHOLD = new Prisma.Decimal(10_000);
export const MAX_ADJUSTMENT = new Prisma.Decimal(10_000_000);

// What the user sees in their history. The admin's reason stays internal.
const USER_LABEL: Record<AdjustmentKind, string> = {
  REFUND: "Refund from PurpleWallet",
  GOODWILL: "Credit from PurpleWallet",
  CORRECTION: "Balance correction",
};

/** Re-checks the admin's password before anything that moves money or changes staff roles. */
export const confirmAdminPassword = async (adminId: string, password: string) => {
  const admin = await prisma.user.findUniqueOrThrow({ where: { id: adminId }, select: { password: true } });
  // 400, not 401: a mistyped password mustn't sign the admin out
  if (!(await bcrypt.compare(password, admin.password))) throw new AdminActionError("Incorrect password", 400);
};

type Tx = Prisma.TransactionClient;
const audit = (tx: Tx, adminId: string, action: string, adjustmentId: string, reason: string, details: Prisma.InputJsonValue) =>
  tx.adminAuditLog.create({ data: { adminId, action, targetType: "Adjustment", targetId: adjustmentId, reason, details } });

export type AdjustmentRequest = {
  userId: string;
  direction: AdjustmentDirection;
  kind: AdjustmentKind;
  amount: number;
  reason: string;
  password: string;
};

/**
 * Creates an adjustment. Up to the threshold it's applied at once; above it, it waits as PENDING
 * for a different admin. Only corrections can take money away.
 */
export const requestAdjustment = async (adminId: string, request: AdjustmentRequest) => {
  await confirmAdminPassword(adminId, request.password);
  if (request.userId === adminId) throw new AdminActionError("You can't adjust your own balance", 400);
  if (request.direction === AdjustmentDirection.DEBIT && request.kind !== AdjustmentKind.CORRECTION) {
    throw new AdminActionError("Only a correction can take money from a wallet", 400);
  }
  const amount = new Prisma.Decimal(request.amount);
  if (amount.lte(0) || amount.gt(MAX_ADJUSTMENT) || amount.decimalPlaces() > 2) throw new AdminActionError("Enter an amount up to ₦10,000,000", 400);
  const user = await prisma.user.findUnique({ where: { id: request.userId }, select: { id: true } });
  if (!user) throw new AdminActionError("User not found", 404);

  const adjustment = await prisma.$transaction(async (tx) => {
    const created = await tx.adjustment.create({
      data: {
        userId: request.userId,
        direction: request.direction,
        kind: request.kind,
        amount,
        reason: request.reason,
        requestedById: adminId,
      },
    });
    await audit(tx, adminId, "adjustment.request", created.id, request.reason, {
      userId: request.userId,
      direction: request.direction,
      kind: request.kind,
      amount: amount.toFixed(2),
    });
    return created;
  });

  if (amount.lte(APPROVAL_THRESHOLD)) {
    try {
      return await applyAdjustment(adjustment.id, adminId, "Within the single-admin limit");
    } catch (err) {
      // Nobody else will approve a small one, so don't leave it looking like it's waiting
      await prisma.adjustment.updateMany({
        where: { id: adjustment.id, status: AdjustmentStatus.PENDING },
        data: { status: AdjustmentStatus.REJECTED, decidedById: adminId, decidedAt: new Date(), decisionNote: `Couldn't apply: ${err instanceof Error ? err.message : "error"}` },
      });
      throw err;
    }
  }
  logger.info({ adjustmentId: adjustment.id, amount: amount.toFixed(2) }, "Adjustment awaiting a second admin");
  return adjustment;
};

/**
 * Moves the money: claims the PENDING adjustment, updates the wallet, records a user-facing
 * transaction and a ledger entry against the Adjustments account, all in one transaction. If a
 * debit would take the wallet below zero, nothing happens and it stays PENDING.
 */
const applyAdjustment = async (adjustmentId: string, approverId: string, note: string, soloApproval = false) => {
  const pending = await prisma.adjustment.findUniqueOrThrow({ where: { id: adjustmentId } });

  const result = await withLock(pending.userId, () =>
    prisma.$transaction(async (tx) => {
      const { count } = await tx.adjustment.updateMany({
        where: { id: adjustmentId, status: AdjustmentStatus.PENDING },
        data: { status: AdjustmentStatus.APPROVED, decidedById: approverId, decidedAt: new Date(), decisionNote: note },
      });
      if (count === 0) throw new AdminActionError("This adjustment has already been decided", 409);

      const wallet = await tx.wallet.findUnique({ where: { userId: pending.userId } });
      if (!wallet) throw new AdminActionError("This user has no wallet", 409);
      const credit = pending.direction === AdjustmentDirection.CREDIT;
      if (!credit && new Prisma.Decimal(wallet.balance).lt(pending.amount)) {
        throw new AdminActionError("This would take the wallet below zero", 409);
      }

      const balanceBefore = wallet.balance;
      const balanceAfter = credit ? new Prisma.Decimal(balanceBefore).add(pending.amount) : new Prisma.Decimal(balanceBefore).sub(pending.amount);
      await tx.wallet.update({ where: { userId: pending.userId }, data: { balance: balanceAfter } });

      const transaction = await tx.transaction.create({
        data: {
          userId: pending.userId,
          type: credit ? TransactionType.CREDIT : TransactionType.DEBIT,
          status: TransactionStatus.SUCCESSFUL,
          amount: pending.amount,
          balanceBefore,
          balanceAfter,
          description: USER_LABEL[pending.kind],
        },
      });
      await tx.adjustment.update({ where: { id: adjustmentId }, data: { transactionId: transaction.id } });
      // The business pays for a credit and recovers a debit, through the Adjustments account
      await post(tx, {
        type: JournalEntryType.ADJUSTMENT,
        description: `${USER_LABEL[pending.kind]}: ${pending.reason}`,
        amount: pending.amount,
        debit: credit ? SYSTEM_ACCOUNTS.ADJUSTMENTS : { wallet: pending.userId },
        credit: credit ? { wallet: pending.userId } : SYSTEM_ACCOUNTS.ADJUSTMENTS,
        reference: adjustmentId,
        transactionId: transaction.id,
        createdById: approverId,
      });
      await audit(tx, approverId, "adjustment.approve", adjustmentId, note, {
        userId: pending.userId,
        amount: pending.amount.toFixed(2),
        direction: pending.direction,
        requestedBy: pending.requestedById,
        selfApproved: approverId === pending.requestedById,
        // Above the limit, approved by the requester because no second approver existed
        soloApproval,
      });
      return { transaction, credit };
    })
  );

  await invalidateBalance(pending.userId);
  await enqueueTransactionEvent(
    {
      event: result.credit ? "CREDIT" : "DEBIT",
      userId: pending.userId,
      transactionId: result.transaction.id,
      amount: result.transaction.amount.toString(),
      reference: result.transaction.reference,
      timestamp: result.transaction.timestamp.toISOString(),
    },
    result.transaction.id
  );
  await notify({
    userId: pending.userId,
    type: "account.adjustment",
    title: result.credit ? "Money added by PurpleWallet" : "Balance corrected",
    body: result.credit
      ? `We added ${formatNaira(pending.amount)} to your wallet: ${USER_LABEL[pending.kind]}.`
      : `We took ${formatNaira(pending.amount)} from your wallet to correct your balance. Contact support if you have questions.`,
    data: { transactionId: result.transaction.id },
    actionPath: `/transactions/${result.transaction.id}`,
  });
  return prisma.adjustment.findUniqueOrThrow({ where: { id: adjustmentId } });
};

/** Second-admin approval. The admin who asked for it can't approve it. */
/**
 * Whether anyone other than this admin could approve an adjustment (an active Finance or Owner).
 * While nobody else can, the business is in "solo mode": the two-person rule can't be met, so the
 * one admin may approve their own requests, and each one is recorded as self-approved.
 */
export const hasSecondApprover = async (adminId: string) =>
  (await prisma.user.count({
    where: { id: { not: adminId }, role: { in: [Role.FINANCE, Role.OWNER] }, frozenAt: null },
  })) > 0;

/** Second-admin approval. The requester can't approve their own, unless no one else can (solo mode). */
export const approveAdjustment = async (adminId: string, adjustmentId: string, password: string, note?: string) => {
  await confirmAdminPassword(adminId, password);
  const adjustment = await prisma.adjustment.findUnique({ where: { id: adjustmentId } });
  if (!adjustment) throw new AdminActionError("Adjustment not found", 404);
  if (adjustment.status !== AdjustmentStatus.PENDING) throw new AdminActionError("This adjustment has already been decided", 409);

  const own = adjustment.requestedById === adminId;
  if (own && (await hasSecondApprover(adminId))) throw new AdminActionError("A different admin must approve this adjustment", 403);
  const decision = own
    ? `Self-approved: no second approver available${note?.trim() ? `. ${note.trim()}` : ""}`
    : note?.trim() || "Approved";
  return applyAdjustment(adjustmentId, adminId, decision, own);
};

export const rejectAdjustment = async (adminId: string, adjustmentId: string, password: string, reason: string) => {
  await confirmAdminPassword(adminId, password);
  return prisma.$transaction(async (tx) => {
    const { count } = await tx.adjustment.updateMany({
      where: { id: adjustmentId, status: AdjustmentStatus.PENDING },
      data: { status: AdjustmentStatus.REJECTED, decidedById: adminId, decidedAt: new Date(), decisionNote: reason },
    });
    if (count === 0) throw new AdminActionError("This adjustment isn't pending", 409);
    await audit(tx, adminId, "adjustment.reject", adjustmentId, reason, {});
    return tx.adjustment.findUniqueOrThrow({ where: { id: adjustmentId } });
  });
};

const person = { select: { id: true, name: true, email: true } } as const;

export const listAdjustments = async (
  viewerId: string,
  { status, userId, limit, cursor }: { status?: AdjustmentStatus; userId?: string; limit: number; cursor?: string }
) => {
  const rows = await prisma.adjustment.findMany({
    where: { ...(status ? { status } : {}), ...(userId ? { userId } : {}) },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    include: { user: person, requestedBy: person, decidedBy: person },
  });
  const items = rows.slice(0, limit).map((a) => ({ ...a, amount: a.amount.toFixed(2), needsSecondAdmin: a.amount.gt(APPROVAL_THRESHOLD) }));
  return {
    items,
    nextCursor: rows.length > limit ? items[items.length - 1].id : null,
    // True when the viewer is the only admin who can approve, so they may approve their own
    soloMode: !(await hasSecondApprover(viewerId)),
  };
};
