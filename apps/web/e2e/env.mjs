// Where the browser tests' own API, web app, database and Redis live. Override with env vars in CI.
const apiPort = Number(process.env.E2E_API_PORT ?? 4100)
const webPort = Number(process.env.E2E_WEB_PORT ?? 5174)

export const E2E = {
  apiPort,
  webPort,
  apiUrl: `http://localhost:${apiPort}`,
  webUrl: `http://localhost:${webPort}`,
  databaseUrl: process.env.E2E_DATABASE_URL ?? "postgresql://postgres:password@localhost:5432/wallet_e2e",
  redisUrl: process.env.E2E_REDIS_URL ?? "redis://localhost:6380/1",
}

// global-setup wipes this database, so refuse anything that isn't clearly a test database
export const assertTestDatabase = () => {
  const name = new URL(E2E.databaseUrl).pathname.slice(1)
  if (!/_e2e$/.test(name)) {
    throw new Error(`Refusing to run browser tests against "${name}": the database name must end in _e2e`)
  }
  const redisDb = Number(new URL(E2E.redisUrl).pathname.slice(1) || 0)
  if (redisDb === 0) throw new Error("Browser tests must use their own Redis database (e.g. redis://localhost:6380/1), not 0")
}
