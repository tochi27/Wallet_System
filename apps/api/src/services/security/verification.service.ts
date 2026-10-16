import { createHash, randomBytes } from "crypto";
import prisma from "../../config/db";
import { env } from "../../config/env";
import logger from "../../config/logger";
import redisClient from "../redis.service";
import { renderNotificationEmail } from "../notifications/email.service";
import { queueEmail } from "../notifications/notification.service";

export const VERIFY_TOKEN_TTL_HOURS = 24;
export const RESEND_COOLDOWN_SECONDS = 120;
export const RESEND_DAILY_LIMIT = 5;
const DAY_SECONDS = 24 * 60 * 60;

/**
 * Verification problems carry their own HTTP status. Never 401: the web app treats 401 as
 * "session expired" and signs the user out.
 */
export class VerificationError extends Error {
  readonly status: number;
  readonly code: "VERIFY_INVALID" | "ALREADY_VERIFIED" | "RESEND_COOLDOWN" | "RESEND_LIMIT";

  constructor(message: string, status: number, code: VerificationError["code"]) {
    super(message);
    this.name = "VerificationError";
    this.status = status;
    this.code = code;
  }
}

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

// Only this hash is stored, so reading the database doesn't give anyone a working link
export const hashVerificationToken = (token: string) => sha256(token);

const cooldownKey = (userId: string) => `email-verify:cooldown:${userId}`;
const dailyKey = (userId: string) => `email-verify:sent:${userId}`;

const invalidLink = () =>
  new VerificationError("This verification link is invalid or has expired. Send yourself a new one.", 400, "VERIFY_INVALID");

/**
 * Emails a fresh verification link, replacing any earlier unused one. Counts towards the resend
 * limits, so the link sent at signup can't be followed straight away by a resend.
 */
export const sendVerificationEmail = async (user: { id: string; name: string; email: string }): Promise<void> => {
  await redisClient.set(cooldownKey(user.id), "1", "EX", RESEND_COOLDOWN_SECONDS);
  const sent = await redisClient.incr(dailyKey(user.id));
  if (sent === 1) await redisClient.expire(dailyKey(user.id), DAY_SECONDS);

  const token = randomBytes(32).toString("base64url");
  await prisma.$transaction([
    prisma.emailVerificationToken.deleteMany({ where: { userId: user.id, usedAt: null } }),
    prisma.emailVerificationToken.create({
      data: {
        userId: user.id,
        tokenHash: hashVerificationToken(token),
        expiresAt: new Date(Date.now() + VERIFY_TOKEN_TTL_HOURS * 60 * 60_000),
      },
    }),
  ]);

  const actionPath = `/verify-email?token=${token}`;
  const message = renderNotificationEmail({
    name: user.name,
    title: "Verify your email",
    body: `Welcome to PurpleWallet! Confirm this is your email address to start adding, sending and withdrawing money. The link below expires in ${VERIFY_TOKEN_TTL_HOURS} hours.`,
    actionPath,
    actionLabel: "Verify email",
    footer: "If you didn't create a PurpleWallet account, ignore this email.",
  });
  await queueEmail({ to: user.email, ...message });

  // Without an email provider, local development would have no way to get the link
  if (!env.RESEND_API_KEY && env.NODE_ENV !== "production") {
    logger.info({ userId: user.id, link: `${env.APP_URL}${actionPath}` }, "Email verification link (development only)");
  }
};

/** Sends another link to a signed-in user who hasn't verified yet. One every 2 minutes, 5 a day. */
export const resendVerification = async (userId: string): Promise<{ email: string }> => {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { id: true, name: true, email: true, emailVerifiedAt: true },
  });
  if (user.emailVerifiedAt) throw new VerificationError("Your email is already verified", 409, "ALREADY_VERIFIED");

  const [cooldown, sent] = await Promise.all([redisClient.ttl(cooldownKey(userId)), redisClient.get(dailyKey(userId))]);
  if (cooldown > 0) {
    throw new VerificationError(
      `We've just sent you a link. You can ask for another in ${cooldown} second${cooldown === 1 ? "" : "s"}.`,
      429,
      "RESEND_COOLDOWN"
    );
  }
  if (Number(sent ?? 0) >= RESEND_DAILY_LIMIT) {
    throw new VerificationError(
      "You've asked for several links today. Check your inbox and spam folder, or try again tomorrow.",
      429,
      "RESEND_LIMIT"
    );
  }

  await sendVerificationEmail(user);
  return { email: user.email };
};

/**
 * Marks the email verified from a link. Works whether or not the person is signed in on this
 * device: holding the link proves they own the inbox. The token is claimed atomically, and a used
 * link that already verified the account answers "already verified" rather than an error, so
 * opening the email twice doesn't look like a failure.
 */
export const verifyEmail = async (token: string): Promise<"verified" | "already_verified"> => {
  const record = await prisma.emailVerificationToken.findUnique({
    where: { tokenHash: hashVerificationToken(token) },
    select: { id: true, userId: true, usedAt: true, expiresAt: true, user: { select: { emailVerifiedAt: true } } },
  });
  if (!record) throw invalidLink();
  if (record.usedAt) {
    if (record.user.emailVerifiedAt) return "already_verified";
    throw invalidLink();
  }
  const now = new Date();
  if (record.expiresAt <= now) throw invalidLink();

  return prisma.$transaction(async (tx) => {
    const claimed = await tx.emailVerificationToken.updateMany({
      where: { id: record.id, usedAt: null, expiresAt: { gt: now } },
      data: { usedAt: now },
    });
    // Lost a race with a second click on the same link, which has verified the account
    if (claimed.count === 0) return "already_verified" as const;

    const updated = await tx.user.updateMany({
      where: { id: record.userId, emailVerifiedAt: null },
      data: { emailVerifiedAt: now },
    });
    await tx.emailVerificationToken.deleteMany({ where: { userId: record.userId, usedAt: null } });
    return updated.count === 1 ? ("verified" as const) : ("already_verified" as const);
  });
};
