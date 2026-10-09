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

export const findUserById = async (id: string) => {
  return prisma.user.findUnique({ where: { id }, select: publicUserSelect });
};
