import { z } from "zod";

export const signupSchema = z.object({
  name: z.string().min(1, "Name is required").max(100),
  email: z.email("Invalid email address"),
  password: z.string().min(8, "Password must be at least 8 characters"),
});

export const loginSchema = z.object({
  email: z.email("Invalid email address"),
  password: z.string().min(1, "Password is required"),
});

export const newPasswordSchema = z
  .string({ error: "Password must be at least 8 characters" })
  .min(8, "Password must be at least 8 characters");

export const forgotPasswordSchema = z.object({
  email: z.email("Invalid email address"),
});

export const resetPasswordSchema = z.object({
  token: z
    .string({ error: "This reset link is invalid or has expired. Request a new one." })
    .min(1, "This reset link is invalid or has expired. Request a new one.")
    .max(200, "This reset link is invalid or has expired. Request a new one."),
  password: newPasswordSchema,
});

const invalidVerifyLink = "This verification link is invalid or has expired. Send yourself a new one.";
export const verifyEmailSchema = z.object({
  token: z.string({ error: invalidVerifyLink }).min(1, invalidVerifyLink).max(200, invalidVerifyLink),
});
