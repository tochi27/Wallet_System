import prisma from "../../../config/db";
import { queueInsightsRefresh } from "../../../queues/insights.queue";
import { AiUnavailableError, generateJson, isAiConfigured } from "../../../services/ai/gemini.client";
import { categoriseRecentSpends } from "../../../services/insights/categorise.service";
import { buildFacts, type InsightFacts } from "../../../services/insights/facts.service";
import {
  generateInsights,
  InsightsError,
  requestRefresh,
  setInsightsEnabled,
  setTransactionCategory,
} from "../../../services/insights/insights.service";
import redisClient from "../../../services/redis.service";

jest.mock("../../../config/db", () => ({
  __esModule: true,
  default: {
    user: { findUnique: jest.fn(), findUniqueOrThrow: jest.fn(), update: jest.fn() },
    spendingInsight: { upsert: jest.fn((args) => Promise.resolve(args.create)), deleteMany: jest.fn() },
    transaction: { findFirst: jest.fn(), update: jest.fn() },
    withdrawal: { findUnique: jest.fn() },
  },
}));
jest.mock("../../../config/env", () => ({ env: { GEMINI_MODEL: "main", GEMINI_CATEGORY_MODEL: "lite" } }));
jest.mock("../../../services/ai/gemini.client", () => ({
  ...jest.requireActual("../../../services/ai/gemini.client"),
  generateJson: jest.fn(),
  isAiConfigured: jest.fn(),
}));
jest.mock("../../../services/insights/categorise.service", () => ({ categoriseRecentSpends: jest.fn() }));
jest.mock("../../../services/insights/facts.service", () => ({
  ...jest.requireActual("../../../services/insights/facts.service"),
  buildFacts: jest.fn(),
}));
jest.mock("../../../queues/insights.queue", () => ({ queueInsightsRefresh: jest.fn(), isRefreshPending: jest.fn() }));
jest.mock("../../../services/redis.service", () => ({ __esModule: true, default: { incr: jest.fn(), expire: jest.fn() } }));

const facts: InsightFacts = {
  timezone: "Africa/Lagos",
  period: { from: "2026-09-15", to: "2026-10-14" },
  previousPeriod: { from: "2026-08-16", to: "2026-09-14" },
  current: { moneyIn: "0.00", spent: "381000.00", withdrawn: "0.00", spendCount: 3 },
  previous: { moneyIn: "0.00", spent: "246900.00", withdrawn: "0.00", spendCount: 2 },
  spentChangePercent: 54,
  categories: [{ category: "FOOD", current: "70000.00", previous: "24000.00", changePercent: 192 }],
  topRecipients: [{ userId: "u-emeka", name: "Emeka", total: "150000.00", count: 1 }],
  largestSpend: null,
  regularPayments: [],
  unusualSpends: [],
  uncategorisedCount: 0,
};

const saved = () => (prisma.spendingInsight.upsert as jest.Mock).mock.calls[0][0].create;

