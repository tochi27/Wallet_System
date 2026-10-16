import { Prisma } from "@prisma/client";
import prisma from "../../../config/db";
import { notify } from "../../../services/notifications/notification.service";
import redisClient from "../../../services/redis.service";
import { decrypt, decryptText, encrypt, encryptText } from "../../../services/kyc/crypto";
import { cleanDocument } from "../../../services/kyc/documents";
import {
  approveUpgrade,
  getUpgradeDocument,
  getUpgradeRequest,
  getUpgradeStatus,
  purgeRejectedDocuments,
  rejectUpgrade,
  submitUpgrade,
  UpgradeError,
} from "../../../services/kyc/upgrade.service";

const tx = {
  tierUpgradeRequest: { updateMany: jest.fn() },
  user: { findUniqueOrThrow: jest.fn(), update: jest.fn() },
  adminAuditLog: { create: jest.fn() },
};

jest.mock("../../../config/db", () => ({
  __esModule: true,
  default: {
    user: { findUniqueOrThrow: jest.fn() },
    tierUpgradeRequest: {
      count: jest.fn(),
      create: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      updateMany: jest.fn(),
    },
    kycDocument: { findFirst: jest.fn(), deleteMany: jest.fn() },
    adminAuditLog: { create: jest.fn() },
    $transaction: jest.fn(),
  },
}));
jest.mock("../../../services/redis.service", () => ({ __esModule: true, default: { set: jest.fn() } }));
jest.mock("../../../services/notifications/notification.service", () => ({ notify: jest.fn() }));
jest.mock("../../../services/kyc/documents", () => ({
  ...jest.requireActual("../../../services/kyc/documents"),
  cleanDocument: jest.fn(async (kind: string, file: { buffer: Buffer }) => ({
    kind,
    mimeType: "image/jpeg",
    data: file.buffer,
    size: file.buffer.length,
    sha256: "a".repeat(64),
  })),
}));

const expectUpgradeError = async (promise: Promise<unknown>, status: number, message?: string) => {
  const error = await promise.then(
    () => null,
    (err: unknown) => err
  );
  expect(error).toBeInstanceOf(UpgradeError);
  expect(error).toMatchObject({ status, ...(message ? { message: expect.stringContaining(message) } : {}) });
};

const photo = (text: string) => ({ buffer: Buffer.from(text), size: text.length });
const details = { legalName: "Ada Obi", dateOfBirth: new Date("1990-04-02"), idType: "NATIONAL_ID" as const, idNumber: "12345678901" };
const allPhotos = { ID_FRONT: photo("front"), ID_BACK: photo("back"), SELFIE: photo("selfie") };

