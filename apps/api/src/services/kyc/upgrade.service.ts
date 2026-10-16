import {
  AccountTier,
  KycDocumentKind,
  KycIdType,
  Prisma,
  UpgradeRejectionReason,
  UpgradeStatus,
} from "@prisma/client";
import prisma from "../../config/db";
import { TIER_LIMITS } from "../../config/limits";
import { notify } from "../notifications/notification.service";
import redisClient from "../redis.service";
import { decrypt, decryptText, encrypt, encryptText } from "./crypto";
import { cleanDocument, DocumentError, type UploadedFile } from "./documents";

// Rejected requests' photos are deleted this long after the decision; approved ones are kept
export const REJECTED_DOCUMENTS_KEPT_DAYS = 30;
// Opening the same request again within this window doesn't add another audit entry
const VIEW_AUDIT_WINDOW_SECONDS = 15 * 60;

/** Problems with an upgrade request carry their own status. Never 401, which signs the user out. */
export class UpgradeError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "UpgradeError";
    this.status = status;
  }
}

export const ID_TYPE_LABELS: Record<KycIdType, string> = {
  NIN_SLIP: "NIN slip",
  NATIONAL_ID: "National ID card",
  DRIVERS_LICENCE: "Driver's licence",
  PASSPORT: "International passport",
  VOTERS_CARD: "Voter's card",
};

// For the middle of a sentence: "the back of your national ID card"
const ID_TYPE_NOUNS: Record<KycIdType, string> = {
  NIN_SLIP: "NIN slip",
  NATIONAL_ID: "national ID card",
  DRIVERS_LICENCE: "driver's licence",
  PASSPORT: "passport",
  VOTERS_CARD: "voter's card",
};

// Cards have information on both sides; slips and passports don't
export const NEEDS_BACK: ReadonlySet<KycIdType> = new Set([KycIdType.NATIONAL_ID, KycIdType.DRIVERS_LICENCE, KycIdType.VOTERS_CARD]);

// What the user is told, so they know what to fix
export const REJECTION_LABELS: Record<UpgradeRejectionReason, string> = {
  BLURRY_PHOTO: "A photo was blurry or too dark to read",
  NAME_MISMATCH: "The name on your ID doesn't match your account",
  EXPIRED_ID: "Your ID has expired",
  SELFIE_MISMATCH: "Your selfie didn't clearly match the photo on your ID",
  WRONG_DOCUMENT: "The document wasn't the type of ID you chose",
  OTHER: "We couldn't verify your ID",
};

const naira = new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", maximumFractionDigits: 0 });

export type UpgradeDetails = { legalName: string; dateOfBirth: Date; idType: KycIdType; idNumber: string };
export type UpgradeFiles = Partial<Record<KycDocumentKind, UploadedFile>>;

const userView = (request: {
  id: string;
  status: UpgradeStatus;
  idType: KycIdType;
  createdAt: Date;
  reviewedAt: Date | null;
  rejectionReason: UpgradeRejectionReason | null;
  reviewMessage: string | null;
}) => ({
  id: request.id,
  status: request.status,
  idType: request.idType,
  submittedAt: request.createdAt,
  reviewedAt: request.reviewedAt,
  rejection: request.rejectionReason
    ? { reason: request.rejectionReason, label: REJECTION_LABELS[request.rejectionReason], message: request.reviewMessage }
    : null,
});

const USER_VIEW_SELECT = {
  id: true,
  status: true,
  idType: true,
  createdAt: true,
  reviewedAt: true,
  rejectionReason: true,
  reviewMessage: true,
} as const;

// ---------- The user's side ----------

/** The user's latest request (if any) and whether they can send one now. */
export const getUpgradeStatus = async (userId: string) => {
  const [user, latest] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { tier: true, emailVerifiedAt: true } }),
    prisma.tierUpgradeRequest.findFirst({ where: { userId }, orderBy: { createdAt: "desc" }, select: USER_VIEW_SELECT }),
  ]);
  return {
    tier: user.tier,
    canApply: user.tier === AccountTier.TIER_1 && user.emailVerifiedAt !== null && latest?.status !== UpgradeStatus.PENDING,
    latest: latest ? userView(latest) : null,
  };
};

/**
 * Sends the user's ID for review. Every photo is checked and cleaned (cleanDocument) and stored
 * encrypted, along with the ID number. The database allows only one pending request per user.
 */
