import { createHmac } from "crypto";
import { Prisma } from "@prisma/client";
import prisma from "../../../config/db";
import { confirmDeposit, DepositNotFoundError } from "../../../services/payments/deposit.service";
import { confirmWithdrawal, WithdrawalNotFoundError } from "../../../services/payments/withdrawal.service";
import { isValidSignature, processEvent, recordEvent } from "../../../services/payments/paystack-webhook.service";

jest.mock("../../../config/env", () => ({ env: { PAYSTACK_SECRET_KEY: "sk_test_hook" } }));

jest.mock("../../../config/db", () => ({
  __esModule: true,
  default: {
    paystackEvent: {
      create: jest.fn(),
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      update: jest.fn(),
    },
  },
}));

jest.mock("../../../services/payments/deposit.service", () => {
  class DepositNotFoundError extends Error {}
  return { confirmDeposit: jest.fn(), DepositNotFoundError };
});

jest.mock("../../../services/payments/withdrawal.service", () => {
  class WithdrawalNotFoundError extends Error {}
  return { confirmWithdrawal: jest.fn(), WithdrawalNotFoundError };
});

const sign = (body: string, key = "sk_test_hook") => createHmac("sha512", key).update(body).digest("hex");

describe("paystack-webhook.service", () => {
  beforeEach(() => jest.clearAllMocks());

  describe("isValidSignature", () => {
    const body = JSON.stringify({ event: "charge.success", data: { reference: "dep_1" } });

    it("accepts a signature made with our secret key", () => {
      expect(isValidSignature(Buffer.from(body), sign(body))).toBe(true);
    });

    it("rejects a signature made with a different key", () => {
      expect(isValidSignature(Buffer.from(body), sign(body, "sk_test_other"))).toBe(false);
    });

    it("rejects a tampered body", () => {
      expect(isValidSignature(Buffer.from(body.replace("dep_1", "dep_2")), sign(body))).toBe(false);
    });

    it("rejects a missing or malformed signature", () => {
      expect(isValidSignature(Buffer.from(body), undefined)).toBe(false);
      expect(isValidSignature(Buffer.from(body), "not-hex")).toBe(false);
    });
  });

  describe("recordEvent", () => {
    it("stores a new event keyed by event name and Paystack id", async () => {
      (prisma.paystackEvent.create as jest.Mock).mockResolvedValue({ id: "evt-1" });

      const result = await recordEvent({ event: "charge.success", data: { id: 42, reference: "dep_1" } });

      expect(result).toEqual({ id: "evt-1", duplicate: false, processed: false });
      expect(prisma.paystackEvent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ eventKey: "charge.success:42", event: "charge.success", reference: "dep_1" }),
      });
    });

    it("reports a redelivered event as a duplicate instead of storing it twice", async () => {
      (prisma.paystackEvent.create as jest.Mock).mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError("Unique constraint failed", { code: "P2002", clientVersion: "6" })
      );
      (prisma.paystackEvent.findUniqueOrThrow as jest.Mock).mockResolvedValue({ id: "evt-1", processedAt: new Date() });

      const result = await recordEvent({ event: "charge.success", data: { id: 42, reference: "dep_1" } });

      expect(result).toEqual({ id: "evt-1", duplicate: true, processed: true });
    });
  });

  describe("processEvent", () => {
    it("confirms the deposit for charge.success, then marks the event processed", async () => {
      (prisma.paystackEvent.findUnique as jest.Mock).mockResolvedValue({
        id: "evt-1",
        event: "charge.success",
        reference: "dep_1",
        processedAt: null,
      });

      await processEvent("evt-1");

      expect(confirmDeposit).toHaveBeenCalledWith("dep_1");
      expect(prisma.paystackEvent.update).toHaveBeenCalledWith({
        where: { id: "evt-1" },
        data: { processedAt: expect.any(Date) },
      });
    });

    it("ignores charges that are not wallet deposits", async () => {
      (prisma.paystackEvent.findUnique as jest.Mock).mockResolvedValue({
        id: "evt-2",
        event: "charge.success",
        reference: "invoice_77",
        processedAt: null,
      });
      (confirmDeposit as jest.Mock).mockRejectedValue(new DepositNotFoundError());

      await processEvent("evt-2");

      expect(prisma.paystackEvent.update).toHaveBeenCalled();
    });

    it("rethrows other failures so the queue retries", async () => {
      (prisma.paystackEvent.findUnique as jest.Mock).mockResolvedValue({
        id: "evt-3",
        event: "charge.success",
        reference: "dep_1",
        processedAt: null,
      });
      (confirmDeposit as jest.Mock).mockRejectedValue(new Error("Could not reach Paystack"));

      await expect(processEvent("evt-3")).rejects.toThrow("Could not reach Paystack");
      expect(prisma.paystackEvent.update).not.toHaveBeenCalled();
    });

    it.each(["transfer.success", "transfer.failed", "transfer.reversed"])(
      "confirms the withdrawal for %s",
      async (event) => {
        (prisma.paystackEvent.findUnique as jest.Mock).mockResolvedValue({
          id: "evt-t",
          event,
          reference: "wd_1",
          processedAt: null,
        });

        await processEvent("evt-t");

        expect(confirmWithdrawal).toHaveBeenCalledWith("wd_1");
        expect(prisma.paystackEvent.update).toHaveBeenCalled();
      }
    );

    it("ignores transfers that are not wallet withdrawals", async () => {
      (prisma.paystackEvent.findUnique as jest.Mock).mockResolvedValue({
        id: "evt-u",
        event: "transfer.success",
        reference: "payroll_9",
        processedAt: null,
      });
      (confirmWithdrawal as jest.Mock).mockRejectedValue(new WithdrawalNotFoundError());

      await processEvent("evt-u");

      expect(prisma.paystackEvent.update).toHaveBeenCalled();
    });

    it("skips events that were already processed", async () => {
      (prisma.paystackEvent.findUnique as jest.Mock).mockResolvedValue({
        id: "evt-1",
        event: "charge.success",
        reference: "dep_1",
        processedAt: new Date(),
      });

      await processEvent("evt-1");

      expect(confirmDeposit).not.toHaveBeenCalled();
    });
  });
});
