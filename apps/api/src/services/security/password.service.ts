import { createHash, randomBytes } from "crypto";
import bcrypt from "bcryptjs";
import prisma from "../../config/db";
import redisClient from "../redis.service";
import { renderNotificationEmail } from "../notifications/email.service";
import { notify, queueEmail } from "../notifications/notification.service";

export const RESET_TOKEN_TTL_MINUTES = 30;
const RESET_COOLDOWN_SECONDS = 120;
const HASH_ROUNDS = 10;

/**
 * Password problems carry their own HTTP status. Never 401: the web app treats 401 as "session
 * expired" and signs the user out, which a mistyped current password must not do.
 */
export class PasswordError extends Error {
  readonly status: number;
  readonly code: "RESET_INVALID" | "PASSWORD_INCORRECT" | "PASSWORD_UNCHANGED";

  constructor(message: string, status: number, code: PasswordError["code"]) {
    super(message);
    this.name = "PasswordError";
    this.status = status;
    this.code = code;
  }
}

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

// Only this hash is stored, so reading the database doesn't give anyone a working reset link
export const hashResetToken = (token: string) => sha256(token);

const cooldownKey = (email: string) => `password-reset:cooldown:${sha256(email.trim().toLowerCase())}`;

const invalidLink = () =>
  new PasswordError("This reset link is invalid or has expired. Request a new one.", 400, "RESET_INVALID");

/**
 * Emails a reset link if the address has an account. Callers answer the same way whatever this
 * returns, so the response never reveals whether an email is registered; the result is only for
 * logs and tests. One email per address every 2 minutes, registered or not.
 */
export const requestPasswordReset = async (email: string): Promise<"sent" | "cooldown" | "no_account"> => {
  const fresh = await redisClient.set(cooldownKey(email), "1", "EX", RESET_COOLDOWN_SECONDS, "NX");
  if (fresh !== "OK") return "cooldown";

  const user = await prisma.user.findUnique({ where: { email }, select: { id: true, name: true, email: true } });
  if (!user) return "no_account";

  const token = randomBytes(32).toString("base64url");
  await prisma.$transaction([
    // A new link replaces any earlier unused ones
    prisma.passwordResetToken.deleteMany({ where: { userId: user.id, usedAt: null } }),
    prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash: hashResetToken(token),
        expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MINUTES * 60_000),
      },
    }),
  ]);

  const message = renderNotificationEmail({
    name: user.name,
    title: "Reset your password",
    body: `We got a request to reset your PurpleWallet password. The link below works once and expires in ${RESET_TOKEN_TTL_MINUTES} minutes.`,
    actionPath: `/reset-password?token=${token}`,
    actionLabel: "Reset password",
    footer: "If you didn't ask to reset your password, ignore this email. Your password won't change.",
  });
  await queueEmail({ to: user.email, ...message });
  return "sent";
};

const passwordChangedAlert = (userId: string, body: string) =>
  notify({ userId, type: "security.password_changed", title: "Password changed", body, actionPath: "/settings" });

/**
 * Sets a new password from a reset link. The token is claimed atomically, so it works exactly
 * once even if the form is submitted twice. Every existing session is signed out (via
 * passwordChangedAt) and a PIN lockout is cleared, since the user has just proved who they are.
 */
export const resetPassword = async (token: string, newPassword: string): Promise<void> => {
  const record = await prisma.passwordResetToken.findUnique({
    where: { tokenHash: hashResetToken(token) },
    select: { id: true, userId: true, usedAt: true, expiresAt: true },
  });
  const now = new Date();
  if (!record || record.usedAt || record.expiresAt <= now) throw invalidLink();

  const password = await bcrypt.hash(newPassword, HASH_ROUNDS);
  await prisma.$transaction(async (tx) => {
    const claimed = await tx.passwordResetToken.updateMany({
      where: { id: record.id, usedAt: null, expiresAt: { gt: now } },
      data: { usedAt: now },
    });
    if (claimed.count === 0) throw invalidLink();

    await tx.user.update({
      where: { id: record.userId },
      data: { password, passwordChangedAt: now, pinFailedAttempts: 0, pinLockedUntil: null },
    });
    await tx.passwordResetToken.deleteMany({ where: { userId: record.userId, usedAt: null } });
  });

  await passwordChangedAlert(
    record.userId,
    "Your password was reset and every device was signed out. If this wasn't you, reset your password again right away and change your transaction PIN."
  );
};

/** Changes the password of a signed-in user, who must know the current one. Signs out every session. */
export const changePassword = async (userId: string, currentPassword: string, newPassword: string): Promise<void> => {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { password: true } });
  if (!(await bcrypt.compare(currentPassword, user.password))) {
    throw new PasswordError("Your current password is incorrect", 400, "PASSWORD_INCORRECT");
  }
  if (await bcrypt.compare(newPassword, user.password)) {
    throw new PasswordError("Choose a new password, not your current one", 400, "PASSWORD_UNCHANGED");
  }

  await prisma.user.update({
    where: { id: userId },
    data: { password: await bcrypt.hash(newPassword, HASH_ROUNDS), passwordChangedAt: new Date() },
  });
  // A reset link requested earlier must not be able to undo this change
  await prisma.passwordResetToken.deleteMany({ where: { userId, usedAt: null } });

  await passwordChangedAlert(
    userId,
    "Your password was changed and your other devices were signed out. If this wasn't you, reset your password right away."
  );
};
