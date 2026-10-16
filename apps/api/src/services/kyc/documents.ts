import { createHash } from "crypto";
import sharp from "sharp";
import type { KycDocumentKind } from "@prisma/client";

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
// Big enough to read an ID card's small print, small enough to keep the database lean
const MAX_IMAGE_SIDE = 2000;

export type UploadedFile = { buffer: Buffer; size: number };
export type CleanDocument = { kind: KycDocumentKind; mimeType: string; data: Buffer; size: number; sha256: string };

/** A file we can't accept. 400; the message is shown to the user as is. */
export class DocumentError extends Error {
  readonly status = 400;

  constructor(message: string) {
    super(message);
    this.name = "DocumentError";
  }
}

const LABELS: Record<KycDocumentKind, string> = {
  ID_FRONT: "The photo of your ID",
  ID_BACK: "The photo of the back of your ID",
  SELFIE: "Your selfie",
};

// Decided by the file's first bytes, never its name or the browser's claimed type
const sniff = (buffer: Buffer): "image/jpeg" | "image/png" | "application/pdf" | null => {
  if (buffer.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) return "image/jpeg";
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (buffer.subarray(0, 5).toString("latin1") === "%PDF-") return "application/pdf";
  return null;
};

/**
 * Checks an upload and cleans it before it's stored. Photos are re-encoded as JPEG, which drops
 * everything but the pixels: GPS location, camera details and anything hidden in the file. They're
 * turned the right way up and shrunk to at most 2000px. A PDF (a scanned NIN slip, say) is kept
 * as it is. The selfie must be a photo.
 */
export const cleanDocument = async (kind: KycDocumentKind, file: UploadedFile): Promise<CleanDocument> => {
  const label = LABELS[kind];
  if (file.size > MAX_UPLOAD_BYTES) throw new DocumentError(`${label} is over 5 MB. Choose a smaller file.`);

  const type = sniff(file.buffer);
  if (!type) throw new DocumentError(`${label} must be a JPEG or PNG photo, or a PDF.`);
  if (type === "application/pdf" && kind === "SELFIE") throw new DocumentError("Your selfie must be a photo, not a PDF.");

  let data: Buffer;
  let mimeType: string;
  if (type === "application/pdf") {
    data = file.buffer;
    mimeType = type;
  } else {
    try {
      data = await sharp(file.buffer, { failOn: "error" })
        .rotate() // applies the camera's orientation before the metadata is dropped
        .resize({ width: MAX_IMAGE_SIDE, height: MAX_IMAGE_SIDE, fit: "inside", withoutEnlargement: true })
        .jpeg({ quality: 85 })
        .toBuffer();
    } catch {
      throw new DocumentError(`${label} couldn't be read. Take the photo again and try once more.`);
    }
    mimeType = "image/jpeg";
  }

  return { kind, mimeType, data, size: data.length, sha256: createHash("sha256").update(data).digest("hex") };
};
