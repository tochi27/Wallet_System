import prisma from "../../../config/db";
import { notificationQueue } from "../../../queues/notification.queue";
import { renderNotificationEmail, sendEmail } from "../../../services/notifications/email.service";
import { deliverNotification, notify } from "../../../services/notifications/notification.service";

jest.mock("../../../config/env", () => ({ env: { APP_URL: "https://wallet.example" } }));
jest.mock("../../../config/db", () => ({
  __esModule: true,
  default: {
    user: { findUnique: jest.fn() },
    notification: { upsert: jest.fn() },
  },
}));
jest.mock("../../../queues/notification.queue", () => ({ notificationQueue: { add: jest.fn() } }));
jest.mock("../../../services/notifications/email.service", () => ({
  ...jest.requireActual("../../../services/notifications/email.service"),
  sendEmail: jest.fn(),
}));

const job = (overrides: Record<string, unknown> = {}) => ({
  id: "n-1",
  userId: "u1",
  type: "money.received" as const,
  title: "Money received",
  body: "Grace sent you NGN 5,000.00.",
  ...overrides,
});

describe("notification.service", () => {
  beforeEach(() => jest.clearAllMocks());

  describe("notify", () => {
    it("queues the notification with its own id as the job id", async () => {
      await notify({ userId: "u1", type: "money.sent", title: "Transfer sent", body: "You sent NGN 1.00." });

      const [, data, options] = (notificationQueue.add as jest.Mock).mock.calls[0];
      expect(data).toMatchObject({ userId: "u1", type: "money.sent" });
      expect(options).toEqual({ jobId: data.id });
    });

    it("never throws, so a queue problem can't fail the payment that triggered it", async () => {
      (notificationQueue.add as jest.Mock).mockRejectedValue(new Error("Redis down"));

      await expect(notify({ userId: "u1", type: "money.sent", title: "t", body: "b" })).resolves.toBeUndefined();
    });
  });

  describe("deliverNotification", () => {
    it("stores the notification idempotently (a retry updates the same row)", async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue({ email: "ada@example.com", name: "Ada", emailNotifications: false });

      await deliverNotification(job());

      expect(prisma.notification.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: "n-1" }, update: {}, create: expect.objectContaining({ id: "n-1" }) })
      );
    });

    it("emails money notifications only when the user allows it", async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue({ email: "ada@example.com", name: "Ada", emailNotifications: false });
      await deliverNotification(job());
      expect(sendEmail).not.toHaveBeenCalled();

      (prisma.user.findUnique as jest.Mock).mockResolvedValue({ email: "ada@example.com", name: "Ada", emailNotifications: true });
      await deliverNotification(job());
      expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({ to: "ada@example.com", subject: "Money received" }));
    });

    it("always emails security alerts, even with money emails turned off", async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue({ email: "ada@example.com", name: "Ada", emailNotifications: false });

      await deliverNotification(job({ type: "security.new_device", title: "New sign-in" }));

      expect(sendEmail).toHaveBeenCalled();
    });

    it("lets an email failure bubble up so the job retries", async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue({ email: "ada@example.com", name: "Ada", emailNotifications: true });
      (sendEmail as jest.Mock).mockRejectedValue(new Error("Resend rejected the email (500)"));

      await expect(deliverNotification(job())).rejects.toThrow("Resend rejected");
    });
  });

  describe("renderNotificationEmail", () => {
    it("escapes user-controlled text so it can't inject markup", () => {
      const email = renderNotificationEmail({
        name: "<b>Mallory</b>",
        title: "Money received",
        body: 'Note: "<img src=x onerror=alert(1)>"',
      });

      expect(email.html).not.toContain("<img");
      expect(email.html).toContain("&lt;img src=x onerror=alert(1)&gt;");
      expect(email.html).toContain("Hi &lt;b&gt;Mallory&lt;/b&gt;");
      expect(email.text).toContain("https://wallet.example/wallet");
    });
  });
});
