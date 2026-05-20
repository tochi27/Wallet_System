import { Router } from "express";
import { credit, debit, balance, transactions, transfer, reverse } from "../controllers/wallet.controller";
import { authenticate } from "../middleware/auth.middleware";
import { walletLimiter } from "../middleware/rateLimiter.middleware";
import { validate } from "../middleware/validate.middleware";
import { creditSchema, debitSchema, transferSchema } from "../validators/wallet.validators";

const router = Router();
router.post("/credit", authenticate, walletLimiter, validate(creditSchema), credit);
router.post("/debit", authenticate, walletLimiter, validate(debitSchema), debit);
router.post("/transfer", authenticate, walletLimiter, validate(transferSchema), transfer);
router.post("/transactions/:transactionId/reverse", authenticate, walletLimiter, reverse);
router.get("/balance", authenticate, walletLimiter, balance);
router.get("/transactions", authenticate, walletLimiter, transactions);

export default router;
