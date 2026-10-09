import { Router } from "express";
import { signup, login, logout, me } from "../controllers/auth.controller";
import { authenticate } from "../middleware/auth.middleware";
import { authLimiter, readLimiter } from "../middleware/rateLimiter.middleware";
import { validate } from "../middleware/validate.middleware";
import { signupSchema, loginSchema } from "../validators/auth.validators";

const router = Router();
router.post("/signup", authLimiter, validate(signupSchema), signup);
router.post("/login", authLimiter, validate(loginSchema), login);
router.post("/logout", logout);
router.get("/me", authenticate, readLimiter, me);

export default router;
