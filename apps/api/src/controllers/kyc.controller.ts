import { Request, Response } from "express";
import type { KycDocumentKind } from "@prisma/client";
import { env } from "../config/env";
import logger from "../config/logger";
import { DocumentError } from "../services/kyc/documents";
import { senderAddress } from "../services/notifications/email.service";
import {
  approveUpgrade,
  getUpgradeDocument,
  getUpgradeRequest,
  getUpgradeStatus,
  listUpgradeRequests,
  rejectUpgrade,
  submitUpgrade,
  UpgradeError,
  type UpgradeFiles,
} from "../services/kyc/upgrade.service";
import { errorResponse, successResponse } from "../utils/response.utils";
import { upgradeListQuerySchema } from "../validators/kyc.validators";

const fail = (res: Response, err: unknown, fallback: string) => {
  if (err instanceof UpgradeError || err instanceof DocumentError) return errorResponse(res, err.message, err.status);
  logger.error({ err }, fallback);
  return errorResponse(res, fallback, 500);
};

const param = (req: Request, name: string) => String(req.params[name]);

// ---------- The user's side ----------

export const upgradeStatus = async (req: Request, res: Response) => {
  try {
    return successResponse(res, "Upgrade status fetched", await getUpgradeStatus(req.userId));
  } catch (err) {
    return fail(res, err, "Could not load your upgrade status");
  }
};

export const submitUpgradeRequest = async (req: Request, res: Response) => {
  try {
    const uploaded = (req.files ?? {}) as Record<string, Express.Multer.File[] | undefined>;
    const files: UpgradeFiles = {};
    for (const kind of ["ID_FRONT", "ID_BACK", "SELFIE"] as KycDocumentKind[]) {
      const file = uploaded[kind]?.[0];
      if (file) files[kind] = { buffer: file.buffer, size: file.size };
    }
    const request = await submitUpgrade(req.userId, req.body, files);
    return successResponse(res, "Thanks! We're checking your ID.", request, 201);
  } catch (err) {
    return fail(res, err, "Could not send your ID");
  }
};

// Where the app's "Help & support" link goes
export const support = (_req: Request, res: Response) => {
  const email = env.SUPPORT_EMAIL ?? senderAddress();
  return successResponse(res, "Support contact fetched", { email });
};

// ---------- Staff ----------

export const upgradeRequests = async (req: Request, res: Response) => {
  const query = upgradeListQuerySchema.safeParse(req.query);
  if (!query.success) return errorResponse(res, query.error.issues[0]?.message ?? "Invalid query", 400);
  try {
    return successResponse(res, "ID checks fetched", await listUpgradeRequests(query.data));
  } catch (err) {
    return fail(res, err, "Could not load ID checks");
  }
};

export const upgradeRequest = async (req: Request, res: Response) => {
  try {
    return successResponse(res, "ID check fetched", await getUpgradeRequest(req.userId, param(req, "id")));
  } catch (err) {
    return fail(res, err, "Could not load the ID check");
  }
};

export const upgradeDocument = async (req: Request, res: Response) => {
  try {
    const document = await getUpgradeDocument(req.userId, param(req, "id"), param(req, "documentId"));
    // An ID photo must never sit in a browser or proxy cache
    res.set({
      "Content-Type": document.mimeType,
      "Cache-Control": "no-store, private",
      "Content-Disposition": "inline",
      "X-Content-Type-Options": "nosniff",
    });
    return res.send(document.data);
  } catch (err) {
    return fail(res, err, "Could not load the document");
  }
};

export const approveUpgradeRequest = async (req: Request, res: Response) => {
  try {
    await approveUpgrade(req.userId, param(req, "id"));
    return successResponse(res, "ID approved. They're now on Tier 2.", await getUpgradeRequest(req.userId, param(req, "id")));
  } catch (err) {
    return fail(res, err, "Could not approve the ID check");
  }
};

export const rejectUpgradeRequest = async (req: Request, res: Response) => {
  try {
    await rejectUpgrade(req.userId, param(req, "id"), req.body.reason, req.body.message || undefined);
    return successResponse(res, "ID rejected. They've been told why.", await getUpgradeRequest(req.userId, param(req, "id")));
  } catch (err) {
    return fail(res, err, "Could not reject the ID check");
  }
};
