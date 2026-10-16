import { Request, Response } from "express";
import { z } from "zod";
import logger from "../config/logger";
import {
  AdminActionError,
  freezeUser,
  setUserTier,
  getOverview,
  getPaystackEvent,
  getReconciliation,
  getUserDetail,
  listAuditLog,
  listDeposits,
  listPaystackEvents,
  listWithdrawals,
  recheckDeposit,
  recheckWithdrawal,
  searchUsers,
  unfreezeUser,
  unlockPin,
} from "../services/admin/admin.service";
import { approveAdjustment, listAdjustments, rejectAdjustment, requestAdjustment } from "../services/admin/adjustments.service";
import { listStaff, setStaffRole } from "../services/admin/staff.service";
import { ledgerSummary, listJournalEntries } from "../services/ledger/ledger.service";
import { errorResponse, successResponse } from "../utils/response.utils";
import {
  adjustmentsQuerySchema,
  depositsQuerySchema,
  ledgerEntriesQuerySchema,
  eventsQuerySchema,
  listQuerySchema,
  withdrawalsQuerySchema,
} from "../validators/admin.validators";

const fail = (res: Response, err: unknown, fallback: string) => {
  if (err instanceof AdminActionError) return errorResponse(res, err.message, err.status);
  logger.error({ err }, fallback);
  return errorResponse(res, fallback, 500);
};

// Parses the query string, answering 400 itself when it's invalid
const parseQuery = <T extends z.ZodTypeAny>(schema: T, req: Request, res: Response): z.infer<T> | null => {
  const parsed = schema.safeParse(req.query);
  if (parsed.success) return parsed.data;
  errorResponse(res, parsed.error.issues[0]?.message ?? "Invalid query", 400);
  return null;
};

const param = (req: Request, name: string) => String(req.params[name]);

export const overview = async (_req: Request, res: Response) => {
  try {
    return successResponse(res, "Overview fetched", await getOverview());
  } catch (err) {
    return fail(res, err, "Could not load the overview");
  }
};

export const users = async (req: Request, res: Response) => {
  const query = parseQuery(listQuerySchema, req, res);
  if (!query) return;
  try {
    return successResponse(res, "Users fetched", await searchUsers(query.search, query.limit, query.cursor));
  } catch (err) {
    return fail(res, err, "Could not fetch users");
  }
};

export const userDetail = async (req: Request, res: Response) => {
  try {
    return successResponse(res, "User fetched", await getUserDetail(param(req, "id")));
  } catch (err) {
    return fail(res, err, "Could not fetch the user");
  }
};

export const freeze = async (req: Request, res: Response) => {
  try {
    await freezeUser(req.userId, param(req, "id"), req.body.reason);
    return successResponse(res, "Account frozen", await getUserDetail(param(req, "id")));
  } catch (err) {
    return fail(res, err, "Could not freeze the account");
  }
};

export const unfreeze = async (req: Request, res: Response) => {
  try {
    await unfreezeUser(req.userId, param(req, "id"), req.body.reason);
    return successResponse(res, "Account unfrozen", await getUserDetail(param(req, "id")));
  } catch (err) {
    return fail(res, err, "Could not unfreeze the account");
  }
};

export const changeTier = async (req: Request, res: Response) => {
  try {
    await setUserTier(req.userId, param(req, "id"), req.body.tier, req.body.reason);
    return successResponse(res, "Tier changed", await getUserDetail(param(req, "id")));
  } catch (err) {
    return fail(res, err, "Could not change the tier");
  }
};

export const unlockUserPin = async (req: Request, res: Response) => {
  try {
    await unlockPin(req.userId, param(req, "id"), req.body.reason);
    return successResponse(res, "PIN unlocked", await getUserDetail(param(req, "id")));
  } catch (err) {
    return fail(res, err, "Could not unlock the PIN");
  }
};

export const deposits = async (req: Request, res: Response) => {
  const query = parseQuery(depositsQuerySchema, req, res);
  if (!query) return;
  try {
    return successResponse(res, "Deposits fetched", await listDeposits(query));
  } catch (err) {
    return fail(res, err, "Could not fetch deposits");
  }
};

export const withdrawals = async (req: Request, res: Response) => {
  const query = parseQuery(withdrawalsQuerySchema, req, res);
  if (!query) return;
  try {
    return successResponse(res, "Withdrawals fetched", await listWithdrawals(query));
  } catch (err) {
    return fail(res, err, "Could not fetch withdrawals");
  }
};

