import bcrypt from "bcryptjs";
import prisma from "../../config/db";
import { notify } from "../notifications/notification.service";

export const PIN_PATTERN = /^\d{4}$/;
const MAX_ATTEMPTS = 5;
const LOCK_MINUTES = 30;
const HASH_ROUNDS = 10;

/**
 * PIN problems carry their own HTTP status. Never 401: the web app treats 401 as "session
 * expired" and signs the user out, which a mistyped PIN must not do.
 */
export class PinError extends Error {
  readonly status: number;
  readonly code: "PIN_NOT_SET" | "PIN_INCORRECT" | "PIN_LOCKED" | "PIN_EXISTS" | "PASSWORD_INCORRECT";

  constructor(message: string, status: number, code: PinError["code"]) {
    super(message);
    this.name = "PinError";
    this.status = status;
    this.code = code;
  }
}

const lockMessage = (until: Date) => {
  const minutes = Math.max(1, Math.ceil((until.getTime() - Date.now()) / 60_000));
  return `Too many wrong PINs. Transfers and withdrawals are locked for ${minutes} more minute${minutes === 1 ? "" : "s"}.`;
};

const checkPassword = async (userId: string, password: string) => {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { password: true } });
  if (!(await bcrypt.compare(password, user.password))) {
    throw new PinError("Incorrect password", 400, "PASSWORD_INCORRECT");
  }
};

/** First-time PIN. Requires the account password, so a hijacked session can't set one. */
export const setPin = async (userId: string, password: string, pin: string): Promise<void> => {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { transactionPinHash: true } });
  if (user.transactionPinHash) throw new PinError("You already have a PIN. Change it instead.", 409, "PIN_EXISTS");
  await checkPassword(userId, password);

  await prisma.user.update({
    where: { id: userId },
    data: { transactionPinHash: await bcrypt.hash(pin, HASH_ROUNDS), pinFailedAttempts: 0, pinLockedUntil: null },
  });
  await notify({
    userId,
    type: "security.pin_set",
    title: "Transaction PIN set",
    body: "You set a transaction PIN. You'll need it to send money and withdraw. If this wasn't you, change your password now.",
    actionPath: "/settings",
  });
};

/**
 * Checks a PIN before money moves. Five wrong attempts lock transfers and withdrawals for 30
 * minutes; the counter increments atomically so parallel guesses can't exceed the limit.
 */
export const verifyPin = async (userId: string, pin: string): Promise<void> => {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { transactionPinHash: true, pinFailedAttempts: true, pinLockedUntil: true },
  });
  if (!user.transactionPinHash) throw new PinError("Set a transaction PIN first", 403, "PIN_NOT_SET");
  if (user.pinLockedUntil && user.pinLockedUntil > new Date()) {
    throw new PinError(lockMessage(user.pinLockedUntil), 423, "PIN_LOCKED");
  }

  if (await bcrypt.compare(pin, user.transactionPinHash)) {
    if (user.pinFailedAttempts > 0 || user.pinLockedUntil) {
      await prisma.user.update({ where: { id: userId }, data: { pinFailedAttempts: 0, pinLockedUntil: null } });
    }
    return;
  }

  const { pinFailedAttempts } = await prisma.user.update({
    where: { id: userId },
    data: { pinFailedAttempts: { increment: 1 } },
    select: { pinFailedAttempts: true },
  });

  if (pinFailedAttempts >= MAX_ATTEMPTS) {
    const until = new Date(Date.now() + LOCK_MINUTES * 60_000);
    await prisma.user.update({ where: { id: userId }, data: { pinFailedAttempts: 0, pinLockedUntil: until } });
    await notify({
      userId,
      type: "security.pin_locked",
      title: "Transfers and withdrawals locked",
      body: `Someone entered the wrong transaction PIN ${MAX_ATTEMPTS} times, so transfers and withdrawals are locked for ${LOCK_MINUTES} minutes. If this wasn't you, change your password and PIN.`,
      actionPath: "/settings",
    });
    throw new PinError(lockMessage(until), 423, "PIN_LOCKED");
  }

  const left = MAX_ATTEMPTS - pinFailedAttempts;
  throw new PinError(`Incorrect PIN. ${left} attempt${left === 1 ? "" : "s"} left.`, 400, "PIN_INCORRECT");
};

/** Changes the PIN, proving identity with either the current PIN or the account password. */
export const changePin = async (
  userId: string,
  proof: { currentPin?: string; password?: string },
  newPin: string
): Promise<void> => {
  if (proof.currentPin) await verifyPin(userId, proof.currentPin);
  else if (proof.password) await checkPassword(userId, proof.password);
  else throw new PinError("Enter your current PIN or your password", 400, "PIN_INCORRECT");

  await prisma.user.update({
    where: { id: userId },
    data: { transactionPinHash: await bcrypt.hash(newPin, HASH_ROUNDS), pinFailedAttempts: 0, pinLockedUntil: null },
  });
  await notify({
    userId,
    type: "security.pin_changed",
    title: "Transaction PIN changed",
    body: "Your transaction PIN was changed. If this wasn't you, change your password now.",
    actionPath: "/settings",
  });
};
