-- The ledger migration stamped its opening-balance entries with the database's local time, but the
-- app stores UTC. On a database whose timezone isn't UTC that put them in the future (an hour
-- ahead in Africa/Lagos). This shifts only those entries back to UTC. On a UTC database (e.g.
-- production) the times are already right, nothing is in the future, and nothing changes.
--
-- The ledger is append-only; this one-off correction is the only place that lifts that, for these
-- rows, inside this migration's own transaction.

ALTER TABLE "JournalEntry" DISABLE TRIGGER journal_entry_append_only;

UPDATE "JournalEntry"
SET "createdAt" = ("createdAt" AT TIME ZONE current_setting('TimeZone')) AT TIME ZONE 'UTC'
WHERE "type" = 'OPENING_BALANCE'
  AND "createdAt" > (now() AT TIME ZONE 'UTC');

ALTER TABLE "JournalEntry" ENABLE TRIGGER journal_entry_append_only;
