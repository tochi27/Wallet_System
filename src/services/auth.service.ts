import prisma from "../config/db";
import bcrypt from "bcryptjs";

export const registerUser = async (name: string, email: string, password: string) => {
  const hashedPassword = await bcrypt.hash(password, 10);
  const user = await prisma.user.create({
    data: {
      name,
      email,
      password: hashedPassword,
      wallet: { create: { balance: 0 } },
    },
  });
  return user;
};

export const findUserByEmail = async (email: string) => {
  return prisma.user.findUnique({ where: { email } });
};
