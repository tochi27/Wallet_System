-- CreateEnum
CREATE TYPE "LedgerAccountType" AS ENUM ('ASSET', 'LIABILITY', 'EQUITY');

-- CreateEnum
CREATE TYPE "JournalEntryType" AS ENUM ('OPENING_BALANCE', 'DEPOSIT', 'TRANSFER', 'WITHDRAWAL', 'WITHDRAWAL_PAID', 'WITHDRAWAL_REFUND', 'REVERSAL', 'ADJUSTMENT', 'DIRECT_FUNDING');

-- CreateEnum
CREATE TYPE "AdjustmentDirection" AS ENUM ('CREDIT', 'DEBIT');

-- CreateEnum
CREATE TYPE "AdjustmentKind" AS ENUM ('REFUND', 'GOODWILL', 'CORRECTION');

-- CreateEnum
CREATE TYPE "AdjustmentStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- AlterEnum
BEGIN;
CREATE TYPE "Role_new" AS ENUM ('USER', 'VIEWER', 'SUPPORT', 'FINANCE', 'OWNER');
ALTER TABLE "public"."User" ALTER COLUMN "role" DROP DEFAULT;
-- The single ADMIN role becomes OWNER, the most senior staff role
ALTER TABLE "User" ALTER COLUMN "role" TYPE "Role_new" USING (CASE WHEN "role"::text = 'ADMIN' THEN 'OWNER' ELSE "role"::text END::"Role_new");
ALTER TYPE "Role" RENAME TO "Role_old";
ALTER TYPE "Role_new" RENAME TO "Role";
DROP TYPE "public"."Role_old";
ALTER TABLE "User" ALTER COLUMN "role" SET DEFAULT 'USER';
COMMIT;

