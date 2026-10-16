import { randomUUID } from "crypto";
import { Prisma } from "@prisma/client";
import prisma from "../../config/db";
import logger from "../../config/logger";
import {
  notificationQueue,
  type EmailJobData,
  type NotificationJobData,
  type NotificationType,
} from "../../queues/notification.queue";
import { renderNotificationEmail, sendEmail } from "./email.service";

const naira = new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN" });
export const formatNaira = (amount: Prisma.Decimal | number | string) => naira.format(Number(amount));

export type NotifyInput = Omit<NotificationJobData, "id">;

/**
 * Queues a notification. Never throws: a notification problem must not undo or fail the money
 * movement that triggered it (the same rule as transaction events).
 */
export const notify = async (input: NotifyInput): Promise<void> => {
  const job: NotificationJobData = { id: randomUUID(), ...input };
  try {
    await notificationQueue.add("notify", job, { jobId: job.id });
  } catch (err) {
    logger.error({ err, type: input.type, userId: input.userId }, "Failed to queue notification");
  }
};

/**
 * Queues a one-off email that has no in-app notification. Unlike notify() this throws, so the
 * caller knows the email wasn't queued. The job is deleted once sent (or once it finally fails).
 */
export const queueEmail = async (email: EmailJobData): Promise<void> => {
  await notificationQueue.add("email", email, { removeOnComplete: true, removeOnFail: true });
};

const isSecurity =(type: NotificationType) => type.startsWith("security.");

/**
 * Runs on the notification worker: stores the in-app notification, then emails it if the user
 * allows money emails (security alerts are always emailed). Upserting by the job's id means a
 * retry after an email failure doesn't create a second in-app notification.
 */
export const deliverNotification = async (job: NotificationJobData): Promise<void> => {
  const user = await prisma.user.findUnique({
    where: { id: job.userId },
    select: { email: true, name: true, emailNotifications: true },
  });
  if (!user) return;

  await prisma.notification.upsert({
    where: { id: job.id },
    update: {},
    create: {
      id: job.id,
      userId: job.userId,
      type: job.type,
      title: job.title,
      body: job.body,
      data: (job.data ?? undefined) as Prisma.InputJsonValue | undefined,
    },
  });

  if (isSecurity(job.type) || user.emailNotifications) {
    const email = renderNotificationEmail({ name: user.name, title: job.title, body: job.body, actionPath: job.actionPath });
    await sendEmail({ to: user.email, ...email });
  }
};

export type NotificationView = {
  id: string;
  type: string;
  title: string;
  body: string;
  data: unknown;
  readAt: Date | null;
  createdAt: Date;
};

export const listNotifications = async (userId: string, limit = 30) => {
  const [items, unreadCount] = await Promise.all([
    prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: limit,
      select: { id: true, type: true, title: true, body: true, data: true, readAt: true, createdAt: true },
    }),
    prisma.notification.count({ where: { userId, readAt: null } }),
  ]);
  return { items: items as NotificationView[], unreadCount };
};

export const markNotificationRead = async (userId: string, id: string) => {
  await prisma.notification.updateMany({ where: { id, userId, readAt: null }, data: { readAt: new Date() } });
};

export const markAllNotificationsRead = async (userId: string) => {
  await prisma.notification.updateMany({ where: { userId, readAt: null }, data: { readAt: new Date() } });
};
