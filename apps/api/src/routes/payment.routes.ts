import { Router } from "express";
import {
  bankAccounts,
  banks,
  deleteBankAccount,
  depositStatus,
  paystackWebhook,
  resolveBankAccount,
  saveBankAccount,
  startDeposit,
  startWithdrawal,
  withdrawals,
} from "../controllers/payment.controller";
import { authenticate } from "../middleware/auth.middleware";
import { readLimiter, walletLimiter } from "../middleware/rateLimiter.middleware";
import { validate } from "../middleware/validate.middleware";
import { bankAccountSchema, depositSchema, withdrawalSchema } from "../validators/payment.validators";

const router = Router();

router.post("/deposits", authenticate, walletLimiter, validate(depositSchema), startDeposit);
router.get("/deposits/:reference", authenticate, readLimiter, depositStatus);

router.get("/banks", authenticate, readLimiter, banks);
// Lookups call Paystack (and are limited there), so they count against the tighter write budget
router.post("/bank-accounts/resolve", authenticate, walletLimiter, validate(bankAccountSchema), resolveBankAccount);
router.post("/bank-accounts", authenticate, walletLimiter, validate(bankAccountSchema), saveBankAccount);
router.get("/bank-accounts", authenticate, readLimiter, bankAccounts);
router.delete("/bank-accounts/:id", authenticate, walletLimiter, deleteBankAccount);

router.post("/withdrawals", authenticate, walletLimiter, validate(withdrawalSchema), startWithdrawal);
router.get("/withdrawals", authenticate, readLimiter, withdrawals);

// No auth or rate limit: Paystack calls this, authenticated by its signature
router.post("/paystack/webhook", paystackWebhook);

export default router;
