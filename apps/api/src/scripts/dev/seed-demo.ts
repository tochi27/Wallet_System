/**
 * Development only: a demo user with 90 days of realistic Nigerian spending (rent, groceries,
 * Bolt rides, DSTV, transfers to family and friends, one unusually large payment), for trying
 * AI insights and the assistant, and for the assistant evaluation. Refuses to run in production.
 *
 *   npm run seed:demo -w apps/api
 *
 * Safe to re-run. Money history is never deleted or rewritten (the ledger is append-only), so a
 * re-run archives the previous demo accounts (renamed, history intact) and creates fresh ones
 * with the usual emails. Every seeded payment goes through the ledger like real money: income
 * and spending as development funding, payments to people as transfers between wallets.
 */
import "../../config/env";
import crypto from "crypto";
import bcrypt from "bcryptjs";
import { JournalEntryType, Prisma, TransactionStatus, TransactionType } from "@prisma/client";
import prisma from "../../config/db";
import { post, SYSTEM_ACCOUNTS } from "../../services/ledger/ledger.service";

if (process.env.NODE_ENV === "production") {
  console.error("Refusing to seed demo data in production");
  process.exit(1);
}

const DEMO_USERS = {
  demo: { email: "insights-demo@example.com", name: "Chiamaka Obi" },
  landlord: { email: "insights-landlord@example.com", name: "Emeka Nwosu" },
  sister: { email: "insights-sister@example.com", name: "Ngozi Obi" },
  friend: { email: "insights-friend@example.com", name: "Tunde Bakare" },
} as const;

const daysAgo = (n: number, hour = 12) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  d.setUTCHours(hour, 0, 0, 0);
  return d;
};

// Moves an earlier demo account out of the way without touching its money or history
const archive = async (email: string, stamp: number) => {
  const existing = await prisma.user.findUnique({ where: { email } });
  if (!existing) return false;
  const [local, domain] = email.split("@");
  await prisma.user.update({
    where: { id: existing.id },
    data: {
      email: `${local}.archived-${stamp}@${domain}`,
      name: `Archived demo · ${existing.name}`,
      role: "USER",
      aiInsightsEnabled: false,
    },
  });
  return true;
};

const createUser = async (email: string, name: string) =>
  prisma.user.create({
    data: {
      email,
      name,
      password: await bcrypt.hash("Password123", 10),
      emailVerifiedAt: new Date(), // demo accounts can move money straight away
      wallet: { create: { balance: 0 } },
    },
  });

type Kind = "in" | "send" | "spend";

const main = async () => {
  const stamp = Date.now();
  let archived = 0;
  for (const { email } of Object.values(DEMO_USERS)) if (await archive(email, stamp)) archived++;

  const demo = await createUser(DEMO_USERS.demo.email, DEMO_USERS.demo.name);
  const landlord = await createUser(DEMO_USERS.landlord.email, DEMO_USERS.landlord.name);
  const sister = await createUser(DEMO_USERS.sister.email, DEMO_USERS.sister.name);
  const friend = await createUser(DEMO_USERS.friend.email, DEMO_USERS.friend.name);

  // [daysAgo, kind, amount, description, counterparty]
  const events: [number, Kind, number, string, { id: string } | null][] = [];
  for (const m of [0, 30, 60]) {
    events.push([m + 25, "in", 450000, "Salary", null]);
    events.push([m + 24, "send", 150000, "Rent", landlord]); // regular payment
    events.push([m + 20, "spend", 12500, "DSTV subscription", null]);
    events.push([m + 18, "spend", 8000, "MTN data bundle", null]);
    events.push([m + 10, "send", 20000, "Upkeep", sister]); // regular payment
  }
  // Food: more this month than before
  for (const d of [2, 5, 8, 11, 14, 17, 21, 27]) events.push([d, "spend", 6500 + (d % 3) * 1500, d % 2 ? "Chicken Republic" : "Shoprite groceries", null]);
  for (const d of [33, 40, 47, 55]) events.push([d, "spend", 6000, "Shoprite groceries", null]);
  for (const d of [64, 72, 80]) events.push([d, "spend", 5500, "Mama Put lunch", null]);
  // Transport: less this month
  for (const d of [3, 12, 22]) events.push([d, "spend", 3500, "Bolt ride", null]);
  for (const d of [31, 34, 38, 43, 49, 52, 58]) events.push([d, "spend", 3200, "Bolt ride", null]);
  for (const d of [62, 69, 75, 83]) events.push([d, "spend", 3000, "Uber", null]);
  // Friends, and one unusually large payment this month
  events.push([6, "send", 15000, "Dinner split", friend]);
  events.push([44, "send", 10000, "Birthday gift", friend]);
  events.push([4, "spend", 95000, "Samsung phone repair", null]);

  events.sort((a, b) => b[0] - a[0]); // oldest first

  for (const [ago, kind, amount, description, counterparty] of events) {
    const timestamp = daysAgo(ago);
    const value = new Prisma.Decimal(amount);

    // Each payment is one database transaction: wallets, history and ledger move together
    await prisma.$transaction(async (tx) => {
      const wallet = await tx.wallet.findUniqueOrThrow({ where: { userId: demo.id } });
      const after = kind === "in" ? wallet.balance.add(value) : wallet.balance.sub(value);
      await tx.wallet.update({ where: { userId: demo.id }, data: { balance: after } });
      const transferId = kind === "send" ? crypto.randomUUID() : null;
      const own = await tx.transaction.create({
        data: {
          userId: demo.id,
          type: kind === "in" ? TransactionType.CREDIT : TransactionType.DEBIT,
          status: TransactionStatus.SUCCESSFUL,
          amount: value,
          balanceBefore: wallet.balance,
          balanceAfter: after,
          description,
          transferId,
          timestamp,
        },
      });

      if (kind === "send") {
        const theirs = await tx.wallet.findUniqueOrThrow({ where: { userId: counterparty!.id } });
        const theirsAfter = theirs.balance.add(value);
        await tx.wallet.update({ where: { userId: counterparty!.id }, data: { balance: theirsAfter } });
        await tx.transaction.create({
          data: {
            userId: counterparty!.id,
            type: TransactionType.CREDIT,
            status: TransactionStatus.SUCCESSFUL,
            amount: value,
            balanceBefore: theirs.balance,
            balanceAfter: theirsAfter,
            description,
            transferId,
            timestamp,
          },
        });
        await post(tx, {
          type: JournalEntryType.TRANSFER,
          description: `Demo data: ${description}`,
          amount: value,
          debit: { wallet: demo.id },
          credit: { wallet: counterparty!.id },
          reference: transferId,
          transactionId: own.id,
        });
      } else {
        // Salary and spending have no real payment behind them: development funding, like /credit and /debit
        await post(tx, {
          type: JournalEntryType.DIRECT_FUNDING,
          description: `Demo data: ${description}`,
          amount: value,
          debit: kind === "in" ? SYSTEM_ACCOUNTS.DEV_FUNDING : { wallet: demo.id },
          credit: kind === "in" ? { wallet: demo.id } : SYSTEM_ACCOUNTS.DEV_FUNDING,
          transactionId: own.id,
        });
      }
    });
  }

  const { balance } = await prisma.wallet.findUniqueOrThrow({ where: { userId: demo.id } });
  if (archived) console.log(`Archived ${archived} earlier demo account(s) (renamed "Archived demo · …", history kept)`);
  console.log(`Seeded ${events.length} transactions for ${demo.email} (password Password123); balance ₦${balance.toFixed(2)}`);
};

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
