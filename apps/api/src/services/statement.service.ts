import { Prisma, Transaction, TransactionStatus, TransactionType } from "@prisma/client";
import prisma from "../config/db";

export class TransactionNotFoundError extends Error {
  constructor() {
    super("Transaction not found");
    this.name = "TransactionNotFoundError";
  }
}

export class StatementTooLargeError extends Error {
  constructor() {
    super("That period has too many transactions for one statement. Choose a shorter period.");
    this.name = "StatementTooLargeError";
  }
}

const MAX_STATEMENT_ROWS = 5000;
const ZERO = new Prisma.Decimal(0);

// Same wording as the web app (apps/web/src/lib/transactions.ts)
const transactionLabel = (tx: Pick<Transaction, "type" | "transferId" | "reversalOf">) => {
  if (tx.reversalOf) return "Reversal";
  if (tx.transferId) return tx.type === TransactionType.CREDIT ? "Transfer received" : "Transfer sent";
  return tx.type === TransactionType.CREDIT ? "Deposit" : "Withdrawal";
};

// ── Receipt ─────────────────────────────────────────────────────────────────

/**
 * Everything a receipt shows for one of the user's transactions: the other party of a transfer
 * (name only), the Paystack deposit or withdrawal behind it, and any reversal link.
 */
export const getTransactionDetail = async (userId: string, transactionId: string) => {
  const transaction = await prisma.transaction.findFirst({ where: { id: transactionId, userId } });
  if (!transaction) throw new TransactionNotFoundError();

  const [counterpartyLeg, deposit, withdrawal, reversedBy, original] = await Promise.all([
    transaction.transferId
      ? prisma.transaction.findFirst({
          where: { transferId: transaction.transferId, id: { not: transaction.id } },
          select: { user: { select: { name: true } } },
        })
      : null,
    prisma.deposit.findUnique({
      where: { transactionId },
      select: { reference: true, channel: true, paidAt: true },
    }),
    prisma.withdrawal.findFirst({
      where: { OR: [{ debitTransactionId: transactionId }, { refundTransactionId: transactionId }] },
      select: {
        reference: true,
        status: true,
        failureReason: true,
        completedAt: true,
        bankAccount: { select: { bankName: true, accountNumberLast4: true, accountName: true } },
      },
    }),
    prisma.transaction.findFirst({
      where: { reversalOf: transactionId, status: TransactionStatus.SUCCESSFUL },
      select: { id: true, timestamp: true },
    }),
    transaction.reversalOf
      ? prisma.transaction.findFirst({
          where: { id: transaction.reversalOf, userId },
          select: { id: true, description: true, amount: true, timestamp: true },
        })
      : null,
  ]);

  return {
    transaction,
    label: transactionLabel(transaction),
    counterparty: counterpartyLeg ? { name: counterpartyLeg.user.name } : null,
    deposit,
    withdrawal,
    reversedBy,
    reversalOf: original,
  };
};

// ── Statement ───────────────────────────────────────────────────────────────

export type StatementRow = {
  date: Date;
  reference: string;
  description: string;
  type: TransactionType;
  amount: Prisma.Decimal;
  balance: Prisma.Decimal;
};

export type Statement = {
  holder: { name: string; email: string };
  from: string;
  to: string;
  timezone: string;
  openingBalance: Prisma.Decimal;
  closingBalance: Prisma.Decimal;
  moneyIn: Prisma.Decimal;
  moneyOut: Prisma.Decimal;
  rows: StatementRow[];
  generatedAt: Date;
};

type RawRow = {
  id: string;
  reference: string;
  type: TransactionType;
  status: TransactionStatus;
  amount: Prisma.Decimal;
  description: string | null;
  transferId: string | null;
  reversalOf: string | null;
  timestamp: Date;
};

/**
 * A statement for the calendar days `from`..`to` in the user's timezone. Like the stats
 * endpoint it counts SUCCESSFUL and REVERSED entries, so a reversed transaction and its reversal
 * both appear and net to zero, and opening + movements = closing.
 */
export const getStatement = async (
  userId: string,
  from: string,
  to: string,
  timezone: string
): Promise<Statement> => {
  const holder = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { name: true, email: true } });

  const localDay = Prisma.sql`(("timestamp" AT TIME ZONE 'UTC') AT TIME ZONE ${timezone})::date`;
  const counted = Prisma.sql`"userId" = ${userId} AND status IN ('SUCCESSFUL', 'REVERSED')`;

  const [openingRows, rows] = await Promise.all([
    prisma.$queryRaw<{ opening: Prisma.Decimal | null }[]>`
      SELECT SUM(CASE WHEN type = 'CREDIT' THEN amount ELSE -amount END) AS opening
      FROM "Transaction"
      WHERE ${counted} AND ${localDay} < ${from}::date
    `,
    prisma.$queryRaw<RawRow[]>`
      SELECT id, reference, type, status, amount, description, "transferId", "reversalOf", "timestamp"
      FROM "Transaction"
      WHERE ${counted} AND ${localDay} BETWEEN ${from}::date AND ${to}::date
      ORDER BY "timestamp" ASC, id ASC
      LIMIT ${MAX_STATEMENT_ROWS + 1}
    `,
  ]);
  if (rows.length > MAX_STATEMENT_ROWS) throw new StatementTooLargeError();

  // Name the other party on transfer lines
  const transferIds = [...new Set(rows.map((row) => row.transferId).filter((id): id is string => id !== null))];
  const otherLegs = transferIds.length
    ? await prisma.transaction.findMany({
        where: { transferId: { in: transferIds }, userId: { not: userId } },
        select: { transferId: true, user: { select: { name: true } } },
      })
    : [];
  const counterparty = new Map(otherLegs.map((leg) => [leg.transferId, leg.user.name]));

  const openingBalance = new Prisma.Decimal(openingRows[0]?.opening ?? ZERO);
  let balance = openingBalance;
  let moneyIn = ZERO;
  let moneyOut = ZERO;

  const statementRows = rows.map((row) => {
    const amount = new Prisma.Decimal(row.amount);
    const isCredit = row.type === TransactionType.CREDIT;
    balance = isCredit ? balance.add(amount) : balance.sub(amount);
    if (isCredit) moneyIn = moneyIn.add(amount);
    else moneyOut = moneyOut.add(amount);

    const other = row.transferId ? counterparty.get(row.transferId) : undefined;
    const base = row.description || transactionLabel(row);
    const withParty = other && !row.reversalOf ? `${base} (${isCredit ? "from" : "to"} ${other})` : base;
    return {
      date: row.timestamp,
      reference: row.reference,
      description: row.status === TransactionStatus.REVERSED ? `${withParty} [reversed]` : withParty,
      type: row.type,
      amount,
      balance,
    };
  });

  return {
    holder,
    from,
    to,
    timezone,
    openingBalance,
    closingBalance: balance,
    moneyIn,
    moneyOut,
    rows: statementRows,
    generatedAt: new Date(),
  };
};
