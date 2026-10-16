import { Router } from "express";
import { insights, refreshInsights } from "../controllers/insights.controller";
import { authenticate } from "../middleware/auth.middleware";
import { readLimiter, walletLimiter } from "../middleware/rateLimiter.middleware";
import { validate } from "../middleware/validate.middleware";
import { refreshInsightsSchema } from "../validators/insights.validators";

const router = Router();

router.get("/", authenticate, readLimiter, insights);
router.post("/refresh", authenticate, walletLimiter, validate(refreshInsightsSchema), refreshInsights);

export default router;
