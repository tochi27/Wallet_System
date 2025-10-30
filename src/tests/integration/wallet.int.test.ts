import request from "supertest";
import { validateAmount } from "../../utils/validateAmount.utils";
import {
  creditWallet,
  debitWallet,
  getBalance,
  getTransactions,
} from "../../services/wallet.service";
import { generateToken } from "../../utils/jwt.utils";
import app from "../../app";

// --- Mock dependencies ---
jest.mock("../../middleware/auth.middleware", () => ({
  authenticate: (req: any, res: any, next: any) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({ message: "Authorization header missing" });
    }
    req.userId = "user123"; // Only set if token exists
    next();
  },
}));

jest.mock("../../services/wallet.service.ts");
jest.mock("../../utils/validateAmount.utils.ts");

describe("Wallet Controllers (Integration with Express + Supertest)", () => {
  const userId = "user123";
  let token: string;

  beforeAll(() => {
    // Generate a token once for all tests
    token = generateToken(userId);
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ---------- CREDIT ----------
  describe("POST /api/wallet/credit", () => {
    it("should credit the wallet successfully", async () => {
      (validateAmount as jest.Mock).mockReturnValue(100);
      (creditWallet as jest.Mock).mockResolvedValue({ balance: 500 });

      const res = await request(app)
        .post("/api/wallet/credit")
        .set("Authorization", `Bearer ${token}`) // Use token
        .send({ amount: 100 });

      expect(res.status).toBe(200);
      expect(res.body.message).toBe("Wallet credited successfully");
      expect(res.body.data.balance).toBe(500);
    });

    it("should throw error if token missing", async () => {
      const res = await request(app)
        .post("/api/wallet/credit")
        .send({ amount: 100 }); // no Authorization header

      expect(res.status).toBe(401);
      expect(res.body.message).toBe("Authorization header missing");
    });
  });

  // ---------- DEBIT ----------
  describe("POST /api/wallet/debit", () => {
    it("should debit the wallet successfully", async () => {
      (validateAmount as jest.Mock).mockReturnValue(50);
      (getBalance as jest.Mock).mockResolvedValue({ balance: 200 });
      (debitWallet as jest.Mock).mockResolvedValue({ balance: 150 });

      const res = await request(app)
        .post("/api/wallet/debit")
        .set("Authorization", `Bearer ${token}`)
        .send({ amount: 50 });

      expect(res.status).toBe(200);
      expect(res.body.message).toBe("Wallet debited successfully");
      expect(res.body.data.balance).toBe(150);
    });

    it("should throw error if insufficient balance", async () => {
      (validateAmount as jest.Mock).mockReturnValue(300);
      (getBalance as jest.Mock).mockResolvedValue({ balance: 200 });

      const res = await request(app)
        .post("/api/wallet/debit")
        .set("Authorization", `Bearer ${token}`)
        .send({ amount: 300 });

      expect(res.status).toBe(500);
      expect(res.body.message).toBe("Insufficient balance");
    });
  });

  // ---------- BALANCE ----------
  describe("GET /api/wallet/balance", () => {
    it("should fetch wallet balance successfully", async () => {
      (getBalance as jest.Mock).mockResolvedValue({ balance: 400 });

      const res = await request(app)
        .get("/api/wallet/balance")
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.message).toBe("Wallet balance fetched successfully");
      expect(res.body.data.balance).toBe(400);
    });
  });

  // ---------- TRANSACTIONS ----------
  describe("GET /api/wallet/transactions", () => {
    it("should fetch transactions successfully", async () => {
      const mockTxs = [
        { id: "tx1", amount: 100, type: "credit" },
        { id: "tx2", amount: 50, type: "debit" },
      ];
      (getTransactions as jest.Mock).mockResolvedValue(mockTxs);

      const res = await request(app)
        .get("/api/wallet/transactions")
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.message).toBe("Transaction history fetched successfully");
      expect(res.body.data).toEqual(mockTxs);
    });
  });
});
