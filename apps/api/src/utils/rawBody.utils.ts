import type { IncomingMessage } from "http";
import type { Request } from "express";

type WithRawBody = { rawBody?: Buffer };

// Paths whose exact request bytes we keep: webhook signatures are computed over the raw body,
// and re-serialising the parsed JSON isn't guaranteed to reproduce it byte for byte.
const RAW_BODY_PATHS = ["/api/payments/paystack/webhook"];

// Passed to express.json({ verify }) — runs before parsing, with the raw buffer
export const captureRawBody = (req: IncomingMessage, _res: unknown, buf: Buffer): void => {
  if (req.url && RAW_BODY_PATHS.some((path) => req.url!.startsWith(path))) {
    (req as IncomingMessage & WithRawBody).rawBody = buf;
  }
};

export const getRawBody = (req: Request): Buffer | undefined => (req as Request & WithRawBody).rawBody;
