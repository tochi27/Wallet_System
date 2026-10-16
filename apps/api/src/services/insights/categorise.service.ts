import { CategorySource, SpendingCategory, TransactionType } from "@prisma/client";
import { z } from "zod";
import { env } from "../../config/env";
import prisma from "../../config/db";
import logger from "../../config/logger";
import { generateJson, isAiConfigured } from "../ai/gemini.client";
import { CATEGORY_GUIDE } from "./categories";
import { firstName, Pseudonymiser } from "./pseudonymise";

const BATCH_SIZE = 40;
const MAX_BATCHES = 3; // per refresh, so one user's backlog can't use up the free-tier quota
const HISTORY_DAYS = 90;

const resultSchema = z.object({
  items: z.array(z.object({ id: z.string(), category: z.enum(SpendingCategory) })),
});

const SYSTEM = `You sort a Nigerian wallet user's outgoing payments into spending categories.
Use the description and amount; the recipient is a placeholder like "Person A", not a business name.
Categories:
${CATEGORY_GUIDE}
Return every item's id with exactly one category. If unsure, use OTHER.`;

/**
 * Categorises the user's recent money-out transactions that have no category yet. Withdrawals to
 * their own bank aren't spending and are skipped. A category the user picked is never replaced:
 * the update only touches rows that are still uncategorised. Returns how many were categorised.
 */
export const categoriseRecentSpends = async (userId: string): Promise<number> => {
  if (!isAiConfigured()) return 0;
  const since = new Date(Date.now() - HISTORY_DAYS * 24 * 60 * 60 * 1000);
  let categorised = 0;
  // Debits behind withdrawals to the user's own bank aren't spending
  const withdrawalDebits = (await prisma.withdrawal.findMany({ where: { userId }, select: { debitTransactionId: true } })).map(
    (w) => w.debitTransactionId
  );

  for (let batch = 0; batch < MAX_BATCHES; batch++) {
    const rows = await prisma.transaction.findMany({
      where: {
        userId,
        type: TransactionType.DEBIT,
        status: "SUCCESSFUL",
        reversalOf: null,
        category: null,
        timestamp: { gte: since },
        id: { notIn: withdrawalDebits },
      },
      orderBy: { timestamp: "desc" },
      take: BATCH_SIZE,
      select: { id: true, amount: true, description: true, transferId: true },
    });
    if (rows.length === 0) break;

    // Who each transfer went to, so their name can be pseudonymised out of the description
    const legs = await prisma.transaction.findMany({
      where: { transferId: { in: rows.flatMap((r) => (r.transferId ? [r.transferId] : [])) }, userId: { not: userId } },
      select: { transferId: true, user: { select: { name: true, email: true } } },
    });
    const pseudonyms = new Pseudonymiser();
    const recipientByTransfer = new Map(
      legs.map((leg) => {
        return [leg.transferId, pseudonyms.alias([leg.user.email, leg.user.name], firstName(leg.user.name))];
      })
    );

    // Short ids instead of real ones: nothing internal leaves the server
    const items = rows.map((row, index) => ({
      id: `t${index + 1}`,
      description: pseudonyms.scrub(row.description) || "(no description)",
      amount: `₦${row.amount.toFixed(2)}`,
      recipient: row.transferId ? (recipientByTransfer.get(row.transferId) ?? null) : null,
    }));

    const { data } = await generateJson({
      models: [env.GEMINI_CATEGORY_MODEL, env.GEMINI_MODEL],
      system: SYSTEM,
      prompt: JSON.stringify({ items }),
      schema: resultSchema,
    });

    const idByShortId = new Map(rows.map((row, index) => [`t${index + 1}`, row.id]));
    for (const item of data.items) {
      const id = idByShortId.get(item.id);
      if (!id) continue;
      const { count } = await prisma.transaction.updateMany({
        where: { id, category: null },
        data: { category: item.category, categorySource: CategorySource.AI },
      });
      categorised += count;
    }

    // The model skipped some: stop rather than ask about the same rows again
    if (data.items.length < rows.length) break;
  }

  if (categorised > 0) logger.info({ userId, categorised }, "Transactions categorised");
  return categorised;
};
