import { Router } from "express";
import {
  createPin,
  limits,
  notifications,
  readAllNotifications,
  readNotification,
  savePreferences,
  updatePassword,
  updatePin,
} from "../controllers/account.controller";
import { authenticate } from "../middleware/auth.middleware";
import { uploadIdDocuments } from "../middleware/upload.middleware";
import { requireVerifiedEmail } from "../middleware/verified.middleware";
import { submitUpgradeRequest, support, upgradeStatus } from "../controllers/kyc.controller";
import { upgradeSchema } from "../validators/kyc.validators";
import { authLimiter, readLimiter, walletLimiter } from "../middleware/rateLimiter.middleware";
import { validate } from "../middleware/validate.middleware";
import {
  changePasswordSchema,
  changePinSchema,
  preferencesSchema,
  setPinSchema,
} from "../validators/account.validators";

const router = Router();

router.post("/pin", authenticate, walletLimiter, validate(setPinSchema), createPin);
router.put("/pin", authenticate, walletLimiter, validate(changePinSchema), updatePin);
// The auth limit, since a wrong current password is a guess at it
router.put("/password", authenticate, authLimiter, validate(changePasswordSchema), updatePassword);
router.patch("/preferences", authenticate, walletLimiter, validate(preferencesSchema), savePreferences);

router.get("/limits", authenticate, readLimiter, limits);
// Tier upgrade: the user sends their ID; staff review it in the admin console
router.get("/upgrade", authenticate, readLimiter, upgradeStatus);
router.post("/upgrade", authenticate, requireVerifiedEmail, walletLimiter, uploadIdDocuments, validate(upgradeSchema), submitUpgradeRequest);
router.get("/support", authenticate, readLimiter, support);
router.get("/notifications", authenticate, readLimiter, notifications);
router.post("/notifications/read-all", authenticate, readLimiter, readAllNotifications);
router.post("/notifications/:id/read", authenticate, readLimiter, readNotification);

export default router;
