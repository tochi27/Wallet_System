import { Worker, Job } from "bullmq";
import { createHmac } from "crypto";
import prisma from "../config/db";
import { bullmqConnection } from "../config/redis.config";
import logger from "../config/logger";
import type { WebhookJobData } from "../queues/webhook.queue";

const DISPATCH_TIMEOUT_MS = 5000;

export const processWebhookJob = async (job: Job<WebhookJobData>): Promise<void> => {
  const { webhookId, url, secret, event, payload } = job.data;
  const attempt = job.attemptsMade + 1;
  const body = JSON.stringify({ event, data: payload, timestamp: new Date().toISOString() });
  const signature = createHmac("sha256", secret).update(body).digest("hex");

  let statusCode: number | null = null;
  let success = false;
  let error: string | null = null;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Webhook-Signature": `sha256=${signature}`,
        "X-Webhook-Event": event,
      },
      body,
      signal: AbortSignal.timeout(DISPATCH_TIMEOUT_MS),
    });
    statusCode = res.status;
    success = res.ok;
    if (!success) error = `HTTP ${statusCode}`;
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }

  await prisma.webhookDelivery.create({
    data: { webhookId, event, payload, statusCode, success, attempt, error },
  });

  if (!success) {
    throw new Error(error ?? "Webhook delivery failed");
  }

  logger.debug({ webhookId, event, attempt }, "Webhook delivered successfully");
};

export const createWebhookWorker = (): Worker<WebhookJobData> =>
  new Worker<WebhookJobData>("webhook-dispatch", processWebhookJob, {
    connection: bullmqConnection,
    concurrency: 10,
  });