export const recheckDepositStatus = async (req: Request, res: Response) => {
  try {
    return successResponse(res, "Deposit rechecked", await recheckDeposit(req.userId, param(req, "reference")));
  } catch (err) {
    return fail(res, err, "Could not recheck the deposit");
  }
};

export const recheckWithdrawalStatus = async (req: Request, res: Response) => {
  try {
    return successResponse(res, "Withdrawal rechecked", await recheckWithdrawal(req.userId, param(req, "reference")));
  } catch (err) {
    return fail(res, err, "Could not recheck the withdrawal");
  }
};

export const paystackEvents = async (req: Request, res: Response) => {
  const query = parseQuery(eventsQuerySchema, req, res);
  if (!query) return;
  try {
    return successResponse(res, "Events fetched", await listPaystackEvents(query));
  } catch (err) {
    return fail(res, err, "Could not fetch events");
  }
};

export const paystackEvent = async (req: Request, res: Response) => {
  try {
    return successResponse(res, "Event fetched", await getPaystackEvent(param(req, "id")));
  } catch (err) {
    return fail(res, err, "Could not fetch the event");
  }
};

export const reconciliation = async (_req: Request, res: Response) => {
  try {
    return successResponse(res, "Reconciliation fetched", await getReconciliation());
  } catch (err) {
    return fail(res, err, "Could not run reconciliation");
  }
};

export const auditLog = async (req: Request, res: Response) => {
  const query = parseQuery(listQuerySchema, req, res);
  if (!query) return;
  try {
    return successResponse(res, "Audit log fetched", await listAuditLog(query));
  } catch (err) {
    return fail(res, err, "Could not fetch the audit log");
  }
};

// ---------- Adjustments ----------

export const createAdjustment = async (req: Request, res: Response) => {
  try {
    const adjustment = await requestAdjustment(req.userId, { ...req.body, userId: param(req, "id") });
    const applied = adjustment.status === "APPROVED";
    return successResponse(res, applied ? "Balance adjusted" : "Waiting for a second admin to approve", adjustment, applied ? 200 : 202);
  } catch (err) {
    return fail(res, err, "Could not adjust the balance");
  }
};

export const adjustments = async (req: Request, res: Response) => {
  const query = parseQuery(adjustmentsQuerySchema, req, res);
  if (!query) return;
  try {
    return successResponse(res, "Adjustments fetched", await listAdjustments(req.userId, query));
  } catch (err) {
    return fail(res, err, "Could not fetch adjustments");
  }
};

export const approve = async (req: Request, res: Response) => {
  try {
    return successResponse(res, "Adjustment approved", await approveAdjustment(req.userId, param(req, "id"), req.body.password, req.body.note));
  } catch (err) {
    return fail(res, err, "Could not approve the adjustment");
  }
};

export const reject = async (req: Request, res: Response) => {
  try {
    return successResponse(res, "Adjustment rejected", await rejectAdjustment(req.userId, param(req, "id"), req.body.password, req.body.reason));
  } catch (err) {
    return fail(res, err, "Could not reject the adjustment");
  }
};

// ---------- Staff ----------

export const staff = async (_req: Request, res: Response) => {
  try {
    return successResponse(res, "Staff fetched", await listStaff());
  } catch (err) {
    return fail(res, err, "Could not fetch staff");
  }
};

export const changeRole = async (req: Request, res: Response) => {
  try {
    return successResponse(res, "Role updated", await setStaffRole(req.userId, param(req, "id"), req.body.role, req.body.reason, req.body.password));
  } catch (err) {
    return fail(res, err, "Could not change the role");
  }
};

// ---------- Ledger ----------

export const ledger = async (_req: Request, res: Response) => {
  try {
    return successResponse(res, "Ledger fetched", await ledgerSummary());
  } catch (err) {
    return fail(res, err, "Could not load the ledger");
  }
};

export const ledgerEntries = async (req: Request, res: Response) => {
  const query = parseQuery(ledgerEntriesQuerySchema, req, res);
  if (!query) return;
  try {
    return successResponse(res, "Journal entries fetched", await listJournalEntries(query));
  } catch (err) {
    return fail(res, err, "Could not fetch journal entries");
  }
};
