// Runs before the browser tests' API starts (see playwright.config.ts): an empty, fully migrated
// database and an empty Redis database, so every run starts from the same place.
import { execSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { PrismaClient } from "@prisma/client"
import Redis from "ioredis"
import { assertTestDatabase, E2E } from "./env.mjs"

assertTestDatabase()

const apiDir = fileURLToPath(new URL("../../api", import.meta.url))
const target = new URL(E2E.databaseUrl)
const name = target.pathname.slice(1)
// The server's maintenance database, to drop and recreate the test one from
const admin = new URL(E2E.databaseUrl)
admin.pathname = "/postgres"

// Drops and recreates wallet_e2e (name checked above), then applies every migration, exactly as a
// deploy would, with its triggers and system accounts
const maintenance = new PrismaClient({ datasourceUrl: admin.toString() })
await maintenance.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`)
await maintenance.$executeRawUnsafe(`CREATE DATABASE "${name}"`)
await maintenance.$disconnect()
execSync("npx prisma migrate deploy", {
  cwd: apiDir,
  env: { ...process.env, DATABASE_URL: E2E.databaseUrl },
  stdio: ["ignore", "ignore", "inherit"],
})

// Only ever wipe a Redis database that is empty or that an earlier run marked as ours: the port
// might be another project's Redis, whose data must never be touched
const MARKER = "purplewallet:e2e-database"
const redis = new Redis(E2E.redisUrl)
const keys = await redis.dbsize()
if (keys > 0 && !(await redis.exists(MARKER))) {
  redis.disconnect()
  throw new Error(
    `Refusing to wipe ${E2E.redisUrl}: it has ${keys} keys and isn't marked as the browser tests' database. ` +
      "Another project's Redis may be using this port. Stop it, or set E2E_REDIS_URL to a free database."
  )
}
await redis.flushdb()
await redis.set(MARKER, "1")
redis.disconnect()
console.log("e2e: fresh database and Redis ready")
