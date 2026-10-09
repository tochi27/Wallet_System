# 💰 Wallet System

A monorepo containing the wallet API (`apps/api`) and its web frontend (`apps/web`).

The API is a production-grade **TypeScript** wallet engine built with **Express**, **Prisma**, and **Redis** — supporting credits, debits, peer-to-peer transfers, reversals, idempotency, webhook notifications with retry, and cursor-based pagination.

---

## ⚙️ Tech Stack

| Layer | Technology | Purpose |
|:------|:-----------|:--------|
| Language | **TypeScript** | Type safety |
| Framework | **Express.js** | HTTP server |
| ORM | **Prisma** | Database modeling and access |
| Database | **PostgreSQL** | Persistent data layer |
| Cache & Locks | **Redis (ioredis)** | Distributed locks, balance cache, token blacklist, idempotency |
| Queue | **BullMQ** | Async transaction events and webhook dispatch with retry |
| Validation | **Zod** | Runtime schema validation (env vars + request bodies) |
| Logging | **Pino + pino-http** | Structured JSON logging with request tracing |
| Testing | **Jest + Supertest** | Unit and integration tests |
| Documentation | **Swagger (swagger-jsdoc + swagger-ui-express)** | Auto-generated API docs |
| Containerization | **Docker + Docker Compose** | Local environment |
| CI/CD | **GitHub Actions** | Type-check and test on every push/PR; auto-deploy to Render on merge to main |

---

## 🧩 Features

- **Paystack deposits** — checkout via Paystack; the wallet is credited only after server-side verification, exactly once (redirect, webhook and retries can race safely)
- **Paystack withdrawals** — saved bank accounts (name looked up via Paystack), transfers with the wallet debited up front and refunded exactly once if the transfer fails or is reversed; a follow-up check and 5-minute reconciliation settle anything a webhook misses
- **Wallet operations** — credit, debit, balance (stored + computed), transaction history
- **Peer-to-peer transfers** — atomic debit/credit with distributed locking
- **Reversals** — reverse a successful transaction; transfer reversals unwind both legs (development only — see Direct funding)
- **Direct funding guard** — `/credit`, `/debit` and user reversals create or remove money with no real payment, so they return 403 in production unless `DIRECT_FUNDING_ENABLED=true`; real money moves through Paystack
- **Idempotency** — `Idempotency-Key` header on credit, debit, and transfer (24-hour Redis TTL)
- **Cursor-based pagination** — `GET /api/wallet/transactions` with `limit` + `cursor`
- **Webhooks** — register endpoints, HMAC-SHA256 signed deliveries, soft-delete
- **Webhook retry** — BullMQ queue, 4 attempts, exponential backoff (2 s base)
- **Delivery history** — per-attempt audit trail via `GET /api/webhooks/:id/deliveries`
- **Distributed locking** — Redis SET NX PX + Lua release prevents concurrent balance corruption
- **Balance caching** — 60-second Redis TTL, invalidated on every write
- **Token blacklisting** — SHA-256 hashed JWTs stored in Redis with matching TTL
- **Health check** — `GET /health` probes Postgres and Redis, returns 200/503
- **Env validation** — Zod schema at startup, typed `env` export, fails fast with clear errors
- **Rate limiting** — per IP, per 15 minutes: auth 10, writes 60, reads 300 (skipped in test environment)

---

## 🏁 Quick Start

### Prerequisites
- Node.js **v20+**
- Docker & Docker Compose

### 1. Clone & Install

This is an **npm workspaces** monorepo — run `npm install` once at the repo root; it installs every app.

```bash
git clone <your-repo-url>
cd wallet-system
npm install
```

### 2. Environment Setup

Copy the example file and fill in your values:

```bash
cp apps/api/.env.example apps/api/.env.development
```

The API loads `.env.{NODE_ENV}` from `apps/api/` at startup — so you need:

| File | Used when |
|:-----|:----------|
| `apps/api/.env.development` | `npm run dev:api` |
| `apps/api/.env.test` | `npm run test:api` |
| `apps/api/.env.production` | production |

### 3. Start Dependencies

```bash
docker compose up -d postgres redis
```

### 4. Run Migrations & Generate Client

```bash
npm run db:deploy
npm run db:generate
```

### 5. Start the Dev Server

```bash
npm run dev:api
```

Server runs at `http://localhost:4000`.

---

## 🧪 Testing

All tests are fully mocked — no running database or Redis required.

```bash
npm run test:api             # run all API tests
npm run test:api:coverage    # run with coverage report
```

---

## 🧰 Scripts

Run these from the repo root. Each one forwards to the matching workspace (`npm run <script> -w apps/api`).

| Command | Description |
|:--------|:------------|
| `npm run dev:api` | Start API development server with Nodemon |
| `npm run build:api` | Compile the API's TypeScript to JavaScript |
| `npm run start:api` | Run the compiled API build |
| `npm run test:api` | Run the API's Jest test suite |
| `npm run test:api:coverage` | Run API tests with coverage report |
| `npm run db:generate` | Regenerate Prisma client |
| `npm run db:migrate` | Create and apply a new migration (dev) |
| `npm run db:deploy` | Apply pending migrations |
| `npm run db:push` | Push schema changes without a migration |
| `npm run db:studio` | Open Prisma Studio |
| `npm run docker:dev` | Start API + dependencies via Docker Compose |

