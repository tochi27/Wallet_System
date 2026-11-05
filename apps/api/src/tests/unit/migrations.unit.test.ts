import { readdirSync, readFileSync } from "fs";
import path from "path";

// Supabase exposes every table in "public" through its Data API unless row-level security is on.
// The lock-down migration covered every table that existed then; each later migration must turn it
// on for the tables it creates (the app itself connects as the owner, which bypasses it).
const MIGRATIONS = path.join(__dirname, "../../../prisma/migrations");
const LOCK_DOWN = "20261104000000_lock_down_public_schema";

const migrations = readdirSync(MIGRATIONS, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

describe("migrations", () => {
  it("include the lock-down of Supabase's Data API", () => {
    expect(migrations).toContain(LOCK_DOWN);
  });

  const later = migrations.filter((name) => name > LOCK_DOWN);
  const cases = later.length > 0 ? later : ["(none yet)"];

  it.each(cases)("%s turns on row-level security for every table it creates", (name) => {
    if (name === "(none yet)") return;
    const sql = readFileSync(path.join(MIGRATIONS, name, "migration.sql"), "utf8");
    const created = [...sql.matchAll(/CREATE TABLE (?:IF NOT EXISTS )?"?(?:public"?\."?)?([A-Za-z_][A-Za-z0-9_]*)"?/gi)].map((m) => m[1]);
    for (const table of created) {
      const enabled = new RegExp(`ALTER TABLE (?:"?public"?\\.)?"?${table}"? ENABLE ROW LEVEL SECURITY`, "i").test(sql);
      expect({ table, rowLevelSecurity: enabled }).toEqual({ table, rowLevelSecurity: true });
    }
  });
});
