import { Router } from "express";
import { ask } from "../controllers/assistant.controller";
import { authenticate } from "../middleware/auth.middleware";
import { walletLimiter } from "../middleware/rateLimiter.middleware";
import { validate } from "../middleware/validate.middleware";
import { askSchema } from "../validators/assistant.validators";

const router = Router();

router.post("/", authenticate, walletLimiter, validate(askSchema), ask);

export default router;
