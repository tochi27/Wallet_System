import jwt from "jsonwebtoken";
import { env } from "../config/env";

export const generateToken = (userId: string) => {
  return jwt.sign({ userId }, env.JWT_SECRET, { expiresIn: "1d" });
};

export const verifyToken = (token: string) => {
  return jwt.verify(token, env.JWT_SECRET);
};
