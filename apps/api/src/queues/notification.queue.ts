import { Queue } from "bullmq";
import { bullmqConnection } from "../config/redis.config";

export type NotificationType =
  | "money.received"
  | "money.sent"
  | "withdrawal.started"
  | "withdrawal.paid"
  | "withdrawal.failed"
  | "security.pin_set"
  | "security.pin_changed"
  | "security.pin_locked"
  | "security.new_device"
  | "security.password_changed"
  | "security.account_frozen"
  | "security.account_unfrozen"
  | "security.pin_unlocked"
  | "account.adjustment"
  | "account.tier_changed"
  | "account.upgrade_submitted"
  | "account.upgrade_approved"
  | "account.upgrade_rejected";

export interface NotificationJobData {
  // Generated when the event happens, so a retried job updates the same row instead of duplicating it
  id: string;
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  // Where the email's button should take the user, e.g. "/wallet"
  actionPath?: string;
}

// A one-off email with no in-app notification, e.g. a password reset link, which must never be
// stored where it can be read back. Queued with removeOnComplete/removeOnFail so it doesn't linger.
export interface EmailJobData {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export const notificationQueue = new Queue<NotificationJobData | EmailJobData>("notifications", {
  connection: bullmqConnection,
  defaultJobOptions: {
    attempts: 5,
    backoff: { type: "exponential", delay: 10_000 },
    removeOnComplete: { count: 500 },
    removeOnFail: { count: 500 },
  },
});