---

## 📚 API Documentation

Swagger UI is available at:

| Environment | URL |
|:------------|:----|
| Production | `https://wallet-system-api-16cv.onrender.com/api-docs` |
| Local | `http://localhost:4000/api-docs` |

### Endpoints

| Method | Path | Description |
|:-------|:-----|:------------|
| `POST` | `/api/auth/signup` | Register a new user |
| `POST` | `/api/auth/login` | Login and receive a JWT |
| `POST` | `/api/auth/logout` | Invalidate the current token |
| `GET` | `/api/auth/me` | Get the authenticated user's profile |
| `POST` | `/api/wallet/credit` | Credit the wallet (dev only — `DIRECT_FUNDING_ENABLED`) |
| `POST` | `/api/wallet/debit` | Debit the wallet (dev only — `DIRECT_FUNDING_ENABLED`) |
| `GET` | `/api/wallet/balance` | Get stored and computed balance |
| `GET` | `/api/wallet/transactions` | Paginated transaction history |
| `GET` | `/api/wallet/stats` | Money in/out totals, period-over-period change, daily series |
| `POST` | `/api/payments/deposits` | Start a Paystack deposit (returns a checkout link) |
| `GET` | `/api/payments/deposits/:reference` | Deposit status (verifies with Paystack while pending) |
| `POST` | `/api/payments/paystack/webhook` | Paystack webhook receiver (signature-verified) |
| `GET` | `/api/payments/banks` | Banks that can receive withdrawals |
| `POST` | `/api/payments/bank-accounts/resolve` | Look up the name on a bank account |
| `POST` | `/api/payments/bank-accounts` | Save a payout bank account |
| `GET` | `/api/payments/bank-accounts` | List saved bank accounts |
| `DELETE` | `/api/payments/bank-accounts/:id` | Remove a saved bank account |
| `POST` | `/api/payments/withdrawals` | Withdraw to a saved bank account (Paystack transfer) |
| `GET` | `/api/payments/withdrawals` | Recent withdrawals |
| `POST` | `/api/wallet/transfer` | Transfer funds to another user |
| `POST` | `/api/wallet/transactions/:id/reverse` | Reverse a transaction (dev only — `DIRECT_FUNDING_ENABLED`) |
| `POST` | `/api/webhooks` | Register a webhook |
| `GET` | `/api/webhooks` | List active webhooks |
| `DELETE` | `/api/webhooks/:id` | Deactivate a webhook |
| `GET` | `/api/webhooks/:id/deliveries` | View delivery history |
| `GET` | `/health` | Health check (DB + Redis status) |

---

## 🧱 Project Structure

```
wallet-system/
├── package.json                  # Workspace root (npm workspaces) + proxy scripts
├── docker-compose.yaml           # Postgres, Redis, and the API for local dev
├── render.yaml                   # Render Blueprint
└── apps/
    ├── api/                      # Express REST API
    │   ├── Dockerfile            # Built with the repo root as context
    │   ├── INTEGRATION.md        # Guide for API consumers
    │   ├── prisma/               # Schema + migrations
    │   └── src/
    │       ├── app.ts            # Express app setup, middleware, workers
    │       ├── server.ts         # Entry point
    │       ├── config/           # Prisma client, env validation, logger, Redis config
    │       ├── controllers/      # Route handlers
    │       ├── middleware/       # Auth, validation, rate limiting
    │       ├── queues/           # BullMQ queue definitions
    │       ├── routes/           # API route definitions
    │       ├── services/         # Business logic
    │       ├── swagger-docs/     # Modular Swagger JSDoc comments
    │       ├── tests/            # integration/ (Supertest) + unit/
    │       ├── utils/            # Helpers (JWT, locks, cache, idempotency)
    │       ├── validators/       # Zod request schemas
    │       └── workers/          # BullMQ worker processes
    └── web/                      # Frontend (coming soon)
```

---

## 🔒 Security

- Passwords hashed with **bcrypt**
- JWTs signed with a secret (minimum 32 chars in production)
- Tokens blacklisted in Redis on logout (TTL matches token expiry)
- All webhook payloads signed with **HMAC-SHA256**; verify the `X-Webhook-Signature` header on receipt
- Helmet middleware sets security headers on every response
- CORS restricted to the origins in `CORS_ORIGINS` (defaults to `http://localhost:5173`)
- User objects returned by the API never include the password hash
- Rate limiting on auth (10), money-moving writes (60) and reads (300) per 15 minutes

---

## 🐳 Docker

```bash
docker compose up -d postgres redis   # start Postgres + Redis in background
docker compose up --build             # also run the API in a container
docker compose down                   # stop and remove containers
docker compose down -v                # also remove volumes (wipes DB data)
```

The API image is built from the repo root so it can use the shared lockfile:

```bash
docker build -f apps/api/Dockerfile .
```

---

## 🚨 Troubleshooting

| Issue | Fix |
|:------|:----|
| `DATABASE_URL is required` at startup | Check `apps/api/.env.development` exists and has the variable set |
| `ECONNREFUSED 6379` | Redis isn't running — start Docker Desktop then `docker compose up -d postgres redis` |
| `ECONNREFUSED 5432` | Postgres isn't running — same as above |
| Prisma type errors | Run `npm run db:generate` after any schema change |
| Port already in use | Change `PORT` in `apps/api/.env.development` |
