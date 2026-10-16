import { Worker, Job } from "bullmq";
import { bullmqConnection } from "../config/redis.config";
import type { EmailJobData, NotificationJobData } from "../queues/notification.queue";
import { sendEmail } from "../services/notifications/email.service";
import { deliverNotification } from "../services/notifications/notification.service";

type NotificationQueueData = NotificationJobData | EmailJobData;

export const processNotificationJob = async (job: Job<NotificationQueueData>): Promise<void> => {
  if (job.name === "email") {
    await sendEmail(job.data as EmailJobData);
    return;
  }
  await deliverNotification(job.data as NotificationJobData);
};

export const createNotificationWorker = (): Worker<NotificationQueueData> =>
  new Worker<NotificationQueueData>("notifications", processNotificationJob, {
    connection: bullmqConnection,
    concurrency: 5,
  });