describe("upgrade.service", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (prisma.user.findUniqueOrThrow as jest.Mock).mockResolvedValue({ tier: "TIER_1", emailVerifiedAt: new Date() });
    (prisma.tierUpgradeRequest.count as jest.Mock).mockResolvedValue(0);
    (prisma.tierUpgradeRequest.create as jest.Mock).mockImplementation(async () => ({
      id: "r1",
      status: "PENDING",
      idType: "NATIONAL_ID",
      createdAt: new Date(),
      reviewedAt: null,
      rejectionReason: null,
      reviewMessage: null,
    }));
    (prisma.$transaction as jest.Mock).mockImplementation(async (arg: unknown) =>
      typeof arg === "function" ? arg(tx) : Promise.all(arg as Promise<unknown>[])
    );
    tx.tierUpgradeRequest.updateMany.mockResolvedValue({ count: 1 });
    tx.user.findUniqueOrThrow.mockResolvedValue({ tier: "TIER_1" });
    (redisClient.set as jest.Mock).mockResolvedValue("OK");
  });

  describe("getUpgradeStatus", () => {
    it("lets a verified Tier 1 user apply when nothing is pending", async () => {
      (prisma.tierUpgradeRequest.findFirst as jest.Mock).mockResolvedValue(null);
      await expect(getUpgradeStatus("u1")).resolves.toEqual({ tier: "TIER_1", canApply: true, latest: null });
    });

    it("shows a rejection with its reason, and lets them try again", async () => {
      (prisma.tierUpgradeRequest.findFirst as jest.Mock).mockResolvedValue({
        id: "r1",
        status: "REJECTED",
        idType: "PASSPORT",
        createdAt: new Date(),
        reviewedAt: new Date(),
        rejectionReason: "BLURRY_PHOTO",
        reviewMessage: "The bottom of the photo is cut off.",
      });
      const status = await getUpgradeStatus("u1");
      expect(status.canApply).toBe(true);
      expect(status.latest?.rejection).toEqual({
        reason: "BLURRY_PHOTO",
        label: "A photo was blurry or too dark to read",
        message: "The bottom of the photo is cut off.",
      });
    });

    it("doesn't let them apply while a request is pending", async () => {
      (prisma.tierUpgradeRequest.findFirst as jest.Mock).mockResolvedValue({ id: "r1", status: "PENDING", idType: "NIN_SLIP", createdAt: new Date() });
      expect((await getUpgradeStatus("u1")).canApply).toBe(false);
    });
  });

  describe("submitUpgrade", () => {
    it("stores the ID number and every photo encrypted, and tells the user it's being checked", async () => {
      await submitUpgrade("u1", details, allPhotos);

      const { data } = (prisma.tierUpgradeRequest.create as jest.Mock).mock.calls[0][0];
      expect(data.idNumberEncrypted).not.toContain("12345678901");
      expect(decryptText(data.idNumberEncrypted)).toBe("12345678901");
      expect(data.idNumberLast4).toBe("8901");
      const docs = data.documents.create;
      expect(docs.map((d: { kind: string }) => d.kind)).toEqual(["ID_FRONT", "ID_BACK", "SELFIE"]);
      expect(decrypt(Buffer.from(docs[0].data)).toString()).toBe("front");
      expect(Buffer.from(docs[0].data).includes(Buffer.from("front"))).toBe(false);
      expect(notify).toHaveBeenCalledWith(expect.objectContaining({ userId: "u1", type: "account.upgrade_submitted" }));
    });

    it("doesn't need the back of a NIN slip or passport", async () => {
      await submitUpgrade("u1", { ...details, idType: "PASSPORT", idNumber: "A12345678" }, { ID_FRONT: photo("f"), SELFIE: photo("s") });
      expect(cleanDocument).toHaveBeenCalledTimes(2);
    });

    it.each([
      ["ID_FRONT", "Add a photo of your ID"],
      ["ID_BACK", "Add a photo of the back of your national ID card"],
      ["SELFIE", "Add a selfie"],
    ])("refuses without %s", async (missing, message) => {
      const files = { ...allPhotos } as Record<string, unknown>;
      delete files[missing];
      await expect(submitUpgrade("u1", details, files)).rejects.toThrow(message);
      expect(prisma.tierUpgradeRequest.create).not.toHaveBeenCalled();
    });

    it("refuses a user already on Tier 2", async () => {
      (prisma.user.findUniqueOrThrow as jest.Mock).mockResolvedValue({ tier: "TIER_2" });
      await expectUpgradeError(submitUpgrade("u1", details, allPhotos), 409, "already on Tier 2");
    });

    it("refuses a second request while one is pending, including two sent at the same moment", async () => {
      (prisma.tierUpgradeRequest.count as jest.Mock).mockResolvedValueOnce(1);
      await expectUpgradeError(submitUpgrade("u1", details, allPhotos), 409, "already checking");

      (prisma.tierUpgradeRequest.create as jest.Mock).mockRejectedValueOnce(
        new Prisma.PrismaClientKnownRequestError("Unique constraint failed", { code: "P2002", clientVersion: "6" })
      );
      await expectUpgradeError(submitUpgrade("u1", details, allPhotos), 409, "already checking");
    });
  });

  describe("reviewing", () => {
    const pending = { userId: "u1", status: "PENDING" };

    it("opens a request with the decrypted ID number and audits the view once per window", async () => {
      (prisma.tierUpgradeRequest.findUnique as jest.Mock).mockResolvedValue({
        id: "r1",
        userId: "u1",
        idNumberEncrypted: encryptText("12345678901"),
        rejectionReason: null,
        documents: [],
      });
      (prisma.tierUpgradeRequest.findMany as jest.Mock).mockResolvedValue([]);

      const request = await getUpgradeRequest("admin1", "r1");
      expect(request.idNumber).toBe("12345678901");
      expect(request).not.toHaveProperty("idNumberEncrypted");
      expect(prisma.adminAuditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ adminId: "admin1", action: "kyc.view", targetId: "u1", details: { requestId: "r1" } }),
      });

      (redisClient.set as jest.Mock).mockResolvedValue(null); // viewed a moment ago
      await getUpgradeRequest("admin1", "r1");
      expect(prisma.adminAuditLog.create).toHaveBeenCalledTimes(1);
    });

    it("serves a document decrypted", async () => {
      (prisma.kycDocument.findFirst as jest.Mock).mockResolvedValue({
        kind: "SELFIE",
        mimeType: "image/jpeg",
        data: new Uint8Array(encrypt(Buffer.from("selfie bytes"))),
        request: { id: "r1", userId: "u1" },
      });
      const doc = await getUpgradeDocument("admin1", "r1", "d1");
      expect(doc.data.toString()).toBe("selfie bytes");
      expect(prisma.kycDocument.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "d1", requestId: "r1" } }));
    });

    it("approving moves the user to Tier 2, audits it and tells them", async () => {
      (prisma.tierUpgradeRequest.findUnique as jest.Mock).mockResolvedValue(pending);

      await approveUpgrade("admin1", "r1");

      expect(tx.tierUpgradeRequest.updateMany).toHaveBeenCalledWith({
        where: { id: "r1", status: "PENDING" },
        data: { status: "APPROVED", reviewedById: "admin1", reviewedAt: expect.any(Date) },
      });
      expect(tx.user.update).toHaveBeenCalledWith({ where: { id: "u1" }, data: { tier: "TIER_2" } });
      expect(tx.adminAuditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ action: "kyc.approve", targetId: "u1", details: { requestId: "r1", from: "TIER_1", to: "TIER_2" } }),
      });
      expect(notify).toHaveBeenCalledWith(expect.objectContaining({ userId: "u1", type: "account.upgrade_approved" }));
    });

    it("rejecting records the reason and message, and tells the user what to fix", async () => {
      (prisma.tierUpgradeRequest.findUnique as jest.Mock).mockResolvedValue(pending);

      await rejectUpgrade("admin1", "r1", "NAME_MISMATCH", "Your ID says Adaeze.");

      expect(tx.tierUpgradeRequest.updateMany.mock.calls[0][0].data).toMatchObject({
        status: "REJECTED",
        rejectionReason: "NAME_MISMATCH",
        reviewMessage: "Your ID says Adaeze.",
      });
      expect(tx.user.update).not.toHaveBeenCalled();
      const alert = (notify as jest.Mock).mock.calls[0][0];
      expect(alert.type).toBe("account.upgrade_rejected");
      expect(alert.body).toContain("doesn't match your account. Your ID says Adaeze.");
    });

    it("nobody can review their own request", async () => {
      (prisma.tierUpgradeRequest.findUnique as jest.Mock).mockResolvedValue({ ...pending, userId: "admin1" });
      await expectUpgradeError(approveUpgrade("admin1", "r1"), 400, "your own");
      expect(tx.tierUpgradeRequest.updateMany).not.toHaveBeenCalled();
    });

    it("a request can only be decided once", async () => {
      (prisma.tierUpgradeRequest.findUnique as jest.Mock).mockResolvedValue(pending);
      tx.tierUpgradeRequest.updateMany.mockResolvedValue({ count: 0 });

      await expectUpgradeError(approveUpgrade("admin1", "r1"), 409, "already been reviewed");
      expect(tx.user.update).not.toHaveBeenCalled();
      expect(notify).not.toHaveBeenCalled();
    });
  });

  describe("purgeRejectedDocuments", () => {
    it("deletes photos of requests rejected over 30 days ago and marks them", async () => {
      (prisma.tierUpgradeRequest.findMany as jest.Mock).mockResolvedValue([{ id: "r1" }, { id: "r2" }]);
      const now = new Date("2026-10-16T00:00:00Z");

      await expect(purgeRejectedDocuments(now)).resolves.toBe(2);

      const where = (prisma.tierUpgradeRequest.findMany as jest.Mock).mock.calls[0][0].where;
      expect(where).toMatchObject({ status: "REJECTED", documentsDeletedAt: null });
      expect(where.reviewedAt.lt.toISOString()).toBe("2026-09-16T00:00:00.000Z");
      expect(prisma.kycDocument.deleteMany).toHaveBeenCalledWith({ where: { requestId: { in: ["r1", "r2"] } } });
      expect(prisma.tierUpgradeRequest.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ["r1", "r2"] } },
        data: { documentsDeletedAt: now },
      });
    });
  });
});
