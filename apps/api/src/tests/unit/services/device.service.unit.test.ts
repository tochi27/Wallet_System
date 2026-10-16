import prisma from "../../../config/db";
import { notify } from "../../../services/notifications/notification.service";
import { describeDevice, recordSignIn } from "../../../services/security/device.service";

jest.mock("../../../config/db", () => ({
  __esModule: true,
  default: { knownDevice: { findUnique: jest.fn(), update: jest.fn(), count: jest.fn(), create: jest.fn() } },
}));
jest.mock("../../../services/notifications/notification.service", () => ({ notify: jest.fn() }));

const CHROME_WINDOWS =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";
const SAFARI_IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";

describe("device.service", () => {
  beforeEach(() => jest.clearAllMocks());

  it("describes common browsers in plain words", () => {
    expect(describeDevice(CHROME_WINDOWS)).toBe("Chrome on Windows");
    expect(describeDevice(SAFARI_IPHONE)).toBe("Safari on iOS");
    expect(describeDevice(undefined)).toBe("a browser on an unknown device");
  });

  it("just refreshes a device it already knows", async () => {
    (prisma.knownDevice.findUnique as jest.Mock).mockResolvedValue({ id: "d1" });

    await recordSignIn("u1", CHROME_WINDOWS);

    expect(prisma.knownDevice.update).toHaveBeenCalledWith({ where: { id: "d1" }, data: { lastSeenAt: expect.any(Date) } });
    expect(notify).not.toHaveBeenCalled();
  });

  it("does not alert on the very first sign-in", async () => {
    (prisma.knownDevice.findUnique as jest.Mock).mockResolvedValue(null);
    (prisma.knownDevice.count as jest.Mock).mockResolvedValue(0);

    await recordSignIn("u1", CHROME_WINDOWS);

    expect(prisma.knownDevice.create).toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });

  it("alerts when a new kind of device signs in", async () => {
    (prisma.knownDevice.findUnique as jest.Mock).mockResolvedValue(null);
    (prisma.knownDevice.count as jest.Mock).mockResolvedValue(1);

    await recordSignIn("u1", SAFARI_IPHONE);

    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "u1", type: "security.new_device", data: { device: "Safari on iOS" } })
    );
  });
});
