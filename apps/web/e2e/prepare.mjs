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

const redis = new Redis(E2E.redisUrl)
await redis.flushdb()
redis.disconnect()
console.log("e2e: fresh database and Redis ready")
