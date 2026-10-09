import { DepositStatus } from "@prisma/client";
import prisma from "../../../config/db";
import { enqueuePaystackEvent } from "../../../queues/paystack.queue";
import { confirmDeposit } from "../../../services/payments/deposit.service";
import { isPaystackConfigured } from "../../../services/payments/paystack.client";
import { reconcilePayments } from "../../../services/payments/reconcile.service";
import { confirmWithdrawal } from "../../../services/payments/withdrawal.service";

jest.mock("../../../config/db", () => ({
  __esModule: true,
  default: {
    deposit: { findMany: jest.fn(), updateMany: jest.fn() },
    withdrawal: { findMany: jest.fn() },
    paystackEvent: { findMany: jest.fn() },
  },
}));
jest.mock("../../../queues/paystack.queue", () => ({ enqueuePaystackEvent: jest.fn() }));
jest.mock("../../../services/payments/deposit.service", () => ({ confirmDeposit: jest.fn() }));
jest.mock("../../../services/payments/withdrawal.service", () => ({ confirmWithdrawal: jest.fn() }));
jest.mock("../../../services/payments/paystack.client", () => ({ isPaystackConfigured: jest.fn() }));

const DAY = 24 * 60 * 60 * 1000;

describe("reconcilePayments", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (isPaystackConfigured as jest.Mock).mockReturnValue(true);
    (prisma.deposit.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.withdrawal.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.paystackEvent.findMany as jest.Mock).mockResolvedValue([]);
  });

  it("does nothing when Paystack isn't configured", async () => {
    (isPaystackConfigured as jest.Mock).mockReturnValue(false);

    await reconcilePayments();

    expect(prisma.deposit.findMany).not.toHaveBeenCalled();
  });

  it("re-checks pending deposits and processing withdrawals, and re-queues stuck events", async () => {
    (prisma.deposit.findMany as jest.Mock).mockResolvedValue([{ id: "d1", reference: "dep_1", createdAt: new Date() }]);
    (confirmDeposit as jest.Mock).mockResolvedValue({ status: DepositStatus.SUCCESSFUL });
    (prisma.withdrawal.findMany as jest.Mock).mockResolvedValue([{ reference: "wd_1" }, { reference: "wd_2" }]);
    (prisma.paystackEvent.findMany as jest.Mock).mockResolvedValue([{ id: "evt-1" }]);

    await reconcilePayments();

    expect(confirmDeposit).toHaveBeenCalledWith("dep_1");
    expect(confirmWithdrawal).toHaveBeenCalledWith("wd_1");
    expect(confirmWithdrawal).toHaveBeenCalledWith("wd_2");
    expect(enqueuePaystackEvent).toHaveBeenCalledWith("evt-1");
  });

  it("marks a deposit abandoned once it has been pending for over a day", async () => {
    (prisma.deposit.findMany as jest.Mock).mockResolvedValue([
      { id: "old", reference: "dep_old", createdAt: new Date(Date.now() - 2 * DAY) },
      { id: "new", reference: "dep_new", createdAt: new Date() },
    ]);
    (confirmDeposit as jest.Mock).mockResolvedValue({ status: DepositStatus.PENDING });

    await reconcilePayments();

    expect(prisma.deposit.updateMany).toHaveBeenCalledTimes(1);
    expect(prisma.deposit.updateMany).toHaveBeenCalledWith({
      where: { id: "old", status: DepositStatus.PENDING },
      data: { status: DepositStatus.ABANDONED, failureReason: "Payment was not completed" },
    });
  });

  it("keeps going when one check fails", async () => {
    (prisma.withdrawal.findMany as jest.Mock).mockResolvedValue([{ reference: "wd_bad" }, { reference: "wd_ok" }]);
    (confirmWithdrawal as jest.Mock).mockRejectedValueOnce(new Error("Paystack down")).mockResolvedValueOnce({});

    await reconcilePayments();

    expect(confirmWithdrawal).toHaveBeenCalledWith("wd_ok");
  });
});
