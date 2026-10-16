import request from "supertest";
import app from "../../app";
import { updatePreferences } from "../../services/auth.service";
import { listNotifications, markAllNotificationsRead } from "../../services/notifications/notification.service";
import { changePin, PinError, setPin, verifyPin } from "../../services/security/pin.service";
import { getStatement, getTransactionDetail, TransactionNotFoundError } from "../../services/statement.service";
import { transferFunds } from "../../services/transfer.service";
import { validateAmount } from "../../utils/validateAmount.utils";

jest.mock("../../middleware/auth.middleware", () => ({
  authenticate: (req: any, res: any, next: any) => {
    if (!req.headers.authorization) return res.status(401).json({ success: false, message: "No token provided" });
    req.userId = "user123";
    req.emailVerified = true;
    next();
  },
}));
jest.mock("../../services/security/pin.service", () => ({
  ...jest.requireActual("../../services/security/pin.service"),
  setPin: jest.fn(),
  changePin: jest.fn(),
  verifyPin: jest.fn(),
}));
jest.mock("../../services/auth.service", () => ({ ...jest.requireActual("../../services/auth.service"), updatePreferences: jest.fn() }));
jest.mock("../../services/notifications/notification.service", () => ({
  ...jest.requireActual("../../services/notifications/notification.service"),
  listNotifications: jest.fn(),
  markAllNotificationsRead: jest.fn(),
  markNotificationRead: jest.fn(),
}));
jest.mock("../../services/statement.service", () => ({
  ...jest.requireActual("../../services/statement.service"),
  getStatement: jest.fn(),
  getTransactionDetail: jest.fn(),
}));
jest.mock("../../services/transfer.service.ts");
jest.mock("../../utils/validateAmount.utils.ts");

const auth = { Authorization: "Bearer token" };

