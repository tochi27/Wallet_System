import request from "supertest";
import app from "../../app";
import { env } from "../../config/env";
import { creditWallet, debitWallet } from "../../services/wallet.service";
import { reverseTransaction } from "../../services/reversal.service";
import { transferFunds } from "../../services/transfer.service";
import { validateAmount } from "../../utils/validateAmount.utils";

jest.mock("../../config/env", () => {
  const actual = jest.requireActual("../../config/env");
  return { env: { ...actual.env, DIRECT_FUNDING_ENABLED: false } };
});

jest.mock("../../middleware/auth.middleware", () => ({
  authenticate: (req: any, _res: any, next: any) => {
    req.userId = "user123";
    next();
  },
}));

jest.mock("../../services/wallet.service.ts");
jest.mock("../../services/transfer.service.ts");
jest.mock("../../services/reversal.service.ts");
jest.mock("../../utils/validateAmount.utils.ts");

const setEnabled = (enabled: boolean) => {
  (env as { DIRECT_FUNDING_ENABLED: boolean }).DIRECT_FUNDING_ENABLED = enabled;
};

describe("Direct funding guard (DIRECT_FUNDING_ENABLED)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setEnabled(false);
  });

  describe("when disabled", () => {
    it.each([
      ["POST", "/api/wallet/credit", { amount: 100 }],
      ["POST", "/api/wallet/debit", { amount: 100 }],
      ["POST", "/api/wallet/transactions/tx-1/reverse", {}],
    ])("%s %s returns 403 without touching the wallet", async (_method, path, body) => {
      const res = await request(app).post(path).set("Authorization", "Bearer token").send(body);

      expect(res.status).toBe(403);
      expect(res.body.message).toMatch(/Paystack deposit/);
      expect(creditWallet).not.toHaveBeenCalled();
      expect(debitWallet).not.toHaveBeenCalled();
      expect(reverseTransaction).not.toHaveBeenCalled();
    });

    it("still allows transfers between wallets, which move existing balance", async () => {
      (validateAmount as jest.Mock).mockReturnValue(50);
      (transferFunds as jest.Mock).mockResolvedValue({ transferId: "t1" });

      const res = await request(app)
        .post("/api/wallet/transfer")
        .set("Authorization", "Bearer token")
        .send({ amount: 50, receiverEmail: "friend@example.com" });

      expect(res.status).toBe(200);
      expect(transferFunds).toHaveBeenCalled();
    });
  });

  describe("when enabled", () => {
    it("lets direct credits through", async () => {
      setEnabled(true);
      (validateAmount as jest.Mock).mockReturnValue(100);
      (creditWallet as jest.Mock).mockResolvedValue({ id: "tx-1" });

      const res = await request(app).post("/api/wallet/credit").set("Authorization", "Bearer token").send({ amount: 100 });

      expect(res.status).toBe(200);
      expect(creditWallet).toHaveBeenCalled();
    });
  });
});
