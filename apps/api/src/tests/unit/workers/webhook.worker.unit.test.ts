import { Job } from "bullmq";
import prisma from "../../../config/db";
import { processWebhookJob } from "../../../workers/webhook.worker";
import type { WebhookJobData } from "../../../queues/webhook.queue";

jest.mock("../../../config/db", () => ({
  __esModule: true,
  default: {
    webhookDelivery: { create: jest.fn() },
  },
}));

const makeJob = (overrides: Partial<WebhookJobData> = {}, attemptsMade = 0) =>
  ({
    data: {
      webhookId: "wh-001",
      url: "https://example.com/hook",
      secret: "my-secret",
      event: "CREDIT",
      payload: { amount: "100" },
      ...overrides,
    },
    attemptsMade,
  }) as unknown as Job<WebhookJobData>;

describe("webhook.worker — unit", () => {
  beforeEach(() => {
    jest.resetAllMocks();
    (global as Record<string, unknown>).fetch = jest.fn();
    (prisma.webhookDelivery.create as jest.Mock).mockResolvedValue({});
  });

  it("records a successful delivery on 2xx response", async () => {
    (global.fetch as jest.Mock).mockResolvedValue({ ok: true, status: 200 });

    await processWebhookJob(makeJob());

    expect(prisma.webhookDelivery.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          webhookId: "wh-001",
          event: "CREDIT",
          success: true,
          statusCode: 200,
          attempt: 1,
          error: null,
        }),
      })
    );
  });

  it("records attempt number from job.attemptsMade + 1", async () => {
    (global.fetch as jest.Mock).mockResolvedValue({ ok: true, status: 200 });

    await processWebhookJob(makeJob({}, 2));

    expect(prisma.webhookDelivery.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ attempt: 3 }),
      })
    );
  });

  it("records failed delivery and throws on non-2xx so BullMQ retries", async () => {
    (global.fetch as jest.Mock).mockResolvedValue({ ok: false, status: 503 });

    await expect(processWebhookJob(makeJob())).rejects.toThrow("HTTP 503");

    expect(prisma.webhookDelivery.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          success: false,
          statusCode: 503,
          error: "HTTP 503",
        }),
      })
    );
  });

  it("records failed delivery and throws on network error", async () => {
    (global.fetch as jest.Mock).mockRejectedValue(new Error("ECONNREFUSED"));

    await expect(processWebhookJob(makeJob())).rejects.toThrow("ECONNREFUSED");

    expect(prisma.webhookDelivery.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          success: false,
          statusCode: null,
          error: "ECONNREFUSED",
        }),
      })
    );
  });

  it("sends HMAC-SHA256 signature and event headers", async () => {
    (global.fetch as jest.Mock).mockResolvedValue({ ok: true, status: 200 });

    await processWebhookJob(makeJob());

    const [, options] = (global.fetch as jest.Mock).mock.calls[0];
    expect(options.headers["X-Webhook-Signature"]).toMatch(/^sha256=[0-9a-f]{64}$/);
    expect(options.headers["X-Webhook-Event"]).toBe("CREDIT");
  });

  it("posts to the webhook URL with JSON content-type", async () => {
    (global.fetch as jest.Mock).mockResolvedValue({ ok: true, status: 200 });

    await processWebhookJob(makeJob());

    const [url, options] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toBe("https://example.com/hook");
    expect(options.method).toBe("POST");
    expect(options.headers["Content-Type"]).toBe("application/json");
  });
});
