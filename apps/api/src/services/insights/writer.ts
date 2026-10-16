import { Prisma, SpendingCategory } from "@prisma/client";
import { z } from "zod";
import { CATEGORY_LABELS } from "./categories";
import type { InsightFacts } from "./facts.service";
import { Pseudonymiser } from "./pseudonymise";

export const insightContentSchema = z.object({
  headline: z.string().min(1).max(160),
  insights: z
    .array(
      z.object({
        kind: z.enum(["spending", "category", "recipient", "regular", "unusual", "tip"]),
        tone: z.enum(["positive", "neutral", "attention"]),
        title: z.string().min(1).max(80),
        body: z.string().min(1).max(280),
        category: z.enum(SpendingCategory).optional(),
      })
    )
    .max(4),
});

export type InsightContent = z.infer<typeof insightContentSchema>;
export type Insight = InsightContent["insights"][number];

// ₦12,400 or ₦12,400.50: the exact strings the model is told to copy
export const naira = (amount: string) => {
  const value = new Prisma.Decimal(amount);
  const [whole, fraction] = value.toFixed(2).split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `₦${grouped}${fraction === "00" ? "" : `.${fraction}`}`;
};

// "2026-10-10" → "10 Oct": how a person would say it
const day = (iso: string) =>
  new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${iso}T00:00:00Z`));

const change = (percent: number | null) =>
  percent === null ? null : percent === 0 ? "no change" : `${percent > 0 ? "up" : "down"} ${Math.abs(percent)}%`;

/**
 * The facts as the model sees them: every amount pre-formatted, every person pseudonymised.
 * Returns the figures it may quote, for checking its reply.
 */
export const factsForModel = (facts: InsightFacts, pseudonyms: Pseudonymiser) => {
  // Keyed by ID and first name, so the name is also replaced wherever it appears in a description
  const person = (id: string | null, name: string | null) => (id && name ? pseudonyms.alias([id, name], name) : null);
  const summary = (p: InsightFacts["current"]) => ({
    moneyIn: naira(p.moneyIn),
    spent: naira(p.spent),
    withdrawnToOwnBank: naira(p.withdrawn),
    numberOfPayments: p.spendCount,
  });

  const payload = {
    period: "the last 30 days, compared with the 30 days before",
    thisPeriod: summary(facts.current),
    previous30Days: summary(facts.previous),
    spendingChange: change(facts.spentChangePercent) ?? "nothing was spent in the previous 30 days",
    categories: facts.categories
      .filter((c) => c.category !== "UNCATEGORISED")
      .map((c) => ({
        category: c.category,
        name: CATEGORY_LABELS[c.category],
        thisPeriod: naira(c.current),
        previous30Days: naira(c.previous),
        change: change(c.changePercent) ?? "new this period",
      })),
    topRecipients: facts.topRecipients.map((r) => ({ who: person(r.userId, r.name), total: naira(r.total), payments: r.count })),
    largestPayment: facts.largestSpend && {
      amount: naira(facts.largestSpend.amount),
      date: day(facts.largestSpend.date),
      category: CATEGORY_LABELS[facts.largestSpend.category],
      to: person(facts.largestSpend.recipientId, facts.largestSpend.recipient),
      description: pseudonyms.scrub(facts.largestSpend.description),
    },
    regularPayments: facts.regularPayments.map((r) => ({ who: person(r.userId, r.name), typicalAmount: naira(r.typicalAmount), monthsInARow: r.months })),
    unusualPayments: facts.unusualSpends.map((u) => ({
      amount: naira(u.amount),
      date: day(u.date),
      to: person(u.recipientId, u.recipient),
      description: pseudonyms.scrub(u.description),
      timesYourTypicalPayment: u.timesTypical,
    })),
    paymentsNotCategorisedYet: facts.uncategorisedCount,
  };

  const amounts = [
    facts.current.moneyIn, facts.current.spent, facts.current.withdrawn,
    facts.previous.moneyIn, facts.previous.spent, facts.previous.withdrawn,
    ...facts.categories.flatMap((c) => [c.current, c.previous]),
    ...facts.topRecipients.map((r) => r.total),
    ...(facts.largestSpend ? [facts.largestSpend.amount] : []),
    ...facts.regularPayments.map((r) => r.typicalAmount),
    ...facts.unusualSpends.map((u) => u.amount),
  ];
  const percents = [facts.spentChangePercent, ...facts.categories.map((c) => c.changePercent)]
    .filter((p): p is number => p !== null)
    .map((p) => Math.abs(p));

  return {
    payload,
    allowed: {
      amounts: new Set(amounts.map((a) => new Prisma.Decimal(a).toFixed(2))),
      percents: new Set(percents),
    },
  };
};

export const SYSTEM_PROMPT = `You write short spending insights for a user of PurpleWallet, a Nigerian digital wallet. You receive facts that have already been calculated; your only job is to describe them clearly.