describe("Account, PIN, notifications and statements", () => {
  beforeEach(() => jest.clearAllMocks());

  // ---------- PIN ----------
  describe("PIN endpoints", () => {
    it("sets a PIN", async () => {
      const res = await request(app).post("/api/account/pin").set(auth).send({ password: "password123", pin: "1357" });

      expect(res.status).toBe(200);
      expect(setPin).toHaveBeenCalledWith("user123", "password123", "1357");
    });

    it.each([
      [{ password: "x", pin: "12a4" }, "Your PIN must be 4 digits"],
      [{ password: "x", pin: "1111" }, "Choose a less guessable PIN (not 1111 or 1234)"],
      [{ password: "x", pin: "4321" }, "Choose a less guessable PIN (not 1111 or 1234)"],
      [{ pin: "1357" }, "Enter your account password"],
    ])("rejects %j", async (body, message) => {
      const res = await request(app).post("/api/account/pin").set(auth).send(body);

      expect(res.status).toBe(400);
      expect(res.body.message).toBe(message);
      expect(setPin).not.toHaveBeenCalled();
    });

    it("passes PIN errors through with their own status", async () => {
      (setPin as jest.Mock).mockRejectedValue(new PinError("Incorrect password", 400, "PASSWORD_INCORRECT"));

      const res = await request(app).post("/api/account/pin").set(auth).send({ password: "wrong", pin: "1357" });

      expect(res.status).toBe(400);
      expect(res.body.message).toBe("Incorrect password");
    });

    it("changes a PIN with the current PIN", async () => {
      const res = await request(app).put("/api/account/pin").set(auth).send({ currentPin: "1357", newPin: "2468" });

      expect(res.status).toBe(200);
      expect(changePin).toHaveBeenCalledWith("user123", { currentPin: "1357", password: undefined }, "2468");
    });
  });

  // ---------- PIN enforcement ----------
  describe("PIN on transfers", () => {
    beforeEach(() => (validateAmount as jest.Mock).mockReturnValue(100));
    const transfer = (body: object) => request(app).post("/api/wallet/transfer").set(auth).send(body);

    it("requires a 4-digit PIN before anything moves", async () => {
      const res = await transfer({ receiverEmail: "grace@example.com", amount: 100 });

      expect(res.status).toBe(400);
      expect(res.body.message).toBe("Enter your 4-digit transaction PIN");
      expect(verifyPin).not.toHaveBeenCalled();
      expect(transferFunds).not.toHaveBeenCalled();
    });

    it.each([
      [new PinError("Set a transaction PIN first", 403, "PIN_NOT_SET"), 403],
      [new PinError("Incorrect PIN. 4 attempts left.", 400, "PIN_INCORRECT"), 400],
      [new PinError("Too many wrong PINs.", 423, "PIN_LOCKED"), 423],
    ])("stops the transfer: %s", async (error, status) => {
      (verifyPin as jest.Mock).mockRejectedValue(error);

      const res = await transfer({ receiverEmail: "grace@example.com", amount: 100, pin: "1357" });

      expect(res.status).toBe(status);
      expect(transferFunds).not.toHaveBeenCalled();
    });

    it("does not spend a PIN attempt on a malformed request", async () => {
      const res = await transfer({ receiverEmail: "not-an-email", amount: 100, pin: "1357" });

      expect(res.status).toBe(400);
      expect(verifyPin).not.toHaveBeenCalled();
    });

    it("lets the transfer through with the right PIN", async () => {
      (verifyPin as jest.Mock).mockResolvedValue(undefined);
      (transferFunds as jest.Mock).mockResolvedValue({ transferId: "t1" });

      const res = await transfer({ receiverEmail: "grace@example.com", amount: 100, pin: "1357" });

      expect(res.status).toBe(200);
      expect(verifyPin).toHaveBeenCalledWith("user123", "1357");
    });
  });

  // ---------- Preferences and notifications ----------
  describe("preferences and notifications", () => {
    it("saves the email preference", async () => {
      (updatePreferences as jest.Mock).mockResolvedValue({ id: "user123", emailNotifications: false });

      const res = await request(app).patch("/api/account/preferences").set(auth).send({ emailNotifications: false });

      expect(res.status).toBe(200);
      expect(updatePreferences).toHaveBeenCalledWith("user123", { emailNotifications: false });
    });

    it("lists notifications with the unread count", async () => {
      (listNotifications as jest.Mock).mockResolvedValue({ items: [{ id: "n1" }], unreadCount: 1 });

      const res = await request(app).get("/api/account/notifications").set(auth);

      expect(res.status).toBe(200);
      expect(res.body.data.unreadCount).toBe(1);
    });

    it("marks everything read", async () => {
      const res = await request(app).post("/api/account/notifications/read-all").set(auth);

      expect(res.status).toBe(200);
      expect(markAllNotificationsRead).toHaveBeenCalledWith("user123");
    });
  });

  // ---------- Receipts and statements ----------
  describe("receipts and statements", () => {
    const statement = {
      holder: { name: "Ada", email: "ada@example.com" },
      from: "2026-10-01",
      to: "2026-10-31",
      timezone: "UTC",
      openingBalance: { toFixed: () => "0.00" },
      closingBalance: { toFixed: () => "0.00" },
      moneyIn: { toFixed: () => "0.00" },
      moneyOut: { toFixed: () => "0.00" },
      rows: [],
      generatedAt: new Date(),
    };

    it("returns a receipt for the caller's own transaction", async () => {
      (getTransactionDetail as jest.Mock).mockResolvedValue({ label: "Deposit" });

      const res = await request(app).get("/api/wallet/transactions/tx-1").set(auth);

      expect(res.status).toBe(200);
      expect(getTransactionDetail).toHaveBeenCalledWith("user123", "tx-1");
    });

    it("returns 404 for someone else's transaction", async () => {
      (getTransactionDetail as jest.Mock).mockRejectedValue(new TransactionNotFoundError());

      const res = await request(app).get("/api/wallet/transactions/not-mine").set(auth);

      expect(res.status).toBe(404);
    });

    it("downloads a CSV statement as an attachment", async () => {
      (getStatement as jest.Mock).mockResolvedValue(statement);

      const res = await request(app).get("/api/wallet/statement?from=2026-10-01&to=2026-10-31&format=csv").set(auth);

      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toMatch(/text\/csv/);
      expect(res.headers["content-disposition"]).toBe('attachment; filename="purplewallet-statement-2026-10-01-to-2026-10-31.csv"');
      expect(getStatement).toHaveBeenCalledWith("user123", "2026-10-01", "2026-10-31", "UTC");
    });

    it.each([
      ["from=2026-10-31&to=2026-10-01", "The end date must be on or after the start date"],
      ["from=2025-01-01&to=2026-10-01", "A statement can cover up to one year"],
      ["from=01-10-2026&to=2026-10-31", "Use dates in the form YYYY-MM-DD"],
      ["from=2026-10-01&to=2026-10-31&format=xlsx", "format must be pdf or csv"],
    ])("rejects %s", async (query, message) => {
      const res = await request(app).get(`/api/wallet/statement?${query}`).set(auth);

      expect(res.status).toBe(400);
      expect(res.body.message).toBe(message);
    });
  });
});
