import { Router } from "express";
import { credit, debit, balance, transactions } from "../controllers/wallet.controller";
import { authenticate } from "../middleware/auth.middleware";

const router = Router();
router.post("/credit", authenticate, credit);
router.post("/debit", authenticate, debit);
router.get("/balance", authenticate, balance);
router.get("/transactions", authenticate, transactions);

export default router;
