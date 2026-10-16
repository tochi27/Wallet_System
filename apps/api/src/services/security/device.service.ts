import { createHash } from "crypto";
import prisma from "../../config/db";
import { notify } from "../notifications/notification.service";

// Readable "Chrome on Windows" from a user-agent string; good enough for an alert, not for tracking
export const describeDevice = (userAgent: string | undefined): string => {
  const ua = userAgent ?? "";
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /OPR\//.test(ua)
      ? "Opera"
      : /Chrome\//.test(ua)
        ? "Chrome"
        : /Firefox\//.test(ua)
          ? "Firefox"
          : /Safari\//.test(ua)
            ? "Safari"
            : "a browser";
  const os = /Windows/.test(ua)
    ? "Windows"
    : /Android/.test(ua)
      ? "Android"
      : /iPhone|iPad|iOS/.test(ua)
        ? "iOS"
        : /Mac OS X|Macintosh/.test(ua)
          ? "macOS"
          : /Linux/.test(ua)
            ? "Linux"
            : "an unknown device";
  return `${browser} on ${os}`;
};

/**
 * Remembers the browser a user signed in from and alerts them when it's one we haven't seen
 * before. The very first sign-in isn't flagged — every device is new then.
 *
 * The fingerprint is the user-agent only (IP addresses change too often on mobile networks), so
 * this catches "a different kind of device", not every new machine.
 */
export const recordSignIn = async (userId: string, userAgent: string | undefined): Promise<void> => {
  const fingerprint = createHash("sha256").update(userAgent ?? "unknown").digest("hex");
  const label = describeDevice(userAgent);

  const known = await prisma.knownDevice.findUnique({ where: { userId_fingerprint: { userId, fingerprint } } });
  if (known) {
    await prisma.knownDevice.update({ where: { id: known.id }, data: { lastSeenAt: new Date() } });
    return;
  }

  const hadDevicesBefore = (await prisma.knownDevice.count({ where: { userId } })) > 0;
  await prisma.knownDevice.create({ data: { userId, fingerprint, label } });

  if (hadDevicesBefore) {
    await notify({
      userId,
      type: "security.new_device",
      title: "New sign-in to your wallet",
      body: `Your account was just signed in to from ${label}. If this wasn't you, change your password and transaction PIN right away.`,
      data: { device: label },
      actionPath: "/settings",
    });
  }
};