Rules:
- Use only figures that appear in the facts, copied exactly (e.g. "₦12,400" or "18%"). Never calculate, round, add or estimate a new number.
- Refer to people only by the placeholder given (e.g. "Person A"). Never guess who they are.
- Write a headline (one sentence about the overall picture) and up to 4 insights, each about a different fact. Don't repeat the headline's point in an insight. Skip facts with nothing interesting to say.
- Say "the last 30 days" or "this month"; don't write out the date range.
- Keep titles short (under 8 words) and bodies to one or two plain sentences, speaking to the user as "you".
- tone: "positive" for good news (e.g. spending less), "attention" only for an unusual payment or a sharp rise they may want to check (at most two), otherwise "neutral".
- Set "category" only when an insight is about one spending category.
- Be friendly and factual. No emojis, no financial or investment advice, no mention of AI.
- If there is very little activity, say so briefly rather than inventing insights.`;

/** True when every ₦ amount and percentage in the text is one we calculated. */
export const usesOnlyAllowedFigures = (text: string, allowed: { amounts: Set<string>; percents: Set<number> }) => {
  for (const match of text.matchAll(/₦\s?([\d,]+(?:\.\d+)?)/g)) {
    const value = new Prisma.Decimal(match[1].replace(/,/g, "")).toFixed(2);
    if (!allowed.amounts.has(value)) return false;
  }
  for (const match of text.matchAll(/(\d+(?:\.\d+)?)\s?%/g)) {
    if (!allowed.percents.has(Number(match[1]))) return false;
  }
  return true;
};

/** Keeps only insights whose numbers check out, with real first names put back. */
export const checkContent = (
  content: InsightContent,
  allowed: { amounts: Set<string>; percents: Set<number> },
  pseudonyms: Pseudonymiser
): InsightContent | null => {
  const insights = content.insights
    .filter((i) => usesOnlyAllowedFigures(`${i.title} ${i.body}`, allowed))
    .map((i) => ({ ...i, title: pseudonyms.restore(i.title), body: pseudonyms.restore(i.body) }));
  const headlineOk = usesOnlyAllowedFigures(content.headline, allowed);
  if (!headlineOk || insights.length === 0) return null;
  return { headline: pseudonyms.restore(content.headline), insights };
};

/** Plain sentences from the same facts, used without an AI key or when the AI is unavailable. */
export const templateInsights = (facts: InsightFacts): InsightContent => {
  const spent = new Prisma.Decimal(facts.current.spent);
  if (spent.isZero() && new Prisma.Decimal(facts.current.moneyIn).isZero()) {
    return {
      headline: "Not much has happened in your wallet in the last 30 days.",
      insights: [{ kind: "tip", tone: "neutral", title: "Nothing to analyse yet", body: "Once you add, send or withdraw money, your insights will appear here." }],
    };
  }

  const p = facts.spentChangePercent;
  const headline =
    p === null
      ? `You spent ${naira(facts.current.spent)} in the last 30 days.`
      : p === 0
        ? `You spent ${naira(facts.current.spent)} in the last 30 days, the same as the 30 days before.`
        : `You spent ${naira(facts.current.spent)} in the last 30 days, ${Math.abs(p)}% ${p < 0 ? "less" : "more"} than the 30 days before.`;

  const insights: Insight[] = [];
  const top = facts.categories.find((c) => c.category !== "UNCATEGORISED" && !new Prisma.Decimal(c.current).isZero());
  if (top && top.category !== "UNCATEGORISED") {
    insights.push({
      kind: "category",
      tone: "neutral",
      category: top.category,
      title: `${CATEGORY_LABELS[top.category]} led your spending`,
      body: `You spent ${naira(top.current)} on ${CATEGORY_LABELS[top.category].toLowerCase()}${top.changePercent === null ? "." : top.changePercent === 0 ? ", the same as before." : `, ${top.changePercent > 0 ? "up" : "down"} ${Math.abs(top.changePercent)}% on the 30 days before.`}`,
    });
  }
  const recipient = facts.topRecipients[0];
  if (recipient) {
    insights.push({
      kind: "recipient",
      tone: "neutral",
      title: `You sent the most to ${recipient.name}`,
      body: `${naira(recipient.total)} across ${recipient.count} payment${recipient.count === 1 ? "" : "s"} this period.`,
    });
  }
  const regular = facts.regularPayments[0];
  if (regular) {
    insights.push({
      kind: "regular",
      tone: "neutral",
      title: `A regular payment to ${regular.name}`,
      body: `You've paid ${regular.name} about ${naira(regular.typicalAmount)} in each of the last three months.`,
    });
  }
  const unusual = facts.unusualSpends[0];
  if (unusual) {
    insights.push({
      kind: "unusual",
      tone: "attention",
      title: "A larger payment than usual",
      body: `${naira(unusual.amount)}${unusual.recipient ? ` to ${unusual.recipient}` : ""} on ${day(unusual.date)} is about ${unusual.timesTypical} times your typical payment.`,
    });
  }
  return { headline, insights: insights.slice(0, 4) };
};
