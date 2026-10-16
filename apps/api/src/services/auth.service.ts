import prisma from "../config/db";
import bcrypt from "bcryptjs";

// Fields safe to return to clients — never include the password hash
const publicUserSelect = {
  id: true,
  name: true,
  email: true,
  createdAt: true,
} as const;

export const registerUser = async (name: string, email: string, password: string) => {
  const hashedPassword = await bcrypt.hash(password, 10);
  const user = await prisma.user.create({
    data: {
      name,
      email,
      password: hashedPassword,
      wallet: { create: { balance: 0 } },
    },
    select: publicUserSelect,
  });
  return user;
};

export const findUserByEmail = async (email: string) => {
  return prisma.user.findUnique({ where: { email } });
};

// Profile for the signed-in user: public fields plus their own settings (never the PIN hash)
export const findUserById = async (id: string) => {
  const user = await prisma.user.findUnique({
    where: { id },
    select: {
      ...publicUserSelect,
      emailNotifications: true,
      aiInsightsEnabled: true,
      passwordChangedAt: true,
      role: true,
      frozenAt: true,
      emailVerifiedAt: true,
      transactionPinHash: true,
      pinLockedUntil: true,
    },
  });
  if (!user) return null;
  const { transactionPinHash, pinLockedUntil, frozenAt, emailVerifiedAt, ...profile } = user;
  return {
    ...profile,
    // Money can't move until the email is verified
    emailVerified: emailVerifiedAt !== null,
    // The reason for a freeze is internal; the user only learns that their account is on hold
    frozen: frozenAt !== null,
    hasPin: transactionPinHash !== null,
    // Only an active lock matters to the client; an expired one is just a stale timestamp
    pinLockedUntil: pinLockedUntil && pinLockedUntil > new Date() ? pinLockedUntil : null,
  };
};

export const updatePreferences = async (id: string, preferences: { emailNotifications: boolean }) => {
  await prisma.user.update({ where: { id }, data: preferences });
  return findUserById(id);
};
