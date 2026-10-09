import { createHash, createHmac, timingSafeEqual } from "crypto";
import { Prisma } from "@prisma/client";
import prisma from "../../config/db";
import { env } from "../../config/env";
import logger from "../../config/logger";
import { confirmDeposit, DepositNotFoundError } from "./deposit.service";
import { confirmWithdrawal, WithdrawalNotFoundError } from "./withdrawal.service";

export type PaystackWebhookPayload = {
  event: string;
  data?: { id?: number | string; reference?: string } & Record<string, unknown>;
};

/**
 * Paystack signs each webhook with HMAC-SHA512 of the request body, keyed with our secret key,
 * hex-encoded in the x-paystack-signature header. Compared in constant time.
 */
export const isValidSignature = (rawBody: Buffer, signature: string | undefined): boolean => {
  if (!signature || !env.PAYSTACK_SECRET_KEY) return false;
  const expected = createHmac("sha512", env.PAYSTACK_SECRET_KEY).update(rawBody).digest();
  const received = Buffer.from(signature, "hex");
  return received.length === expected.length && timingSafeEqual(received, expected);
};

const eventKeyFor = (payload: PaystackWebhookPayload) => {
  const id = payload.data?.id ?? payload.data?.reference;
  const fallback = createHash("sha256").update(JSON.stringify(payload)).digest("hex");
  return `${payload.event}:${id ?? fallback}`;
};

/**
 * Stores the event before anything else. A redelivery of the same event hits the unique
 * eventKey and is reported as a duplicate instead of being stored twice.
 */
export const recordEvent = async (
  payload: PaystackWebhookPayload
): Promise<{ id: string; duplicate: boolean; processed: boolean }> => {
  const eventKey = eventKeyFor(payload);
  try {
    const row = await prisma.paystackEvent.create({
      data: {
        eventKey,
        event: payload.event,
        reference: typeof payload.data?.reference === "string" ? payload.data.reference : null,
        payload: payload as unknown as Prisma.InputJsonValue,
      },
    });
    return { id: row.id, duplicate: false, processed: false };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const row = await prisma.paystackEvent.findUniqueOrThrow({ where: { eventKey } });
      return { id: row.id, duplicate: true, processed: row.processedAt !== null };
    }
    throw error;
  }
};

/** Runs on the queue worker. Throws to trigger a retry; marks the event processed on success. */
export const processEvent = async (eventId: string): Promise<void> => {
  const row = await prisma.paystackEvent.findUnique({ where: { id: eventId } });
  if (!row || row.processedAt) return;

  switch (row.event) {
    case "charge.success":
      if (row.reference) {
        try {
          // Re-verifies with Paystack's API rather than trusting the webhook body alone
          await confirmDeposit(row.reference);
        } catch (error) {
          // Other payments on the same Paystack account that are not wallet deposits
          if (!(error instanceof DepositNotFoundError)) throw error;
          logger.info({ reference: row.reference }, "charge.success for an unknown reference; ignoring");
        }
      }
      break;
    case "transfer.success":
    case "transfer.failed":
    case "transfer.reversed":
      if (row.reference) {
        try {
          // As with charges, the outcome comes from Paystack's verify endpoint, not the payload
          await confirmWithdrawal(row.reference);
        } catch (error) {
          if (!(error instanceof WithdrawalNotFoundError)) throw error;
          logger.info({ reference: row.reference }, `${row.event} for an unknown reference; ignoring`);
        }
      }
      break;
    default:
      logger.debug({ event: row.event }, "Paystack event not handled");
  }

  await prisma.paystackEvent.update({ where: { id: eventId }, data: { processedAt: new Date() } });
};
