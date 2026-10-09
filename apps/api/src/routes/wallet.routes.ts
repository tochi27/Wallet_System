import { Router } from "express";
import { credit, debit, balance, transactions, transfer, reverse, stats } from "../controllers/wallet.controller";
import { authenticate } from "../middleware/auth.middleware";
import { requireDirectFunding } from "../middleware/directFunding.middleware";
import { readLimiter, walletLimiter } from "../middleware/rateLimiter.middleware";
import { validate } from "../middleware/validate.middleware";
import { creditSchema, debitSchema, transferSchema } from "../validators/wallet.validators";

const router = Router();
router.post("/credit", authenticate, requireDirectFunding, walletLimiter, validate(creditSchema), credit);
router.post("/debit", authenticate, requireDirectFunding, walletLimiter, validate(debitSchema), debit);
router.post("/transfer", authenticate, walletLimiter, validate(transferSchema), transfer);
router.post("/transactions/:transactionId/reverse", authenticate, requireDirectFunding, walletLimiter, reverse);
router.get("/balance", authenticate, readLimiter, balance);
router.get("/transactions", authenticate, readLimiter, transactions);
router.get("/stats", authenticate, readLimiter, stats);

export default router;
