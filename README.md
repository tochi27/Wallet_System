# 💰 Wallet System API

A production-grade **TypeScript** wallet engine built with **Express**, **Prisma**, and **Redis** — supporting credits, debits, peer-to-peer transfers, reversals, idempotency, webhook notifications with retry, and cursor-based pagination.

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
| CI | **GitHub Actions** | Type-check and test on every push/PR |

---

## 🧩 Features

- **Wallet operations** — credit, debit, balance (stored + computed), transaction history
- **Peer-to-peer transfers** — atomic debit/credit with distributed locking
- **Reversals** — reverse any successful transaction; transfer reversals unwind both legs
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
- **Rate limiting** — per-route express-rate-limit (skipped in test environment)

---

## 🏁 Quick Start

### Prerequisites
- Node.js **v20+**
- Docker & Docker Compose

### 1. Clone & Install

```bash
git clone <your-repo-url>
cd wallet-system
npm install
```

### 2. Environment Setup

Copy the example file and fill in your values:

```bash
cp .env.example .env.development
```

The app loads `.env.{NODE_ENV}` at startup — so you need:

| File | Used when |
|:-----|:----------|
| `.env.development` | `npm run dev` |
| `.env.test` | `npm test` |
| `.env.production` | production |

### 3. Start Dependencies

```bash
docker compose up -d   # starts Postgres and Redis
```

### 4. Run Migrations & Generate Client

```bash
npx prisma migrate deploy
npx prisma generate
```

### 5. Start the Dev Server

```bash
npm run dev
```

Server runs at `http://localhost:4000`.

---

## 🧪 Testing

All tests are fully mocked — no running database or Redis required.

```bash
npm test                 # run all tests
npm run test:coverage    # run with coverage report
```

---

## 🧰 Scripts

| Command | Description |
|:--------|:------------|
| `npm run dev` | Start development server with Nodemon |
| `npm run build` | Compile TypeScript to JavaScript |
| `npm start` | Run compiled build |
| `npm test` | Run Jest test suite |
| `npm run test:coverage` | Run tests with coverage report |
| `npm run db:generate` | Regenerate Prisma client |
| `npm run db:push` | Push schema changes without a migration |
| `npm run db:studio` | Open Prisma Studio |
| `npm run docker:dev` | Start app + dependencies via Docker Compose |

---

## 📚 API Documentation

Swagger UI is available at:

```
http://localhost:4000/api-docs
```

### Endpoints

| Method | Path | Description |
|:-------|:-----|:------------|
| `POST` | `/api/auth/signup` | Register a new user |
| `POST` | `/api/auth/login` | Login and receive a JWT |
| `POST` | `/api/auth/logout` | Invalidate the current token |
| `POST` | `/api/wallet/credit` | Credit the wallet |
| `POST` | `/api/wallet/debit` | Debit the wallet |
| `GET` | `/api/wallet/balance` | Get stored and computed balance |
| `GET` | `/api/wallet/transactions` | Paginated transaction history |
| `POST` | `/api/wallet/transfer` | Transfer funds to another user |
| `POST` | `/api/wallet/transactions/:id/reverse` | Reverse a transaction |
| `POST` | `/api/webhooks` | Register a webhook |
| `GET` | `/api/webhooks` | List active webhooks |
| `DELETE` | `/api/webhooks/:id` | Deactivate a webhook |
| `GET` | `/api/webhooks/:id/deliveries` | View delivery history |
| `GET` | `/health` | Health check (DB + Redis status) |

---

## 🧱 Project Structure

```
src/
├── app.ts                    # Express app setup, middleware, workers
├── server.ts                 # Entry point
├── config/
│   ├── db.ts                 # Prisma client
│   ├── env.ts                # Zod env validation
│   ├── logger.ts             # Pino logger
│   └── redis.config.ts       # BullMQ connection config
├── controllers/              # Route handlers
├── middleware/               # Auth, validation, rate limiting
├── queues/                   # BullMQ queue definitions
├── routes/                   # API route definitions
├── services/                 # Business logic
├── swagger-docs/             # Modular Swagger JSDoc comments
├── tests/
│   ├── integration/          # Supertest controller tests
│   └── unit/                 # Service and worker unit tests
├── utils/                    # Helpers (JWT, locks, cache, idempotency)
├── validators/               # Zod request schemas
└── workers/                  # BullMQ worker processes
```

---

## 🔒 Security

- Passwords hashed with **bcrypt**
- JWTs signed with a secret (minimum 32 chars in production)
- Tokens blacklisted in Redis on logout (TTL matches token expiry)
- All webhook payloads signed with **HMAC-SHA256**; verify the `X-Webhook-Signature` header on receipt
- Helmet middleware sets security headers on every response
- Rate limiting on auth and wallet routes

---

## 🐳 Docker

```bash
docker compose up -d       # start Postgres + Redis in background
docker compose down        # stop and remove containers
docker compose down -v     # also remove volumes (wipes DB data)
```

---

## 🚨 Troubleshooting

| Issue | Fix |
|:------|:----|
| `DATABASE_URL is required` at startup | Check your `.env.development` file exists and has the variable set |
| `ECONNREFUSED 6379` | Redis isn't running — start Docker Desktop then `docker compose up -d` |
| `ECONNREFUSED 5432` | Postgres isn't running — same as above |
| Prisma type errors | Run `npx prisma generate` after any schema change |
| Port already in use | Change `PORT` in `.env.development` |