export const submitUpgrade = async (userId: string, details: UpgradeDetails, files: UpgradeFiles) => {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { tier: true } });
  if (user.tier !== AccountTier.TIER_1) throw new UpgradeError("Your account is already on Tier 2", 409);
  const pending = await prisma.tierUpgradeRequest.count({ where: { userId, status: UpgradeStatus.PENDING } });
  if (pending > 0) throw new UpgradeError("We're already checking your ID. We'll let you know when it's done.", 409);

  const kinds: KycDocumentKind[] = [KycDocumentKind.ID_FRONT, KycDocumentKind.SELFIE];
  if (NEEDS_BACK.has(details.idType)) kinds.splice(1, 0, KycDocumentKind.ID_BACK);
  const missing = kinds.find((kind) => !files[kind]);
  if (missing) {
    throw new DocumentError(
      missing === KycDocumentKind.ID_FRONT
        ? "Add a photo of your ID"
        : missing === KycDocumentKind.ID_BACK
          ? `Add a photo of the back of your ${ID_TYPE_NOUNS[details.idType]}`
          : "Add a selfie of you holding your ID"
    );
  }
  const documents = await Promise.all(kinds.map((kind) => cleanDocument(kind, files[kind]!)));

  let request;
  try {
    request = await prisma.tierUpgradeRequest.create({
      data: {
        userId,
        legalName: details.legalName,
        dateOfBirth: details.dateOfBirth,
        idType: details.idType,
        idNumberEncrypted: encryptText(details.idNumber),
        idNumberLast4: details.idNumber.slice(-4),
        documents: {
          create: documents.map((doc) => ({
            kind: doc.kind,
            mimeType: doc.mimeType,
            size: doc.size,
            sha256: doc.sha256,
            data: new Uint8Array(encrypt(doc.data)),
          })),
        },
      },
      select: USER_VIEW_SELECT,
    });
  } catch (err) {
    // Two submissions at the same moment: the partial unique index lets only one through
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      throw new UpgradeError("We're already checking your ID. We'll let you know when it's done.", 409);
    }
    throw err;
  }

  await notify({
    userId,
    type: "account.upgrade_submitted",
    title: "We're checking your ID",
    body: "Thanks! We'll review your ID, usually within 1 business day, and let you know as soon as it's done.",
    actionPath: "/settings",
  });
  return userView(request);
};

// ---------- Staff ----------

type Page = { status?: UpgradeStatus; limit: number; cursor?: string };

/** Requests for the review queue. Pending ones oldest first (first come, first served); others newest first. */
export const listUpgradeRequests = async ({ status = UpgradeStatus.PENDING, limit, cursor }: Page) => {
  const rows = await prisma.tierUpgradeRequest.findMany({
    where: { status },
    orderBy: [{ createdAt: status === UpgradeStatus.PENDING ? "asc" : "desc" }, { id: "asc" }],
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    select: {
      id: true,
      status: true,
      legalName: true,
      idType: true,
      idNumberLast4: true,
      createdAt: true,
      reviewedAt: true,
      user: { select: { id: true, name: true, email: true } },
      reviewedBy: { select: { name: true } },
    },
  });
  const items = rows.slice(0, limit);
  return { items, nextCursor: rows.length > limit ? items[items.length - 1].id : null };
};

// One audit entry per reviewer per request every 15 minutes, however many photos they open
const recordView = async (adminId: string, request: { id: string; userId: string }) => {
  const fresh = await redisClient.set(`kyc:viewed:${adminId}:${request.id}`, "1", "EX", VIEW_AUDIT_WINDOW_SECONDS, "NX");
  if (fresh !== "OK") return;
  await prisma.adminAuditLog.create({
    data: {
      adminId,
      action: "kyc.view",
      targetType: "User",
      targetId: request.userId,
      reason: "Opened an ID check",
      details: { requestId: request.id },
    },
  });
};

/** Everything a reviewer needs to decide, including the decrypted ID number. The view is audited. */
export const getUpgradeRequest = async (adminId: string, requestId: string) => {
  const request = await prisma.tierUpgradeRequest.findUnique({
    where: { id: requestId },
    select: {
      id: true,
      userId: true,
      status: true,
      legalName: true,
      dateOfBirth: true,
      idType: true,
      idNumberEncrypted: true,
      rejectionReason: true,
      reviewMessage: true,
      reviewedAt: true,
      documentsDeletedAt: true,
      createdAt: true,
      reviewedBy: { select: { name: true } },
      user: { select: { id: true, name: true, email: true, createdAt: true, emailVerifiedAt: true, tier: true } },
      documents: { select: { id: true, kind: true, mimeType: true, size: true }, orderBy: { kind: "asc" } },
    },
  });
  if (!request) throw new UpgradeError("ID check not found", 404);
  await recordView(adminId, request);

  const history = await prisma.tierUpgradeRequest.findMany({
    where: { userId: request.userId, id: { not: request.id } },
    orderBy: { createdAt: "desc" },
    take: 10,
    select: { id: true, status: true, createdAt: true, rejectionReason: true },
  });

  const { idNumberEncrypted, userId: _userId, ...rest } = request;
  return {
    ...rest,
    idNumber: decryptText(idNumberEncrypted),
    rejectionLabel: request.rejectionReason ? REJECTION_LABELS[request.rejectionReason] : null,
    history,
  };
};

