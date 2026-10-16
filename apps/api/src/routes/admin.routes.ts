import { Router } from "express";
import {
  adjustments,
  approve,
  auditLog,
  changeRole,
  createAdjustment,
  ledger,
  ledgerEntries,
  reject,
  staff,
  deposits,
  freeze,
  changeTier,
  overview,
  paystackEvent,
  paystackEvents,
  recheckDepositStatus,
  recheckWithdrawalStatus,
  reconciliation,
  unfreeze,
  unlockUserPin,
  userDetail,
  users,
  withdrawals,
} from "../controllers/admin.controller";
import { requireAdmin, requirePermission } from "../middleware/admin.middleware";
import {
  approveUpgradeRequest,
  rejectUpgradeRequest,
  upgradeDocument,
  upgradeRequest,
  upgradeRequests,
} from "../controllers/kyc.controller";
import { rejectUpgradeSchema } from "../validators/kyc.validators";
import { authenticate } from "../middleware/auth.middleware";
import { authLimiter, readLimiter, walletLimiter } from "../middleware/rateLimiter.middleware";
import { validate } from "../middleware/validate.middleware";
import { adjustmentSchema, approveSchema, reasonSchema, rejectSchema, roleSchema, tierSchema } from "../validators/admin.validators";

const router = Router();

// Every admin route: a signed-in staff member (any role can view); actions need specific roles
router.use(authenticate, requireAdmin);
const manageUsers = requirePermission("users.manage");
const recheck = requirePermission("payments.recheck");
// ID checks hold personal documents, so even listing them needs the review permission
const reviewKyc = requirePermission("kyc.review");

router.get("/overview", readLimiter, overview);
router.get("/users", readLimiter, users);
router.get("/users/:id", readLimiter, userDetail);
router.post("/users/:id/freeze", manageUsers, walletLimiter, validate(reasonSchema), freeze);
router.post("/users/:id/unfreeze", manageUsers, walletLimiter, validate(reasonSchema), unfreeze);
router.post("/users/:id/tier", manageUsers, walletLimiter, validate(tierSchema), changeTier);
router.post("/users/:id/unlock-pin", manageUsers, walletLimiter, validate(reasonSchema), unlockUserPin);

router.get("/verifications", reviewKyc, readLimiter, upgradeRequests);
router.get("/verifications/:id", reviewKyc, readLimiter, upgradeRequest);
router.get("/verifications/:id/documents/:documentId", reviewKyc, readLimiter, upgradeDocument);
router.post("/verifications/:id/approve", reviewKyc, walletLimiter, approveUpgradeRequest);
router.post("/verifications/:id/reject", reviewKyc, walletLimiter, validate(rejectUpgradeSchema), rejectUpgradeRequest);

router.get("/deposits", readLimiter, deposits);
router.post("/deposits/:reference/recheck", recheck, walletLimiter, recheckDepositStatus);
router.get("/withdrawals", readLimiter, withdrawals);
router.post("/withdrawals/:reference/recheck", recheck, walletLimiter, recheckWithdrawalStatus);

router.get("/paystack-events", readLimiter, paystackEvents);
router.get("/paystack-events/:id", readLimiter, paystackEvent);
router.get("/reconciliation", readLimiter, reconciliation);
router.get("/audit-log", readLimiter, auditLog);

// Money and staff changes re-check the admin's password, so they share the auth rate limit
const manageAdjustments = requirePermission("adjustments.manage");
router.post("/users/:id/adjustments", manageAdjustments, authLimiter, validate(adjustmentSchema), createAdjustment);
router.get("/adjustments", readLimiter, adjustments);
router.post("/adjustments/:id/approve", manageAdjustments, authLimiter, validate(approveSchema), approve);
router.post("/adjustments/:id/reject", manageAdjustments, authLimiter, validate(rejectSchema), reject);

router.get("/staff", readLimiter, staff);
router.put("/users/:id/role", requirePermission("staff.manage"), authLimiter, validate(roleSchema), changeRole);

router.get("/ledger", readLimiter, ledger);
router.get("/ledger/entries", readLimiter, ledgerEntries);

export default router;
