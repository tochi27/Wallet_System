import { Router } from "express";
import { register, list, remove, deliveries } from "../controllers/webhook.controller";
import { authenticate } from "../middleware/auth.middleware";
import { walletLimiter } from "../middleware/rateLimiter.middleware";
import { validate } from "../middleware/validate.middleware";
import { registerWebhookSchema } from "../validators/webhook.validators";

const router = Router();
router.post("/", authenticate, walletLimiter, validate(registerWebhookSchema), register);
router.get("/", authenticate, walletLimiter, list);
router.delete("/:webhookId", authenticate, walletLimiter, remove);
router.get("/:webhookId/deliveries", authenticate, walletLimiter, deliveries);

export default router;
