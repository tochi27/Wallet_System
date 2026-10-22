# 💰 PurpleWallet

A monorepo containing the PurpleWallet API (`apps/api`) and its web frontend (`apps/web`).

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
| Queue | **BullMQ** | Async transaction events, webhook dispatch, notifications and AI insights, with retry |
| AI | **Google Gemini (`@google/genai`)** | Spending categories and insight wording (opt-in) |
| Validation | **Zod** | Runtime schema validation (env vars + request bodies) |
| Logging | **Pino + pino-http** | Structured JSON logging with request tracing |
| Testing | **Jest + Supertest** | Unit and integration tests |
| Documentation | **Swagger (swagger-jsdoc + swagger-ui-express)** | Auto-generated API docs |
| Containerization | **Docker + Docker Compose** | Local environment |
| CI/CD | **GitHub Actions** | Type-check and test on every push/PR; auto-deploy to Render on merge to main |

---

## 🧩 Features

- **Paystack deposits** — checkout via Paystack; the wallet is credited only after server-side verification, exactly once (redirect, webhook and retries can race safely)
- **Forgot / change password** — emailed reset links (only a SHA-256 hash stored, single use, 30-minute expiry, same response whether or not the email is registered); any password change signs out every other session
- **Limits and tiers** — Tier 1 (every verified account): ₦50,000 per payment, ₦200,000 a day out, ₦500,000 balance; Tier 2: ₦500,000, ₦2,000,000 a day, no cap. Checked inside the same database transaction and wallet lock as the payment, so simultaneous payments can't slip past. The numbers live in `apps/api/src/config/limits.ts`
- **ID checks for Tier 2** — users upgrade themselves from Settings: their details, a photo of their ID (NIN slip, national ID, driver's licence, passport or voter's card) and a selfie holding it. Staff with the `kyc.review` permission (Support and above) approve or reject with a reason the user sees; nobody reviews their own. Photos are re-encoded (no GPS or camera data), stored AES-256-GCM encrypted with the ID number (`KYC_ENCRYPTION_KEY`), served only to reviewers with no caching, and every opening is audited. Rejected requests' photos are deleted after 30 days
- **Email verification** — signup emails a single-use link (24-hour expiry, only its hash stored); money can't move until the email is verified, and the app shows a banner with a rate-limited Resend
- **AI spending insights (opt-in)** — Google Gemini categorises spending and writes a monthly summary (categories, regular payments, unusual payments). Every figure is calculated by our code and checked before it's shown; people are pseudonymised before anything leaves the server; falls back to another model, then to template sentences, if Gemini is unavailable. Users can correct categories, and their choice always wins
- **AI assistant ("Ask PurpleWallet")** — answers questions about the user's own wallet with read-only tools (balance, totals, transaction search, top recipients, app help). It can't move money: "send ₦5,000 to Grace" opens a pre-filled form the user confirms with their PIN. Same pseudonymising and figure check as insights; 30 questions a day; chats stay in the browser. `npm run eval:assistant -w apps/api` scores it against 18 real questions, with the right answers calculated independently from the database
- **Double-entry ledger** — every money movement (deposits, transfers, withdrawals and payouts, refunds, reversals, adjustments, dev funding) is a journal entry whose lines sum to zero, written in the same database transaction as the movement. Postgres itself rejects an unbalanced entry and any edit or deletion. Accounts: one per user wallet, plus Paystack clearing, payouts in transit, adjustments, development funding and opening balances. Reconciliation checks that stored balance, sum of transactions and ledger balance agree for every wallet
- **Admin roles and balance adjustments** — Viewer, Support, Finance and Owner roles, each with more powers; owners manage staff from the console. Finance can refund, credit or correct a balance: up to ₦10,000 applies at once, above that a different admin must approve (maker-checker). With only one Finance or Owner admin (solo mode), they can approve their own, recorded as self-approved; adding a second switches the two-person rule back on. Password re-entry for every money or role change; everything audited
- **Admin console** — admin-only `/admin` area and `/api/admin` API: user search and detail, freeze/unfreeze (blocks money out only), PIN unlocks, stuck-payment rechecks, Paystack event log, balance reconciliation, and an append-only audit log (a database trigger rejects edits). Admins are granted by script, never through the API
- **Transaction PIN** — 4-digit PIN (bcrypt-hashed, guessable PINs refused) required for transfers and withdrawals; 5 wrong attempts lock money movement for 30 minutes
- **Notifications** — in-app notification centre plus email through Gmail (free, an app password, no domain needed) or Resend, chosen with `EMAIL_PROVIDER` (sent from a BullMQ queue, so slow email never delays a payment; check the setup with `npm run email:test -w apps/api -- you@example.com`); money emails are optional, security alerts (new device sign-in, PIN changes, lockouts) always sent
- **Receipts & statements** — per-transaction receipts, and PDF/CSV statements with opening/closing and running balances (CSV guarded against spreadsheet formula injection)
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

