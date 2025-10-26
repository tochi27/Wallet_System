import { Request, Response } from "express";
import bcrypt from "bcryptjs";
import { findUserByEmail, registerUser } from "../services/auth.service";
import { errorResponse, successResponse } from "../utils/response.utils";
import { generateToken } from "../utils/jwt.utils";
import { addToBlacklistWithExpiry } from "../utils/tokenBlacklist.utils";
import jwt from "jsonwebtoken";

// User Sign-up controller
export const signup = async (req: Request, res: Response): Promise<any> => {
  try {
    const { name, email, password } = req.body;
    const existing = await findUserByEmail(email);
    if (existing) return errorResponse(res, "Email already exists", 400);

    const user = await registerUser(name, email, password);
    return successResponse(res, "Signup successful", { user }, 200);
  } catch (error) {
    return errorResponse(res, "Signup failed", 500);
  }
};

// User Log-in controller
export const login = async (req: Request, res: Response): Promise<any> => {
  try {
    const { email, password } = req.body;
    const user = await findUserByEmail(email);
    if (!user) return errorResponse(res, "Invalid credentials", 400);

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return errorResponse(res, "Invalid credentials", 400);

    const token = generateToken(user.id.toString());

    if (!token) return errorResponse(res, "Failed to generate token", 400);
    return successResponse(res, "Login successful", { token }, 200);
  } catch (error) {
    return errorResponse(res, "Login failed", 500);
  }
};

// User Log-out controller
export const logout = (req: Request, res: Response) => {
  const authHeader = req.headers.authorization;
  if (!authHeader)
    return errorResponse(res, "Authorization header missing", 400);

  const token = authHeader.split(" ")[1];
  if (!token) return errorResponse(res, "Invalid token format", 400);

  // Option 2: Add with JWT expiry (preferred)
  const decoded = jwt.decode(token) as any;
  const expiresIn = decoded?.exp
    ? decoded.exp - Math.floor(Date.now() / 1000)
    : 3600;
  addToBlacklistWithExpiry(token, expiresIn);

  return successResponse(res, "Logout successful", {}, 200);
};
