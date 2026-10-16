import { Router } from "express";
import {
  credit,
  debit,
  balance,
  transactions,
  transfer,
  reverse,
  stats,
  statement,
  transactionDetail,
} from "../controllers/wallet.controller";
import { authenticate } from "../middleware/auth.middleware";
import { requireDirectFunding } from "../middleware/directFunding.middleware";
import { requireActiveAccount } from "../middleware/frozen.middleware";
import { requirePin } from "../middleware/pin.middleware";
import { requireVerifiedEmail } from "../middleware/verified.middleware";
import { readLimiter, walletLimiter } from "../middleware/rateLimiter.middleware";
import { validate } from "../middleware/validate.middleware";
import { updateCategory } from "../controllers/insights.controller";
import { categorySchema } from "../validators/insights.validators";
import { creditSchema, debitSchema, transferSchema } from "../validators/wallet.validators";

const router = Router();
router.post("/credit", authenticate, requireVerifiedEmail, requireDirectFunding, walletLimiter, validate(creditSchema), credit);
router.post("/debit", authenticate, requireVerifiedEmail, requireActiveAccount, requireDirectFunding, walletLimiter, validate(debitSchema), debit);
router.post("/transfer", authenticate, requireVerifiedEmail, requireActiveAccount, walletLimiter, validate(transferSchema), requirePin, transfer);
router.post("/transactions/:transactionId/reverse", authenticate, requireDirectFunding, walletLimiter, reverse);
router.get("/balance", authenticate, readLimiter, balance);
router.get("/transactions", authenticate, readLimiter, transactions);
router.get("/stats", authenticate, readLimiter, stats);
router.get("/statement", authenticate, readLimiter, statement);
router.get("/transactions/:transactionId", authenticate, readLimiter, transactionDetail);
router.patch("/transactions/:transactionId/category", authenticate, walletLimiter, validate(categorySchema), updateCategory);

export default router;
