import { Request, Response, NextFunction } from "express";
import multer from "multer";
import { MAX_UPLOAD_BYTES } from "../services/kyc/documents";
import { errorResponse } from "../utils/response.utils";

// Kept in memory only long enough to clean and encrypt: an ID photo never touches the disk
const parser = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 3, fields: 10, fieldSize: 1024 },
}).fields([
  { name: "ID_FRONT", maxCount: 1 },
  { name: "ID_BACK", maxCount: 1 },
  { name: "SELFIE", maxCount: 1 },
]);

const MESSAGES: Partial<Record<multer.ErrorCode, string>> = {
  LIMIT_FILE_SIZE: "Each photo must be 5 MB or smaller",
  LIMIT_FILE_COUNT: "Send at most 3 files",
  LIMIT_UNEXPECTED_FILE: "Unexpected file",
};

/** Parses the multipart form of an ID check. Upload problems are 400s with a message to show. */
export const uploadIdDocuments = (req: Request, res: Response, next: NextFunction) => {
  parser(req, res, (err: unknown) => {
    if (err instanceof multer.MulterError) return errorResponse(res, MESSAGES[err.code] ?? "Upload failed", 400);
    if (err) return next(err);
    next();
  });
};
