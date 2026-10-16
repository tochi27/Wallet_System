import { Job } from "bullmq";
import { processNotificationJob } from "../../../workers/notification.worker";
import { sendEmail } from "../../../services/notifications/email.service";
import { deliverNotification } from "../../../services/notifications/notification.service";

jest.mock("../../../services/notifications/email.service", () => ({ sendEmail: jest.fn() }));
jest.mock("../../../services/notifications/notification.service", () => ({ deliverNotification: jest.fn() }));

const job = (name: string, data: object) => ({ name, data }) as unknown as Job<any>;

describe("notification worker", () => {
  beforeEach(() => jest.clearAllMocks());

  it("sends a one-off email without creating an in-app notification", async () => {
    const email = { to: "ada@example.com", subject: "Reset your password", html: "<p>x</p>", text: "x" };

    await processNotificationJob(job("email", email));

    expect(sendEmail).toHaveBeenCalledWith(email);
    expect(deliverNotification).not.toHaveBeenCalled();
  });

  it("delivers notifications", async () => {
    const data = { id: "n1", userId: "u1", type: "money.received", title: "t", body: "b" };

    await processNotificationJob(job("notify", data));

    expect(deliverNotification).toHaveBeenCalledWith(data);
    expect(sendEmail).not.toHaveBeenCalled();
  });
});
