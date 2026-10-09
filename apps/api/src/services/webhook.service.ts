import { randomBytes } from "crypto";
import prisma from "../config/db";
import { webhookQueue } from "../queues/webhook.queue";

export const registerWebhook = async (
  userId: string,
  url: string,
  events: string[]
) => {
  const secret = randomBytes(32).toString("hex");
  return prisma.webhook.create({
    data: { userId, url, secret, events },
    select: { id: true, url: true, events: true, isActive: true, createdAt: true, secret: true },
  });
};

export const listWebhooks = async (userId: string) => {
  return prisma.webhook.findMany({
    where: { userId, isActive: true },
    select: { id: true, url: true, events: true, isActive: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  });
};

export const deleteWebhook = async (webhookId: string, userId: string) => {
  const webhook = await prisma.webhook.findUnique({ where: { id: webhookId } });
  if (!webhook || webhook.userId !== userId) throw new Error("Webhook not found");
  return prisma.webhook.update({ where: { id: webhookId }, data: { isActive: false } });
};

export const dispatchWebhooksForUser = async (
  userId: string,
  event: string,
  payload: object
): Promise<void> => {
  const webhooks = await prisma.webhook.findMany({
    where: {
      userId,
      isActive: true,
      OR: [{ events: { has: event } }, { events: { has: "*" } }],
    },
  });

  await Promise.all(
    webhooks.map((wh) =>
      webhookQueue.add("dispatch", {
        webhookId: wh.id,
        url: wh.url,
        secret: wh.secret,
        event,
        payload,
      })
    )
  );
};

export const getDeliveries = async (
  webhookId: string,
  userId: string,
  limit = 50
) => {
  const webhook = await prisma.webhook.findUnique({ where: { id: webhookId } });
  if (!webhook || webhook.userId !== userId) throw new Error("Webhook not found");
  return prisma.webhookDelivery.findMany({
    where: { webhookId },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      event: true,
      statusCode: true,
      success: true,
      attempt: true,
      error: true,
      createdAt: true,
    },
  });
};