describe("insights.service", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (prisma.user.findUnique as jest.Mock).mockResolvedValue({ aiInsightsEnabled: true });
    (prisma.user.findUniqueOrThrow as jest.Mock).mockResolvedValue({ aiInsightsEnabled: true });
    (buildFacts as jest.Mock).mockResolvedValue(facts);
    (isAiConfigured as jest.Mock).mockReturnValue(true);
  });

  describe("generateInsights", () => {
    it("stores AI wording when every figure checks out, with real names restored", async () => {
      (generateJson as jest.Mock).mockResolvedValue({
        model: "main",
        data: {
          headline: "Spending is up 54% to ₦381,000.",
          insights: [{ kind: "recipient", tone: "neutral", title: "Top recipient", body: "You sent Person A ₦150,000." }],
        },
      });

      await generateInsights("u1", "Africa/Lagos");

      expect(categoriseRecentSpends).toHaveBeenCalledWith("u1");
      const prompt = (generateJson as jest.Mock).mock.calls[0][0].prompt as string;
      expect(prompt).not.toContain("Emeka");
      expect(saved()).toMatchObject({ source: "AI", model: "main", periodTo: "2026-10-14" });
      expect(saved().content.insights[0].body).toBe("You sent Emeka ₦150,000.");
    });

    it("falls back to templates when the AI invents a figure", async () => {
      (generateJson as jest.Mock).mockResolvedValue({
        model: "main",
        data: { headline: "You spent ₦1,000,000!", insights: [{ kind: "tip", tone: "neutral", title: "t", body: "b" }] },
      });

      await generateInsights("u1", "Africa/Lagos");

      expect(saved()).toMatchObject({ source: "TEMPLATE", model: null });
      expect(saved().content.headline).toMatch(/You spent ₦381,000/);
    });

    it("falls back to templates when the AI is unavailable, and when categorising fails", async () => {
      (categoriseRecentSpends as jest.Mock).mockRejectedValue(new AiUnavailableError());
      (generateJson as jest.Mock).mockRejectedValue(new AiUnavailableError());

      await generateInsights("u1", "Africa/Lagos");

      expect(saved().source).toBe("TEMPLATE");
    });

    it("doesn't call the AI at all without a key", async () => {
      (isAiConfigured as jest.Mock).mockReturnValue(false);

      await generateInsights("u1", "Africa/Lagos");

      expect(generateJson).not.toHaveBeenCalled();
      expect(saved().source).toBe("TEMPLATE");
    });

    it("does nothing if the user has opted out since the job was queued", async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue({ aiInsightsEnabled: false });

      await expect(generateInsights("u1", "Africa/Lagos")).resolves.toBeNull();
      expect(categoriseRecentSpends).not.toHaveBeenCalled();
      expect(prisma.spendingInsight.upsert).not.toHaveBeenCalled();
    });
  });

  describe("requestRefresh", () => {
    it("queues a refresh within the daily allowance", async () => {
      (redisClient.incr as jest.Mock).mockResolvedValue(1);

      await requestRefresh("u1", "Africa/Lagos");

      expect(redisClient.expire).toHaveBeenCalled();
      expect(queueInsightsRefresh).toHaveBeenCalledWith("u1", "Africa/Lagos");
    });

    it("refuses the sixth refresh of the day with 429", async () => {
      (redisClient.incr as jest.Mock).mockResolvedValue(6);

      await expect(requestRefresh("u1", "Africa/Lagos")).rejects.toMatchObject({ status: 429 });
      expect(queueInsightsRefresh).not.toHaveBeenCalled();
    });

    it("refuses when insights are off", async () => {
      (prisma.user.findUniqueOrThrow as jest.Mock).mockResolvedValue({ aiInsightsEnabled: false });

      await expect(requestRefresh("u1", "Africa/Lagos")).rejects.toBeInstanceOf(InsightsError);
    });
  });

  describe("setInsightsEnabled", () => {
    it("records consent and queues the first insights when opting in", async () => {
      await setInsightsEnabled("u1", true, "Africa/Lagos");

      expect((prisma.user.update as jest.Mock).mock.calls[0][0].data).toMatchObject({ aiInsightsEnabled: true, aiInsightsConsentAt: expect.any(Date) });
      expect(queueInsightsRefresh).toHaveBeenCalled();
    });

    it("deletes stored insights when opting out", async () => {
      await setInsightsEnabled("u1", false, "Africa/Lagos");

      expect(prisma.spendingInsight.deleteMany).toHaveBeenCalledWith({ where: { userId: "u1" } });
      expect(queueInsightsRefresh).not.toHaveBeenCalled();
    });
  });

  describe("setTransactionCategory", () => {
    it("saves the user's own category", async () => {
      (prisma.transaction.findFirst as jest.Mock).mockResolvedValue({ id: "t1", type: "DEBIT" });
      (prisma.withdrawal.findUnique as jest.Mock).mockResolvedValue(null);

      await setTransactionCategory("u1", "t1", "FOOD");

      expect((prisma.transaction.update as jest.Mock).mock.calls[0][0].data).toEqual({ category: "FOOD", categorySource: "USER" });
    });

    it.each([
      ["someone else's or missing transaction", null, null, 404],
      ["money in", { id: "t1", type: "CREDIT" }, null, 400],
      ["a withdrawal to their own bank", { id: "t1", type: "DEBIT" }, { id: "w1" }, 400],
    ])("refuses %s", async (_label, transaction, withdrawal, status) => {
      (prisma.transaction.findFirst as jest.Mock).mockResolvedValue(transaction);
      (prisma.withdrawal.findUnique as jest.Mock).mockResolvedValue(withdrawal);

      await expect(setTransactionCategory("u1", "t1", "FOOD")).rejects.toMatchObject({ status });
      expect(prisma.transaction.update).not.toHaveBeenCalled();
    });
  });
});
