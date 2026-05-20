import request from "supertest";
import { validateAmount } from "../../utils/validateAmount.utils";
import {
  creditWallet,
  debitWallet,
  getBalance,
  computeBalance,
  getTransactions,
} from "../../services/wallet.service";
import { transferFunds } from "../../services/transfer.service";
import { reverseTransaction } from "../../services/reversal.service";
import { generateToken } from "../../utils/jwt.utils";
import app from "../../app";

jest.mock("../../middleware/auth.middleware", () => ({
  authenticate: (req: any, res: any, next: any) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({ message: "Authorization header missing" });
    }
    req.userId = "user123";
    next();
  },
}));

jest.mock("../../services/wallet.service.ts");
jest.mock("../../services/transfer.service.ts");
jest.mock("../../services/reversal.service.ts");
jest.mock("../../utils/validateAmount.utils.ts");

const mockTx = (overrides = {}) => ({
  id: "tx-id",
  reference: "ref-uuid",
  userId: "user123",
  type: "CREDIT",
  status: "SUCCESSFUL",
  amount: 100,
  balanceBefore: 0,
  balanceAfter: 100,
  description: null,
  timestamp: new Date(),
  ...overrides,
});

describe("Wallet Controllers (Integration with Express + Supertest)", () => {
  const userId = "user123";
  let token: string;

  beforeAll(() => {
    token = generateToken(userId);
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ---------- CREDIT ----------
  describe("POST /api/wallet/credit", () => {
    it("should credit the wallet successfully", async () => {
      (validateAmount as jest.Mock).mockReturnValue(100);
      (creditWallet as jest.Mock).mockResolvedValue(
        mockTx({ type: "CREDIT", amount: 100, balanceBefore: 0, balanceAfter: 100 })
      );

      const res = await request(app)
        .post("/api/wallet/credit")
        .set("Authorization", `Bearer ${token}`)
        .send({ amount: 100 });

      expect(res.status).toBe(200);
      expect(res.body.message).toBe("Wallet credited successfully");
      expect(res.body.data.balanceAfter).toBe(100);
      expect(res.body.data.reference).toBeDefined();
    });

    it("should throw error if token missing", async () => {
      const res = await request(app)
        .post("/api/wallet/credit")
        .send({ amount: 100 });

      expect(res.status).toBe(401);
      expect(res.body.message).toBe("Authorization header missing");
    });

    it("should forward Idempotency-Key header to the service", async () => {
      (validateAmount as jest.Mock).mockReturnValue(100);
      (creditWallet as jest.Mock).mockResolvedValue(mockTx());

      await request(app)
        .post("/api/wallet/credit")
        .set("Authorization", `Bearer ${token}`)
        .set("Idempotency-Key", "idem-key-001")
        .send({ amount: 100 });

      expect(creditWallet).toHaveBeenCalledWith(
        userId, 100, undefined, "idem-key-001"
      );
    });
  });

  // ---------- DEBIT ----------
  describe("POST /api/wallet/debit", () => {
    it("should debit the wallet successfully", async () => {
      (validateAmount as jest.Mock).mockReturnValue(50);
      (debitWallet as jest.Mock).mockResolvedValue(
        mockTx({ type: "DEBIT", amount: 50, balanceBefore: 200, balanceAfter: 150 })
      );

      const res = await request(app)
        .post("/api/wallet/debit")
        .set("Authorization", `Bearer ${token}`)
        .send({ amount: 50 });

      expect(res.status).toBe(200);
      expect(res.body.message).toBe("Wallet debited successfully");
      expect(res.body.data.balanceAfter).toBe(150);
    });

    it("should return 400 if insufficient balance", async () => {
      (validateAmount as jest.Mock).mockReturnValue(300);
      (debitWallet as jest.Mock).mockRejectedValue(new Error("Insufficient funds"));

      const res = await request(app)
        .post("/api/wallet/debit")
        .set("Authorization", `Bearer ${token}`)
        .send({ amount: 300 });

      expect(res.status).toBe(400);
      expect(res.body.message).toBe("Insufficient funds");
    });

    it("should throw error if token missing", async () => {
      const res = await request(app)
        .post("/api/wallet/debit")
        .send({ amount: 50 });

      expect(res.status).toBe(401);
    });

    it("should forward Idempotency-Key header to the service", async () => {
      (validateAmount as jest.Mock).mockReturnValue(50);
      (debitWallet as jest.Mock).mockResolvedValue(
        mockTx({ type: "DEBIT", amount: 50, balanceBefore: 200, balanceAfter: 150 })
      );

      await request(app)
        .post("/api/wallet/debit")
        .set("Authorization", `Bearer ${token}`)
        .set("Idempotency-Key", "idem-key-002")
        .send({ amount: 50 });

      expect(debitWallet).toHaveBeenCalledWith(
        userId, 50, undefined, "idem-key-002"
      );
    });
  });

  // ---------- BALANCE ----------
  describe("GET /api/wallet/balance", () => {
    it("should fetch wallet balance and computed balance successfully", async () => {
      (getBalance as jest.Mock).mockResolvedValue({ balance: 400 });
      (computeBalance as jest.Mock).mockResolvedValue(400);

      const res = await request(app)
        .get("/api/wallet/balance")
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.message).toBe("Wallet balance fetched successfully");
      expect(res.body.data.balance).toBe(400);
      expect(res.body.data.computed).toBeDefined();
    });
  });

  // ---------- TRANSACTIONS ----------
  describe("GET /api/wallet/transactions", () => {
    it("should fetch first page of transactions with nextCursor null", async () => {
      const mockTxs = [
        mockTx({ id: "tx1", type: "CREDIT", amount: 100, balanceBefore: 0, balanceAfter: 100 }),
        mockTx({ id: "tx2", type: "DEBIT", amount: 50, balanceBefore: 100, balanceAfter: 50 }),
      ];
      (getTransactions as jest.Mock).mockResolvedValue({ items: mockTxs, nextCursor: null });

      const res = await request(app)
        .get("/api/wallet/transactions")
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.message).toBe("Transaction history fetched successfully");
      expect(res.body.data.items).toHaveLength(2);
      expect(res.body.data.nextCursor).toBeNull();
      expect(res.body.data.items[0].balanceBefore).toBeDefined();
      expect(res.body.data.items[0].balanceAfter).toBeDefined();
    });

    it("should forward limit and cursor query params to the service", async () => {
      (getTransactions as jest.Mock).mockResolvedValue({ items: [], nextCursor: null });

      const res = await request(app)
        .get("/api/wallet/transactions?limit=5&cursor=some-cursor-id")
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(getTransactions).toHaveBeenCalledWith("user123", 5, "some-cursor-id");
    });

    it("should return nextCursor when more pages exist", async () => {
      (getTransactions as jest.Mock).mockResolvedValue({
        items: [mockTx()],
        nextCursor: "next-page-cursor-id",
      });

      const res = await request(app)
        .get("/api/wallet/transactions?limit=1")
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.data.nextCursor).toBe("next-page-cursor-id");
    });

    it("should return 400 for limit out of range", async () => {
      const res = await request(app)
        .get("/api/wallet/transactions?limit=0")
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(400);
    });
  });

  // ---------- TRANSFER ----------
  describe("POST /api/wallet/transfer", () => {
    const mockTransferResult = {
      transferId: "transfer-uuid",
      sender: mockTx({ type: "DEBIT", amount: 100, balanceBefore: 500, balanceAfter: 400 }),
      receiver: mockTx({ id: "tx-receiver", type: "CREDIT", amount: 100, balanceBefore: 0, balanceAfter: 100 }),
    };

    it("should transfer funds successfully", async () => {
      (validateAmount as jest.Mock).mockReturnValue(100);
      (transferFunds as jest.Mock).mockResolvedValue(mockTransferResult);

      const res = await request(app)
        .post("/api/wallet/transfer")
        .set("Authorization", `Bearer ${token}`)
        .set("Idempotency-Key", "unique-key-001")
        .send({ receiverEmail: "receiver@example.com", amount: 100 });

      expect(res.status).toBe(200);
      expect(res.body.message).toBe("Transfer successful");
      expect(res.body.data.transferId).toBeDefined();
      expect(res.body.data.sender.type).toBe("DEBIT");
      expect(res.body.data.receiver.type).toBe("CREDIT");
    });

    it("should return 400 if receiverEmail is missing", async () => {
      (validateAmount as jest.Mock).mockReturnValue(100);

      const res = await request(app)
        .post("/api/wallet/transfer")
        .set("Authorization", `Bearer ${token}`)
        .send({ amount: 100 });

      expect(res.status).toBe(400);
      expect(res.body.message).toBe("receiverEmail is required");
    });

    it("should return 400 if insufficient funds", async () => {
      (validateAmount as jest.Mock).mockReturnValue(9999);
      (transferFunds as jest.Mock).mockRejectedValue(new Error("Insufficient funds"));

      const res = await request(app)
        .post("/api/wallet/transfer")
        .set("Authorization", `Bearer ${token}`)
        .send({ receiverEmail: "receiver@example.com", amount: 9999 });

      expect(res.status).toBe(400);
      expect(res.body.message).toBe("Insufficient funds");
    });

    it("should return 400 if receiver not found", async () => {
      (validateAmount as jest.Mock).mockReturnValue(100);
      (transferFunds as jest.Mock).mockRejectedValue(new Error("Receiver not found"));

      const res = await request(app)
        .post("/api/wallet/transfer")
        .set("Authorization", `Bearer ${token}`)
        .send({ receiverEmail: "ghost@example.com", amount: 100 });

      expect(res.status).toBe(400);
      expect(res.body.message).toBe("Receiver not found");
    });

    it("should return 400 if transferring to yourself", async () => {
      (validateAmount as jest.Mock).mockReturnValue(100);
      (transferFunds as jest.Mock).mockRejectedValue(new Error("Cannot transfer to yourself"));

      const res = await request(app)
        .post("/api/wallet/transfer")
        .set("Authorization", `Bearer ${token}`)
        .send({ receiverEmail: "self@example.com", amount: 100 });

      expect(res.status).toBe(400);
      expect(res.body.message).toBe("Cannot transfer to yourself");
    });

    it("should return 401 if token missing", async () => {
      const res = await request(app)
        .post("/api/wallet/transfer")
        .send({ receiverEmail: "receiver@example.com", amount: 100 });

      expect(res.status).toBe(401);
    });
  });

  // ---------- REVERSAL ----------
  describe("POST /api/wallet/transactions/:transactionId/reverse", () => {
    const txId = "tx-to-reverse";

    it("should reverse a single transaction successfully", async () => {
      (reverseTransaction as jest.Mock).mockResolvedValue(
        mockTx({ id: "reversal-tx", type: "DEBIT", status: "SUCCESSFUL", reversalOf: txId })
      );

      const res = await request(app)
        .post(`/api/wallet/transactions/${txId}/reverse`)
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.message).toBe("Transaction reversed successfully");
      expect(res.body.data.reversalOf).toBe(txId);
    });

    it("should return 404 if transaction not found", async () => {
      (reverseTransaction as jest.Mock).mockRejectedValue(new Error("Transaction not found"));

      const res = await request(app)
        .post(`/api/wallet/transactions/ghost-id/reverse`)
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(404);
      expect(res.body.message).toBe("Transaction not found");
    });

    it("should return 409 if already reversed", async () => {
      (reverseTransaction as jest.Mock).mockRejectedValue(
        new Error("Transaction has already been reversed")
      );

      const res = await request(app)
        .post(`/api/wallet/transactions/${txId}/reverse`)
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(409);
      expect(res.body.message).toBe("Transaction has already been reversed");
    });

    it("should return 400 if reversing a reversal", async () => {
      (reverseTransaction as jest.Mock).mockRejectedValue(new Error("Cannot reverse a reversal"));

      const res = await request(app)
        .post(`/api/wallet/transactions/${txId}/reverse`)
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(400);
      expect(res.body.message).toBe("Cannot reverse a reversal");
    });

    it("should return 400 if insufficient funds for reversal", async () => {
      (reverseTransaction as jest.Mock).mockRejectedValue(
        new Error("Insufficient funds to reverse this transaction")
      );

      const res = await request(app)
        .post(`/api/wallet/transactions/${txId}/reverse`)
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(400);
      expect(res.body.message).toBe("Insufficient funds to reverse this transaction");
    });

    it("should return 401 if token missing", async () => {
      const res = await request(app)
        .post(`/api/wallet/transactions/${txId}/reverse`);

      expect(res.status).toBe(401);
    });
  });
});