/** A decrypted photo or PDF for the review screen. Audited like opening the request. */
export const getUpgradeDocument = async (adminId: string, requestId: string, documentId: string) => {
  const document = await prisma.kycDocument.findFirst({
    where: { id: documentId, requestId },
    select: { kind: true, mimeType: true, data: true, request: { select: { id: true, userId: true } } },
  });
  if (!document) throw new UpgradeError("Document not found", 404);
  await recordView(adminId, document.request);
  return { kind: document.kind, mimeType: document.mimeType, data: decrypt(Buffer.from(document.data)) };
};

// Claims a pending request for one decision; a second reviewer at the same moment gets a 409
const decide = async (
  adminId: string,
  requestId: string,
  apply: (tx: Prisma.TransactionClient, request: { userId: string }) => Promise<void>,
  data: Prisma.TierUpgradeRequestUpdateManyMutationInput
) => {
  const request = await prisma.tierUpgradeRequest.findUnique({ where: { id: requestId }, select: { userId: true, status: true } });
  if (!request) throw new UpgradeError("ID check not found", 404);
  if (request.userId === adminId) throw new UpgradeError("You can't review your own ID check. Ask another member of staff.", 400);

  await prisma.$transaction(async (tx) => {
    const claimed = await tx.tierUpgradeRequest.updateMany({
      where: { id: requestId, status: UpgradeStatus.PENDING },
      data: { ...data, reviewedById: adminId, reviewedAt: new Date() },
    });
    if (claimed.count === 0) throw new UpgradeError("This ID check has already been reviewed", 409);
    await apply(tx, request);
  });
  return request;
};

/** Approves the ID: the user moves to Tier 2 and is told their new limits. */
export const approveUpgrade = async (adminId: string, requestId: string) => {
  const { userId } = await decide(
    adminId,
    requestId,
    async (tx, request) => {
      const before = await tx.user.findUniqueOrThrow({ where: { id: request.userId }, select: { tier: true } });
      await tx.user.update({ where: { id: request.userId }, data: { tier: AccountTier.TIER_2 } });
      await tx.adminAuditLog.create({
        data: {
          adminId,
          action: "kyc.approve",
          targetType: "User",
          targetId: request.userId,
          reason: "ID check approved",
          details: { requestId, from: before.tier, to: AccountTier.TIER_2 },
        },
      });
    },
    { status: UpgradeStatus.APPROVED }
  );

  const limits = TIER_LIMITS.TIER_2;
  await notify({
    userId,
    type: "account.upgrade_approved",
    title: "You're now on Tier 2",
    body: `We've verified your ID. You can now send and withdraw up to ${naira.format(limits.perTransaction)} at a time and ${naira.format(limits.dailyOut)} a day, with no limit on your balance.`,
    actionPath: "/settings",
  });
};

/** Rejects the ID with a reason the user is shown, and lets them try again. */
export const rejectUpgrade = async (adminId: string, requestId: string, reason: UpgradeRejectionReason, message?: string) => {
  const { userId } = await decide(
    adminId,
    requestId,
    async (tx, request) => {
      await tx.adminAuditLog.create({
        data: {
          adminId,
          action: "kyc.reject",
          targetType: "User",
          targetId: request.userId,
          reason: message ? `${REJECTION_LABELS[reason]}: ${message}` : REJECTION_LABELS[reason],
          details: { requestId, rejectionReason: reason },
        },
      });
    },
    { status: UpgradeStatus.REJECTED, rejectionReason: reason, reviewMessage: message ?? null }
  );

  await notify({
    userId,
    type: "account.upgrade_rejected",
    title: "We couldn't verify your ID",
    body: `${REJECTION_LABELS[reason]}.${message ? ` ${message}` : ""} You can send your ID again from Settings.`,
    actionPath: "/settings",
  });
};

/**
 * Deletes the photos of requests rejected over 30 days ago. The request row (and its audit trail)
 * stays, marked documentsDeletedAt. Runs daily on the maintenance queue.
 */
export const purgeRejectedDocuments = async (now = new Date()): Promise<number> => {
  const cutoff = new Date(now.getTime() - REJECTED_DOCUMENTS_KEPT_DAYS * 24 * 60 * 60 * 1000);
  const due = await prisma.tierUpgradeRequest.findMany({
    where: { status: UpgradeStatus.REJECTED, reviewedAt: { lt: cutoff }, documentsDeletedAt: null },
    select: { id: true },
    take: 500,
  });
  if (due.length === 0) return 0;
  const ids = due.map((r) => r.id);
  await prisma.$transaction([
    prisma.kycDocument.deleteMany({ where: { requestId: { in: ids } } }),
    prisma.tierUpgradeRequest.updateMany({ where: { id: { in: ids } }, data: { documentsDeletedAt: now } }),
  ]);
  return ids.length;
};
