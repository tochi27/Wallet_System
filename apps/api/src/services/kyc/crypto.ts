import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";
import { env } from "../../config/env";
import logger from "../../config/logger";

const IV_BYTES = 12;
const TAG_BYTES = 16;

// Production refuses to start without KYC_ENCRYPTION_KEY (config/env.ts). Development falls back
// to a fixed key so the feature works out of the box; anything encrypted with it isn't secret.
const key = env.KYC_ENCRYPTION_KEY
  ? Buffer.from(env.KYC_ENCRYPTION_KEY, "base64")
  : createHash("sha256").update("purplewallet-insecure-development-kyc-key").digest();
if (!env.KYC_ENCRYPTION_KEY && env.NODE_ENV !== "test") {
  logger.warn("KYC_ENCRYPTION_KEY is not set: ID documents are encrypted with an insecure development key");
}

/** AES-256-GCM. The result is iv + auth tag + ciphertext, so tampering is detected on decrypt. */
export const encrypt = (plain: Buffer): Buffer => {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const body = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]);
};

export const decrypt = (sealed: Buffer): Buffer => {
  const iv = sealed.subarray(0, IV_BYTES);
  const tag = sealed.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(sealed.subarray(IV_BYTES + TAG_BYTES)), decipher.final()]);
};

export const encryptText = (plain: string) => encrypt(Buffer.from(plain, "utf8")).toString("base64");
export const decryptText = (sealed: string) => decrypt(Buffer.from(sealed, "base64")).toString("utf8");
