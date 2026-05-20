import { Router } from "express";
import { signup, login, logout } from "../controllers/auth.controller";
import { authLimiter } from "../middleware/rateLimiter.middleware";
import { validate } from "../middleware/validate.middleware";
import { signupSchema, loginSchema } from "../validators/auth.validators";

const router = Router();
router.post("/signup", authLimiter, validate(signupSchema), signup);
router.post("/login", authLimiter, validate(loginSchema), login);
router.post("/logout", logout);

export default router;
