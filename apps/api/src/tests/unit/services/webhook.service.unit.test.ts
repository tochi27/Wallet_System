import prisma from "../../../config/db";
import { webhookQueue } from "../../../queues/webhook.queue";
import {
  registerWebhook,
  listWebhooks,
  deleteWebhook,
  dispatchWebhooksForUser,
  getDeliveries,
} from "../../../services/webhook.service";

jest.mock("../../../config/db", () => ({
  __esModule: true,
  default: {
    webhook: {
      create: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    webhookDelivery: { findMany: jest.fn() },
  },
}));

jest.mock("../../../queues/webhook.queue", () => ({
  webhookQueue: { add: jest.fn().mockResolvedValue({ id: "mock-job-id" }) },
}));

describe("webhook.service — unit", () => {
  beforeEach(() => {
    jest.resetAllMocks();
    (webhookQueue.add as jest.Mock).mockResolvedValue({ id: "mock-job-id" });
  });

  // ── registerWebhook ───────────────────────────────────────────────────────

  describe("registerWebhook", () => {
    it("creates webhook and returns record including one-time secret", async () => {
      const created = {
        id: "wh-001",
        url: "https://example.com/hook",
        events: ["CREDIT"],
        isActive: true,
        createdAt: new Date(),
        secret: "abc123",
      };
      (prisma.webhook.create as jest.Mock).mockResolvedValue(created);

      const res = await registerWebhook("user-001", "https://example.com/hook", ["CREDIT"]);

      expect(res).toBe(created);
      expect(prisma.webhook.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId: "user-001",
            url: "https://example.com/hook",
            events: ["CREDIT"],
          }),
        })
      );
      const createArg = (prisma.webhook.create as jest.Mock).mock.calls[0][0];
      expect(createArg.data.secret).toMatch(/^[0-9a-f]{64}$/);
    });
  });

  // ── listWebhooks ──────────────────────────────────────────────────────────

  describe("listWebhooks", () => {
    it("queries active webhooks for user, sorted newest first", async () => {
      const webhooks = [
        { id: "wh-001", url: "https://a.com", events: ["CREDIT"], isActive: true, createdAt: new Date() },
        { id: "wh-002", url: "https://b.com", events: ["DEBIT"], isActive: true, createdAt: new Date() },
      ];
      (prisma.webhook.findMany as jest.Mock).mockResolvedValue(webhooks);

      const res = await listWebhooks("user-001");

      expect(res).toBe(webhooks);
      expect(prisma.webhook.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: "user-001", isActive: true },
          orderBy: { createdAt: "desc" },
        })
      );
    });
  });

  // ── deleteWebhook ─────────────────────────────────────────────────────────

  describe("deleteWebhook", () => {
    it("soft-deletes webhook by setting isActive to false", async () => {
      const webhook = { id: "wh-001", userId: "user-001", isActive: true };
      (prisma.webhook.findUnique as jest.Mock).mockResolvedValue(webhook);
      (prisma.webhook.update as jest.Mock).mockResolvedValue({ ...webhook, isActive: false });

      await deleteWebhook("wh-001", "user-001");

      expect(prisma.webhook.update).toHaveBeenCalledWith({
        where: { id: "wh-001" },
        data: { isActive: false },
      });
    });

    it("throws Webhook not found when record does not exist", async () => {
      (prisma.webhook.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(deleteWebhook("wh-001", "user-001")).rejects.toThrow("Webhook not found");
    });

    it("throws Webhook not found when userId does not match", async () => {
      (prisma.webhook.findUnique as jest.Mock).mockResolvedValue({
        id: "wh-001",
        userId: "other-user",
      });

      await expect(deleteWebhook("wh-001", "user-001")).rejects.toThrow("Webhook not found");
    });
  });

  // ── dispatchWebhooksForUser ───────────────────────────────────────────────

  describe("dispatchWebhooksForUser", () => {
    it("enqueues a dispatch job for each matching webhook", async () => {
      const webhooks = [
        { id: "wh-001", url: "https://a.com", secret: "secret1" },
        { id: "wh-002", url: "https://b.com", secret: "secret2" },
      ];
      (prisma.webhook.findMany as jest.Mock).mockResolvedValue(webhooks);

      await dispatchWebhooksForUser("user-001", "CREDIT", { amount: "100" });

      expect(webhookQueue.add).toHaveBeenCalledTimes(2);
      expect(webhookQueue.add).toHaveBeenCalledWith("dispatch", {
        webhookId: "wh-001",
        url: "https://a.com",
        secret: "secret1",
        event: "CREDIT",
        payload: { amount: "100" },
      });
      expect(webhookQueue.add).toHaveBeenCalledWith("dispatch", {
        webhookId: "wh-002",
        url: "https://b.com",
        secret: "secret2",
        event: "CREDIT",
        payload: { amount: "100" },
      });
    });

    it("does not enqueue any jobs when no webhooks match", async () => {
      (prisma.webhook.findMany as jest.Mock).mockResolvedValue([]);

      await dispatchWebhooksForUser("user-001", "CREDIT", {});

      expect(webhookQueue.add).not.toHaveBeenCalled();
    });

    it("queries for both event-specific and wildcard subscriptions", async () => {
      (prisma.webhook.findMany as jest.Mock).mockResolvedValue([]);

      await dispatchWebhooksForUser("user-001", "DEBIT", {});

      expect(prisma.webhook.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            userId: "user-001",
            isActive: true,
            OR: [{ events: { has: "DEBIT" } }, { events: { has: "*" } }],
          }),
        })
      );
    });
  });

  // ── getDeliveries ─────────────────────────────────────────────────────────

  describe("getDeliveries", () => {
    it("returns delivery records for a webhook owned by the user", async () => {
      const webhook = { id: "wh-001", userId: "user-001" };
      const deliveryList = [
        { id: "d-1", event: "CREDIT", statusCode: 200, success: true, attempt: 1, error: null, createdAt: new Date() },
        { id: "d-2", event: "CREDIT", statusCode: 500, success: false, attempt: 2, error: "HTTP 500", createdAt: new Date() },
      ];
      (prisma.webhook.findUnique as jest.Mock).mockResolvedValue(webhook);
      (prisma.webhookDelivery.findMany as jest.Mock).mockResolvedValue(deliveryList);

      const res = await getDeliveries("wh-001", "user-001");

      expect(res).toBe(deliveryList);
      expect(prisma.webhookDelivery.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { webhookId: "wh-001" },
          orderBy: { createdAt: "desc" },
          take: 50,
        })
      );
    });

    it("throws Webhook not found when webhook does not exist", async () => {
      (prisma.webhook.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(getDeliveries("wh-001", "user-001")).rejects.toThrow("Webhook not found");
    });

    it("throws Webhook not found when userId does not match", async () => {
      (prisma.webhook.findUnique as jest.Mock).mockResolvedValue({ id: "wh-001", userId: "other" });

      await expect(getDeliveries("wh-001", "user-001")).rejects.toThrow("Webhook not found");
    });

    it("respects a custom limit", async () => {
      (prisma.webhook.findUnique as jest.Mock).mockResolvedValue({ id: "wh-001", userId: "user-001" });
      (prisma.webhookDelivery.findMany as jest.Mock).mockResolvedValue([]);

      await getDeliveries("wh-001", "user-001", 10);

      expect(prisma.webhookDelivery.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 10 })
      );
    });
  });
});