-- CreateTable
CREATE TABLE "LedgerAccount" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "LedgerAccountType" NOT NULL,
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LedgerAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JournalEntry" (
    "id" TEXT NOT NULL,
    "type" "JournalEntryType" NOT NULL,
    "description" TEXT NOT NULL,
    "reference" TEXT,
    "transactionId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JournalEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LedgerLine" (
    "id" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,

    CONSTRAINT "LedgerLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Adjustment" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "direction" "AdjustmentDirection" NOT NULL,
    "kind" "AdjustmentKind" NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "AdjustmentStatus" NOT NULL DEFAULT 'PENDING',
    "requestedById" TEXT NOT NULL,
    "decidedById" TEXT,
    "decisionNote" TEXT,
    "transactionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),

    CONSTRAINT "Adjustment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LedgerAccount_code_key" ON "LedgerAccount"("code");

-- CreateIndex
CREATE UNIQUE INDEX "LedgerAccount_userId_key" ON "LedgerAccount"("userId");

-- CreateIndex
CREATE INDEX "JournalEntry_reference_idx" ON "JournalEntry"("reference");

-- CreateIndex
CREATE INDEX "JournalEntry_transactionId_idx" ON "JournalEntry"("transactionId");

-- CreateIndex
CREATE INDEX "JournalEntry_createdAt_idx" ON "JournalEntry"("createdAt");

-- CreateIndex
CREATE INDEX "LedgerLine_accountId_idx" ON "LedgerLine"("accountId");

-- CreateIndex
CREATE INDEX "LedgerLine_entryId_idx" ON "LedgerLine"("entryId");

-- CreateIndex
CREATE UNIQUE INDEX "Adjustment_transactionId_key" ON "Adjustment"("transactionId");

-- CreateIndex
CREATE INDEX "Adjustment_status_createdAt_idx" ON "Adjustment"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Adjustment_userId_idx" ON "Adjustment"("userId");

-- AddForeignKey
ALTER TABLE "LedgerAccount" ADD CONSTRAINT "LedgerAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerLine" ADD CONSTRAINT "LedgerLine_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "JournalEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerLine" ADD CONSTRAINT "LedgerLine_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "LedgerAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Adjustment" ADD CONSTRAINT "Adjustment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Adjustment" ADD CONSTRAINT "Adjustment_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Adjustment" ADD CONSTRAINT "Adjustment_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Lines are never zero
ALTER TABLE "LedgerLine" ADD CONSTRAINT "LedgerLine_amount_not_zero" CHECK ("amount" <> 0);

-- ── System accounts ──────────────────────────────────────────────────────────
INSERT INTO "LedgerAccount" ("id", "code", "name", "type") VALUES
  (gen_random_uuid()::text, 'paystack_clearing', 'Paystack clearing', 'ASSET'),
  (gen_random_uuid()::text, 'payouts_in_transit', 'Payouts in transit', 'LIABILITY'),
  (gen_random_uuid()::text, 'adjustments', 'Adjustments', 'EQUITY'),
  (gen_random_uuid()::text, 'dev_funding', 'Development funding', 'EQUITY'),
  (gen_random_uuid()::text, 'opening_balances', 'Opening balances', 'EQUITY');

-- A wallet account for every existing user (new users get theirs on their first posting)
INSERT INTO "LedgerAccount" ("id", "code", "name", "type", "userId")
SELECT gen_random_uuid()::text, 'wallet:' || u."id", 'Wallet: ' || u."name", 'LIABILITY', u."id"
FROM "User" u;

-- ── Opening balances ─────────────────────────────────────────────────────────
-- The ledger starts from today's balances: one balanced entry per non-empty wallet, against the
-- "Opening balances" account. Everything after this is recorded in full.
WITH w AS (
  SELECT "userId", "balance", gen_random_uuid()::text AS entry_id FROM "Wallet" WHERE "balance" <> 0
), entries AS (
  INSERT INTO "JournalEntry" ("id", "type", "description")
  SELECT entry_id, 'OPENING_BALANCE', 'Balance when the ledger started' FROM w
  RETURNING "id"
)
INSERT INTO "LedgerLine" ("id", "entryId", "accountId", "amount")
SELECT gen_random_uuid()::text, w.entry_id, (SELECT "id" FROM "LedgerAccount" WHERE "code" = 'opening_balances'), w."balance" FROM w
UNION ALL
SELECT gen_random_uuid()::text, w.entry_id, a."id", -w."balance" FROM w JOIN "LedgerAccount" a ON a."userId" = w."userId";

-- ── Guarantees ───────────────────────────────────────────────────────────────
-- Created after the opening balances so the backfill above isn't checked line by line.

-- Every entry must have at least two lines that sum to zero. Checked when the transaction
-- commits, so an entry and its lines can be written in any order inside one transaction.
CREATE FUNCTION journal_entry_must_balance(entry TEXT) RETURNS void AS $$
DECLARE
  total NUMERIC;
  line_count INT;
BEGIN
  SELECT COALESCE(SUM("amount"), 0), COUNT(*) INTO total, line_count FROM "LedgerLine" WHERE "entryId" = entry;
  IF line_count < 2 OR total <> 0 THEN
    RAISE EXCEPTION 'Journal entry % is unbalanced: % lines totalling %', entry, line_count, total;
  END IF;
END;
$$ LANGUAGE plpgsql;

CREATE FUNCTION journal_entry_balanced_check() RETURNS trigger AS $$
BEGIN
  PERFORM journal_entry_must_balance(NEW."id");
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE FUNCTION ledger_line_balanced_check() RETURNS trigger AS $$
BEGIN
  PERFORM journal_entry_must_balance(NEW."entryId");
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER journal_entry_balanced
AFTER INSERT ON "JournalEntry" DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION journal_entry_balanced_check();

CREATE CONSTRAINT TRIGGER ledger_line_balanced
AFTER INSERT ON "LedgerLine" DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION ledger_line_balanced_check();

-- The ledger is append-only: mistakes are corrected with new entries, never by editing history
CREATE FUNCTION ledger_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER journal_entry_append_only BEFORE UPDATE OR DELETE ON "JournalEntry"
FOR EACH ROW EXECUTE FUNCTION ledger_append_only();

CREATE TRIGGER ledger_line_append_only BEFORE UPDATE OR DELETE ON "LedgerLine"
FOR EACH ROW EXECUTE FUNCTION ledger_append_only();

CREATE TRIGGER ledger_account_no_delete BEFORE DELETE ON "LedgerAccount"
FOR EACH ROW EXECUTE FUNCTION ledger_append_only();