Open Docker Desktop. `npm run dev:api` starts Postgres and Redis for you (and waits until they're ready), so there's nothing to run by hand. To start them on their own:

```bash
docker compose up -d --wait postgres redis
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

### API tests

Fully mocked — no running database or Redis required.

```bash
npm run test:api             # run all API tests
npm run test:api:coverage    # run with coverage report
```

### Browser tests (Playwright)

Real flows in a real browser: signing up and verifying the email, forgot password, sending money with the PIN (and a wrong PIN), the daily limit, the Tier 2 ID check approved and rejected, an admin balance adjustment approved in solo mode, and the phone layout.

```bash
npm run test:e2e             # starts Docker Postgres + Redis, then runs the tests
npm run test:e2e -- --ui     # watch them in Playwright's UI
```

The tests start **their own** API (port 4100) and web app (port 5174) against a separate database, `wallet_e2e`, which is dropped and rebuilt from the migrations on every run, and Redis database 1. Your development data and a running `dev:api` / `dev:web` are never touched (the run refuses any database whose name doesn't end in `_e2e`). Locally they use your installed Chrome; CI installs Chromium. No email, Paystack or Gemini calls are made: the tests read verification and reset links straight from the test database and add money with the development funding endpoint. A failed run leaves screenshots and traces in `apps/web/test-results` (`npx playwright show-report` in `apps/web`).

CI runs the browser tests (plus web lint, build and a type-check of the tests) on every push and pull request that touches either app, and uploads the Playwright report when they fail. The API is deployed only when both the API tests and the browser tests pass.

---

## 🧰 Scripts

Run these from the repo root. Each one forwards to the matching workspace (`npm run <script> -w apps/api`).

| Command | Description |
|:--------|:------------|
| `npm run dev:api` | Start Postgres + Redis (Docker), then the API development server with Nodemon |
| `npm run build:api` | Compile the API's TypeScript to JavaScript |
| `npm run start:api` | Run the compiled API build |
| `npm run test:api` | Run the API's Jest test suite |
| `npm run test:api:coverage` | Run API tests with coverage report |
| `npm run test:e2e` | Run the Playwright browser tests (own API, web app and `wallet_e2e` database) |
| `npm run db:generate` | Regenerate Prisma client |
| `npm run db:migrate` | Create and apply a new migration (dev) |
| `npm run db:deploy` | Apply pending migrations |
| `npm run db:push` | Push schema changes without a migration |
| `npm run db:studio` | Open Prisma Studio |
| `npm run seed:demo -w apps/api` | Development: a demo user with 90 days of realistic activity (`insights-demo@example.com` / `Password123`) |
| `npm run eval:assistant -w apps/api` | Development: score the AI assistant against real questions about the demo user |
| `npm run admin:grant -- <email> "<reason>"` | Make a user an Owner (recorded in the audit log) |
| `npm run admin:revoke -- <email> "<reason>"` | Remove a user's staff access (recorded in the audit log) |

Admin access on a deployed server works differently. See [Admin access](#-admin-access).
| `npm run docker:dev` | Start API + dependencies via Docker Compose |

---

## 👑 Admin access

Staff use the `/admin` area of the web app (and `/api/admin`), with one of four roles: **Viewer** (read-only), **Support** (+ freeze accounts, unlock PINs, recheck payments), **Finance** (+ balance adjustments) and **Owner** (+ managing staff). The command below makes someone an **Owner**: use it for the first owner after a deploy, or to recover if every owner is locked out. After that, owners grant and change roles from Admin → Staff (with their password, audited). A hacked customer account can never promote itself. Every grant and revocation needs a reason and is recorded in the audit log, with the machine account that ran it.

### Locally

Run from the repo root:

```bash
npm run admin:grant -- someone@example.com "New support lead"
npm run admin:revoke -- someone@example.com "Left the company"
```

### On a deployed server

The production image has no TypeScript tooling, so use the compiled versions. Open a shell on the running API service (your host's console or shell feature); it starts in `apps/api`:

```bash
npm run admin:grant:prod -- someone@example.com "New support lead"
npm run admin:revoke:prod -- someone@example.com "Left the company"
```

These use the server's own `DATABASE_URL`, so they change the production database.

**No shell on your host** (common on free plans)? Run the local command from your own machine with `DATABASE_URL` set to the live database instead. [DEPLOYMENT.md](DEPLOYMENT.md#8-your-admin-account-and-the-demo-accounts) shows how.

### Good to know

- **First admin after a fresh deploy:** sign up in the app as normal, then run `admin:grant:prod` with that email.
- **Who is an admin?** In the app, Admin → Users shows an "Admin" badge; Admin → Audit log shows every grant and revocation.
- **Every admin locked out?** The command doesn't need a working admin. Run `admin:grant:prod` again from the server shell.
- **Changes apply immediately**, including to someone who is signed in right now; their next request is checked against the database.
- The email must belong to an existing account, and running the command without a reason just prints the usage.

## 📚 API Documentation

Swagger UI is available at:

| Environment | URL |
|:------------|:----|
| Production | Not deployed at the moment; see [DEPLOYMENT.md](DEPLOYMENT.md) |
| Local | `http://localhost:4000/api-docs` |

### Endpoints

| Method | Path | Description |
|:-------|:-----|:------------|
| `POST` | `/api/auth/signup` | Register a new user |
| `POST` | `/api/auth/login` | Login and receive a JWT |
| `POST` | `/api/auth/logout` | Invalidate the current token |
| `GET` | `/api/auth/me` | Get the authenticated user's profile |
| `POST` | `/api/auth/forgot-password` | Email a password reset link |
| `POST` | `/api/auth/reset-password` | Set a new password with a reset token |
| `POST` | `/api/auth/verify-email` | Verify the email with the token from the signup link |
| `POST` | `/api/auth/resend-verification` | Email the signed-in user a new verification link |
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
| `GET` | `/api/wallet/transactions/:id` | Receipt for one transaction |
| `GET` | `/api/wallet/statement` | Statement as PDF or CSV (`from`, `to`, `format`, `timezone`) |
| `POST` | `/api/account/pin` | Set the transaction PIN |
| `PUT` | `/api/account/pin` | Change the transaction PIN |
| `PUT` | `/api/account/password` | Change the password (returns a fresh token) |
| `PATCH` | `/api/account/preferences` | Email notification preference |
| `GET` | `/api/account/limits` | Tier, limits and today's usage |
| `GET` `POST` | `/api/account/upgrade` | Tier 2 request status / send ID for review (multipart) |
| `GET` | `/api/account/support` | Support email for the Help link |
| `GET` | `/api/account/notifications` | In-app notifications + unread count |
| `POST` | `/api/account/notifications/read-all` | Mark all notifications read |
| `POST` | `/api/account/notifications/:id/read` | Mark one notification read |
| `POST` | `/api/assistant` | Ask the AI assistant a question (read-only; 30 a day) |
| `GET` | `/api/insights` | AI spending insights (refreshes in the background when stale) |
| `POST` | `/api/insights/refresh` | Regenerate insights now (5 a day) |
| `PATCH` | `/api/wallet/transactions/:id/category` | Set a transaction's spending category |
| `GET` | `/api/admin/overview` | Admin: totals and anything needing attention |
| `GET` | `/api/admin/users`, `/api/admin/users/:id` | Admin: search users, user detail |
| `POST` | `/api/admin/users/:id/freeze` `/unfreeze` `/unlock-pin` | Admin: account actions (reason required, audited) |
| `POST` | `/api/admin/users/:id/tier` | Admin: move a user to Tier 1 or Tier 2 (reason required, audited) |
| `GET` | `/api/admin/verifications` `/:id` `/:id/documents/:documentId` | Admin (`kyc.review`): ID check queue, detail and decrypted photos |
| `POST` | `/api/admin/verifications/:id/approve` `/reject` | Admin (`kyc.review`): approve (→ Tier 2) or reject with a reason |
| `GET` | `/api/admin/deposits`, `/api/admin/withdrawals` | Admin: payments, with a stuck filter |
| `POST` | `/api/admin/deposits/:ref/recheck`, `/api/admin/withdrawals/:ref/recheck` | Admin: re-check a payment with Paystack |
| `GET` | `/api/admin/paystack-events`, `/api/admin/paystack-events/:id` | Admin: webhook event log |
| `GET` | `/api/admin/reconciliation` | Admin: balance mismatches and Paystack balance |
| `POST` | `/api/admin/users/:id/adjustments` | Admin (Finance): credit or debit a balance |
| `GET` | `/api/admin/adjustments` | Admin: balance adjustments |
| `POST` | `/api/admin/adjustments/:id/approve` `/reject` | Admin (a second Finance/Owner): decide an adjustment |
| `GET` | `/api/admin/staff` | Admin: staff and roles |
| `PUT` | `/api/admin/users/:id/role` | Admin (Owner): grant, change or remove a staff role |
| `GET` | `/api/admin/ledger`, `/api/admin/ledger/entries` | Admin: ledger balances, trial balance and journal |
| `GET` | `/api/admin/audit-log` | Admin: every admin action |
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
- Password reset links are single-use and expire in 30 minutes; only their SHA-256 hash is stored, and the forgot-password response never reveals whether an email is registered
- New accounts must verify their email before any money moves (adding, sending, withdrawing, bank accounts → `403`); verification links are single-use, hashed and expire in 24 hours, and resends are limited to one every 2 minutes and 5 a day. Accounts that existed before verification was added count as verified
- ID documents never touch disk (uploads are held in memory, cleaned, then encrypted into Postgres), are checked by their contents rather than their names, and are never sent to the AI provider. Production refuses to start without `KYC_ENCRYPTION_KEY`; back it up, because losing or changing it makes stored documents unreadable. Before going live, decide how long approved ID records must be kept after an account closes (banks are usually required to keep them for years)
- Changing or resetting a password signs out every session issued before it
- Transfers and withdrawals need a **transaction PIN** (bcrypt-hashed; atomic attempt counting; 30-minute lockout after 5 wrong tries)
- Sign-ins from a new kind of device, and password changes, trigger a security alert
- JWTs signed with a secret (minimum 32 chars in production)
- Tokens blacklisted in Redis on logout (TTL matches token expiry)
- All webhook payloads signed with **HMAC-SHA256**; verify the `X-Webhook-Signature` header on receipt
- Helmet middleware sets security headers on every response
- CORS restricted to the origins in `CORS_ORIGINS` (defaults to `http://localhost:5173`)
- User objects returned by the API never include the password hash
- Rate limiting on auth (10), money-moving writes (60) and reads (300) per 15 minutes
- Admin access is checked against the database on every request (revoking it applies immediately); admins are granted only by a command-line script; every admin action needs a reason and is written to an audit log the database refuses to edit or delete

---

## 🚀 Deploying

[DEPLOYMENT.md](DEPLOYMENT.md) is a step-by-step guide to putting PurpleWallet online for free as a public demo: Netlify (web), Supabase (Postgres), Redis Cloud, Gmail (email) and Paystack test mode, plus demo accounts for visitors (`npm run seed:demo -w apps/api -- --showcase`).

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
| `ECONNREFUSED 6380` | Redis isn't running (locally it's on port 6380, not the default 6379) — start Docker Desktop, then run `npm run dev:api` again |
| `ECONNREFUSED 5432` | Postgres isn't running — same as above |
| `Cannot connect to the Docker daemon` on `npm run dev:api` | Docker Desktop isn't running — open it and try again |
| The app shows different data from what you expect, or `localhost:5432` isn't the Docker database | Another Postgres installed on your machine is also using port 5432. Stop it (Windows: `Stop-Service postgresql-x64-<version>` in an admin PowerShell, and set it to Manual) so the Docker database (Postgres 18) is the one on 5432 |
| Prisma type errors | Run `npm run db:generate` after any schema change |
| Port already in use | Change `PORT` in `apps/api/.env.development` |
