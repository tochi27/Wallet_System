import bcrypt from "bcryptjs";
import prisma from "../../../config/db";
import { notify } from "../../../services/notifications/notification.service";
import { changePin, PinError, setPin, verifyPin } from "../../../services/security/pin.service";

jest.mock("../../../config/db", () => ({
  __esModule: true,
  default: { user: { findUniqueOrThrow: jest.fn(), update: jest.fn() } },
}));
jest.mock("../../../services/notifications/notification.service", () => ({ notify: jest.fn() }));
jest.mock("bcryptjs");

const user = (overrides: Record<string, unknown> = {}) => ({
  password: "hashed-password",
  transactionPinHash: "hashed-pin",
  pinFailedAttempts: 0,
  pinLockedUntil: null,
  email: "ada@mailbox.ng",
  ...overrides,
});

const expectPinError = async (promise: Promise<unknown>, status: number, code: string) => {
  const error = await promise.then(
    () => null,
    (err: unknown) => err
  );
  expect(error).toBeInstanceOf(PinError);
  expect(error).toMatchObject({ status, code });
  return error as PinError;
};

describe("pin.service", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (bcrypt.hash as jest.Mock).mockResolvedValue("new-hash");
  });

  describe("verifyPin", () => {
    it("never locks a shared demo account, whatever visitors guess", async () => {
      (prisma.user.findUniqueOrThrow as jest.Mock).mockResolvedValue(user({ pinFailedAttempts: 4, email: "demo@purplewallet.demo" }));
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      await expect(verifyPin("u1", "0000")).rejects.toMatchObject({ status: 400, code: "PIN_INCORRECT" });
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it("passes for the right PIN and clears earlier failed attempts", async () => {
      (prisma.user.findUniqueOrThrow as jest.Mock).mockResolvedValue(user({ pinFailedAttempts: 2 }));
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      await verifyPin("u1", "1357");

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: "u1" },
        data: { pinFailedAttempts: 0, pinLockedUntil: null },
      });
    });

    it("asks the user to set a PIN first (403, never 401)", async () => {
      (prisma.user.findUniqueOrThrow as jest.Mock).mockResolvedValue(user({ transactionPinHash: null }));

      await expectPinError(verifyPin("u1", "1357"), 403, "PIN_NOT_SET");
    });

    it("counts a wrong PIN atomically and says how many attempts are left", async () => {
      (prisma.user.findUniqueOrThrow as jest.Mock).mockResolvedValue(user());
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);
      (prisma.user.update as jest.Mock).mockResolvedValue({ pinFailedAttempts: 2 });

      const error = await expectPinError(verifyPin("u1", "0000"), 400, "PIN_INCORRECT");

      expect(error.message).toBe("Incorrect PIN. 3 attempts left.");
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: "u1" },
        data: { pinFailedAttempts: { increment: 1 } },
        select: { pinFailedAttempts: true },
      });
    });

    it("locks money actions for 30 minutes on the fifth wrong PIN and alerts the user", async () => {
      (prisma.user.findUniqueOrThrow as jest.Mock).mockResolvedValue(user({ pinFailedAttempts: 4 }));
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);
      (prisma.user.update as jest.Mock).mockResolvedValueOnce({ pinFailedAttempts: 5 }).mockResolvedValueOnce({});

      await expectPinError(verifyPin("u1", "0000"), 423, "PIN_LOCKED");

      const lock = (prisma.user.update as jest.Mock).mock.calls[1][0].data;
      expect(lock.pinFailedAttempts).toBe(0);
      expect(lock.pinLockedUntil.getTime() - Date.now()).toBeGreaterThan(29 * 60_000);
      expect(notify).toHaveBeenCalledWith(expect.objectContaining({ userId: "u1", type: "security.pin_locked" }));
    });

    it("refuses even the right PIN while locked, without checking it", async () => {
      (prisma.user.findUniqueOrThrow as jest.Mock).mockResolvedValue(
        user({ pinLockedUntil: new Date(Date.now() + 10 * 60_000) })
      );

      const error = await expectPinError(verifyPin("u1", "1357"), 423, "PIN_LOCKED");

      expect(error.message).toMatch(/locked for 10 more minutes/);
      expect(bcrypt.compare).not.toHaveBeenCalled();
    });
  });

  describe("setPin", () => {
    it("needs the account password, stores only a hash, and sends a security alert", async () => {
      (prisma.user.findUniqueOrThrow as jest.Mock)
        .mockResolvedValueOnce(user({ transactionPinHash: null }))
        .mockResolvedValueOnce(user());
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      await setPin("u1", "password123", "1357");

      expect(bcrypt.hash).toHaveBeenCalledWith("1357", 10);
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: "u1" },
        data: { transactionPinHash: "new-hash", pinFailedAttempts: 0, pinLockedUntil: null },
      });
      expect(notify).toHaveBeenCalledWith(expect.objectContaining({ type: "security.pin_set" }));
    });

    it("rejects a wrong password with 400 (not 401, which would sign the user out)", async () => {
      (prisma.user.findUniqueOrThrow as jest.Mock)
        .mockResolvedValueOnce(user({ transactionPinHash: null }))
        .mockResolvedValueOnce(user());
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      await expectPinError(setPin("u1", "wrong", "1357"), 400, "PASSWORD_INCORRECT");
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it("refuses to overwrite an existing PIN", async () => {
      (prisma.user.findUniqueOrThrow as jest.Mock).mockResolvedValue(user());

      await expectPinError(setPin("u1", "password123", "1357"), 409, "PIN_EXISTS");
    });
  });

  describe("changePin", () => {
    it("accepts the current PIN as proof", async () => {
      (prisma.user.findUniqueOrThrow as jest.Mock).mockResolvedValue(user());
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      await changePin("u1", { currentPin: "1357" }, "2468");

      expect(prisma.user.update).toHaveBeenLastCalledWith({
        where: { id: "u1" },
        data: { transactionPinHash: "new-hash", pinFailedAttempts: 0, pinLockedUntil: null },
      });
      expect(notify).toHaveBeenCalledWith(expect.objectContaining({ type: "security.pin_changed" }));
    });

    it("requires some proof", async () => {
      await expectPinError(changePin("u1", {}, "2468"), 400, "PIN_INCORRECT");
    });
  });
});
