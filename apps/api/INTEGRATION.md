# PurpleWallet — Frontend Integration Guide

Base URL: `https://wallet-system-api-16cv.onrender.com`  
Swagger UI: `https://wallet-system-api-16cv.onrender.com/api-docs`

> **Note:** The API is hosted on Render's free tier. The first request after 15+ minutes of inactivity may take 30–60 seconds while the service cold-starts. Subsequent requests are fast.

---

## 1. Authentication

### Sign Up

```http
POST /api/auth/signup
Content-Type: application/json

{
  "name": "Jane Doe",
  "email": "jane@example.com",
  "password": "securePassword123"
}
```

**Response `200`**
```json
{
  "success": true,
  "message": "Signup successful",
  "data": {
    "user": {
      "id": "3f6c2a1e-8b4d-4f0a-9c1e-2d7b5a9e6f10",
      "name": "Jane Doe",
      "email": "jane@example.com",
      "createdAt": "2026-10-07T12:00:00.000Z"
    }
  }
}
```

Signup does not log the user in — call `/api/auth/login` next to get a token.

---

### Log In

```http
POST /api/auth/login
Content-Type: application/json

{
  "email": "jane@example.com",
  "password": "securePassword123"
}
```

**Response `200`**
```json
{
  "success": true,
  "message": "Login successful",
  "data": { "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..." }
}
```

Store the `token` — every subsequent request requires it. Tokens expire after 24 hours.

---

### Current User

```http
GET /api/auth/me
Authorization: Bearer <token>
```

**Response `200`** — `data.user` has the same shape as the signup response. Call this after login (and on app load, if a token is stored) to get the user's name and email.

---

### Log Out

```http
POST /api/auth/logout
Authorization: Bearer <token>
```

This blacklists the token immediately. Clear it from your app's state on success.

---

### Forgot Password

```http
POST /api/auth/forgot-password
Content-Type: application/json

{ "email": "jane@example.com" }
```

Always `200` with the same message, whether or not the email has an account. If it does, the user gets an email linking to `APP_URL/reset-password?token=…`. Read `token` from the query string and send it with the new password:

```http
POST /api/auth/reset-password
Content-Type: application/json

{ "token": "<from the link>", "password": "newSecurePassword456" }
```

The link works once and expires after 30 minutes (`400` otherwise). A reset signs out every existing session, so send the user to log in afterwards.

---

### Email Verification

Signup emails the user a link to `APP_URL/verify-email?token=…` (without `RESEND_API_KEY` in development, the link is printed in the API log). Until they follow it, `GET /api/auth/me` reports `"emailVerified": false` and every way of moving money (adding money, transfers, withdrawals, looking up and saving bank accounts) returns `403`, never `401`. Viewing the wallet and settings still works. Read `token` from the query string and send it, signed in or not:

```http
POST /api/auth/verify-email
Content-Type: application/json

{ "token": "<from the link>" }
```

`200` with `data.status` `verified`, or `already_verified` if the link was already used to verify. `400` if the link is invalid or expired (24 hours). A signed-in user can ask for a new link with `POST /api/auth/resend-verification`: `429` within 2 minutes of the last one or after 5 in a day, `409` if already verified.

---

### Limits and Tiers

Every verified account is on **Tier 1**. Users move to **Tier 2** by sending their ID for review (below); staff can also change a tier directly from the admin console. `GET /api/account/limits` returns the user's tier, limits and today's usage:

```json
{
  "tier": "TIER_1",
  "emailVerified": true,
  "perTransaction": "50000.00",
  "daily": { "limit": "200000.00", "used": "25000.00", "remaining": "175000.00", "resetsAt": "2026-10-15T23:00:00.000Z" },
  "balance": { "max": "500000.00", "current": "450000.00", "room": "50000.00" }
}
```

| | Per transfer or withdrawal | Sent + withdrawn per day | Wallet balance |
|---|---|---|---|
| Tier 1 | ₦50,000 | ₦200,000 | ₦500,000 |
| Tier 2 | ₦500,000 | ₦2,000,000 | No cap |

The day runs midnight to midnight Nigerian time. A transfer or withdrawal over a limit, or a deposit that would take the wallet past its cap, returns `400` with a message saying how much is left (show it as is). A withdrawal that fails and is refunded gives its allowance back. Money that has already been paid (a completed deposit, a transfer from someone else) is always credited, even past the cap.

#### Upgrading to Tier 2

`GET /api/account/upgrade` returns `{ tier, canApply, latest }`. Show an upgrade button when `canApply` is true (verified email, Tier 1, nothing pending), and `latest.rejection.label` / `.message` after a rejection. Send the ID as `multipart/form-data`:

| Field | |
|---|---|
| `legalName` | Full name as on the ID |
| `dateOfBirth` | `YYYY-MM-DD`, at least 18 years ago |
| `idType` | `NIN_SLIP`, `NATIONAL_ID`, `DRIVERS_LICENCE`, `PASSPORT` or `VOTERS_CARD` |
| `idNumber` | NIN: 11 digits · passport: a letter and 8 digits · VIN: 19 characters · licence: as printed (spaces and dashes are ignored) |
| `ID_FRONT` | Photo (JPEG/PNG) or PDF, up to 5 MB |
| `ID_BACK` | Required for `NATIONAL_ID`, `DRIVERS_LICENCE` and `VOTERS_CARD` |
| `SELFIE` | A photo of the user holding the ID (not a PDF) |

`201` when sent; `400` with a message to show for invalid details or files; `409` if already Tier 2 or a request is pending. The user gets a notification when staff approve (they move to Tier 2 straight away) or reject it.

---

### Change Password

```http
PUT /api/account/password
Authorization: Bearer <token>
Content-Type: application/json

{ "currentPassword": "securePassword123", "newPassword": "newSecurePassword456" }
```

Every session is signed out, including the one that made the request, and the response's `data.token` is a fresh token: replace the stored one with it. A wrong current password is `400`, not `401`.

---

### Transaction PIN (required for transfers and withdrawals)

Users set a 4-digit PIN once, with their password:

```http
POST /api/account/pin
Authorization: Bearer <token>
Content-Type: application/json

{ "password": "securePassword123", "pin": "7391" }
```

Every `POST /api/wallet/transfer` and `POST /api/payments/withdrawals` must then include `"pin": "7391"` in its body. Responses when the PIN is the problem (none of them 401, so they never sign the user out):

| Status | Meaning |
|:-------|:--------|
| `400` | Missing or wrong PIN ("Incorrect PIN. 4 attempts left.") |
| `403` | No PIN set yet — send the user to set one |
| `423` | Locked for 30 minutes after 5 wrong PINs |

**Frozen accounts.** An admin can put an account on hold. `GET /api/auth/me` then reports `"frozen": true`, and transfers, withdrawals and saving bank accounts return `403` (not `401`). The user can still sign in, view their wallet and receive money; show them a notice to contact support. `/me` also reports `role` (`USER` or `ADMIN`).

`GET /api/auth/me` reports `hasPin`. Change a PIN with `PUT /api/account/pin` and `{ "currentPin": "7391", "newPin": "…" }` (or `"password"` instead of `currentPin` if it's forgotten).

---

## 2. Making Authenticated Requests

Include the JWT in the `Authorization` header on every wallet request:

```js
const res = await fetch("https://wallet-system-api-16cv.onrender.com/api/wallet/balance", {
  headers: {
    "Authorization": `Bearer ${token}`,
    "Content-Type": "application/json",
  },
});
```

### CORS

Browsers can only call the API from origins listed in the server's `CORS_ORIGINS` env var (comma-separated). It defaults to `http://localhost:5173` for local Vite development; add your deployed frontend URL in production.

---

## 3. Wallet Operations

### Get Balance

```http
GET /api/wallet/balance
Authorization: Bearer <token>
```

**Response `200`**
```json
{
  "stored": "1500.00",
  "computed": "1500.00"
}
```

- `stored` — cached value (fast, updates within 60 seconds)
- `computed` — real-time sum recalculated from transactions

---

### Credit (Add Funds) — development only

> Direct credits, debits and reversals have no real payment behind them. They return **403** in production unless `DIRECT_FUNDING_ENABLED=true`. In production, add money with a Paystack deposit and take it out with a withdrawal (see above).

```http
POST /api/wallet/credit
Authorization: Bearer <token>
Content-Type: application/json
Idempotency-Key: <unique-uuid>

{
  "amount": 500,
  "description": "Top-up"
}
```

**Response `201`**
```json
{
  "id": "txn_abc123",
  "type": "CREDIT",
  "amount": "500.00",
  "description": "Top-up",
  "status": "SUCCESS",
  "createdAt": "2026-05-27T10:00:00.000Z"
}
```

---

### Debit (Spend Funds) — development only

```http
POST /api/wallet/debit
Authorization: Bearer <token>
Content-Type: application/json
Idempotency-Key: <unique-uuid>

{
  "amount": 200,
  "description": "Payment for order #99"
}
```

**Response `201`** — same shape as credit, `type` is `"DEBIT"`.

Returns `400` if balance is insufficient.

---

### Transfer to Another User

```http
POST /api/wallet/transfer
Authorization: Bearer <token>
Content-Type: application/json

{
  "toUserId": "clx1xyz789",
  "amount": 100,
  "description": "Split dinner"
}
```

**Response `201`**
```json
{
  "debit": { "id": "txn_...", "type": "TRANSFER_OUT", "amount": "100.00", ... },
  "credit": { "id": "txn_...", "type": "TRANSFER_IN", "amount": "100.00", ... }
}
```

---

### Transaction History (Paginated)

```http
GET /api/wallet/transactions?limit=20
Authorization: Bearer <token>
```

**With cursor (for next page):**
```http
GET /api/wallet/transactions?limit=20&cursor=txn_abc123
```

**Response `200`**
```json
{
  "data": [
    {
      "id": "txn_abc123",
      "type": "CREDIT",
      "amount": "500.00",
      "description": "Top-up",
      "status": "SUCCESS",
      "createdAt": "2026-05-27T10:00:00.000Z"
    }
  ],
  "nextCursor": "txn_xyz456"
}
```

Use `nextCursor` as the `cursor` param on the next request. When `nextCursor` is `null`, you've reached the end.

---

### Add Money (Paystack Deposit)

Money comes in through Paystack. Amounts are in naira (NGN), minimum ₦100.

```http
POST /api/payments/deposits
Authorization: Bearer <token>
Idempotency-Key: <uuid>
Content-Type: application/json

{ "amount": 5000 }
```

The response's `data.authorizationUrl` is Paystack's checkout page — send the user there. After paying, Paystack redirects them to the server's `PAYSTACK_CALLBACK_URL` with `?reference=dep_…`. Poll:

```http
GET /api/payments/deposits/{reference}
Authorization: Bearer <token>
```

until `status` is `SUCCESSFUL` or `FAILED` (each call checks with Paystack while the deposit is `PENDING`). The wallet is credited only after the server verifies the payment with Paystack, and only once — the redirect, webhook and retries can't double-credit.

---

### Withdraw to a Bank Account (Paystack Transfer)

1. `GET /api/payments/banks` — banks that accept transfers (`{ name, code }`).
2. `POST /api/payments/bank-accounts/resolve` with `{ "bankCode": "057", "accountNumber": "0123456789" }` — returns the account holder's name for the user to confirm.
3. `POST /api/payments/bank-accounts` with the same body — saves it (the server looks the name up again; it never trusts the client).
4. `POST /api/payments/withdrawals` with `{ "bankAccountId": "<id>", "amount": 1000 }` and an `Idempotency-Key`.

The wallet is debited immediately and the withdrawal starts as `PROCESSING`. It becomes `SUCCESSFUL`, or `FAILED` / `REVERSED` — in which case the debit shows as `REVERSED` and a linked "Refund" credit returns the money. `GET /api/payments/withdrawals` lists recent withdrawals with their status.

Withdrawal debits and deposit credits can't be reversed through `/api/wallet/transactions/:id/reverse`; Paystack's outcome settles them.

---

### Stats (Totals and Daily Series)

```http
GET /api/wallet/stats?days=30&timezone=Africa/Lagos
Authorization: Bearer <token>
```

Returns totals for the last `days` calendar days (`current`) and the `days` before that (`previous`), the balance change over the current period, and a `daily` series (2 × `days` entries, oldest first) of `moneyIn` / `moneyOut`. Pass the user's IANA timezone (`Intl.DateTimeFormat().resolvedOptions().timeZone`) so "today" matches their calendar.

```json
{
  "success": true,
  "data": {
    "days": 30,
    "current": { "from": "2026-09-09", "to": "2026-10-08", "moneyIn": "1512.00", "moneyOut": "97.53", "sent": "25.00", "received": "0.00", "net": "1414.47" },
    "previous": { "...": "same shape" },
    "balance": { "current": "25052.00", "atPeriodStart": "23637.53", "change": "1414.47", "changePercent": 5.98 },
    "daily": [{ "date": "2026-08-10", "moneyIn": "0.00", "moneyOut": "0.00" }]
  }
}
```

`changePercent` is `null` when the balance at the start of the period was zero.

---

### Reverse a Transaction — development only

```http
POST /api/wallet/transactions/:transactionId/reverse
Authorization: Bearer <token>
```

Reverses any successful transaction. For transfers, both legs (debit + credit) are unwound atomically.

---

## 4. Idempotency Keys

Credit and debit endpoints accept an optional `Idempotency-Key` header. Use a UUID generated on the client side.

If the same key is sent twice within 24 hours, the API returns the original response instead of creating a duplicate transaction — safe to retry on network failure.

```js
import { v4 as uuidv4 } from "uuid";

const res = await fetch(".../api/wallet/credit", {
  method: "POST",
  headers: {
    "Authorization": `Bearer ${token}`,
    "Content-Type": "application/json",
    "Idempotency-Key": uuidv4(),   // generate once per operation
  },
  body: JSON.stringify({ amount: 500 }),
});
```

---

## 5. Error Responses

All errors follow this shape:

```json
{
  "success": false,
  "message": "Insufficient funds"
}
```

| Status | Meaning |
|:-------|:--------|
| `400` | Bad request (validation error, insufficient balance) |
| `401` | Missing, invalid, expired, or logged-out token, or one issued before a password change — clear it and send the user to log in |
| `404` | Resource not found |
| `409` | Conflict (e.g. duplicate operation) |
| `429` | Rate limited — slow down requests |
| `500` | Server error |

---

## 6. Health Check

```http
GET /health
```

No auth required. Returns `200` when Postgres and Redis are reachable, `503` when degraded. Useful for showing a status indicator in your UI.

```json
{
  "status": "ok",
  "uptime": 3600.5,
  "services": {
    "database": "ok",
    "redis": "ok"
  }
}
```

---

## 7. Webhooks (Optional)

If you want your backend to receive real-time notifications when wallet events occur:

**Register a webhook:**
```http
POST /api/webhooks
Authorization: Bearer <token>
Content-Type: application/json

{
  "url": "https://your-app.com/webhooks/wallet",
  "events": ["transaction.created", "transaction.reversed"]
}
```

Payloads are signed with HMAC-SHA256. Verify the `X-Webhook-Signature` header on receipt to confirm authenticity.

---

## AI Spending Insights (opt-in)

1. Ask the user first, then opt in: `PATCH /api/account/preferences` with `{ "aiInsightsEnabled": true, "timezone": "Africa/Lagos" }`. `GET /api/auth/me` reports `aiInsightsEnabled`.
2. `GET /api/insights?timezone=Africa/Lagos` returns `{ enabled, refreshing, insight }`. While `refreshing` is true, poll every few seconds; the first insights take a few seconds to appear.
3. `POST /api/insights/refresh` regenerates on demand (5 a day; `429` after that).
4. Transactions carry `category` (`FOOD`, `BILLS`, `TRANSPORT`, `SHOPPING`, `ENTERTAINMENT`, `HEALTH`, `FAMILY_FRIENDS`, `SAVINGS`, `OTHER` or `null`) and `categorySource` (`AI` or `USER`). Let users correct it with `PATCH /api/wallet/transactions/:id/category` and `{ "category": "FOOD" }`; their choice is never overwritten.

Opting out (`"aiInsightsEnabled": false`) deletes the stored insights. The same switch ("AI features") also enables the assistant.

### AI Assistant

```http
POST /api/assistant
Authorization: Bearer <token>
Content-Type: application/json

{ "message": "How much did I spend on food this month?", "history": [], "timezone": "Africa/Lagos" }
```

Keep the conversation on the client and send the recent turns as `history` (`{ role: "user" | "assistant", text }`). The response has `answer`, `transactions` (show them as evidence, each linking to its receipt), and an optional `action`: `send_money` (pre-fill your Send form with `recipientEmail` and `amount`) or `withdraw` (pre-fill the amount). Never act on it automatically; the user confirms with their PIN as usual. Errors: `403` AI features off, `429` 30 questions a day used, `503` AI unavailable.

---

## Receipts, Statements and Notifications

- `GET /api/wallet/transactions/:id` — one transaction with context (the other party's name for transfers, the Paystack deposit or withdrawal behind it, reversal links).
- `GET /api/wallet/statement?from=2026-10-01&to=2026-10-31&format=pdf&timezone=Africa/Lagos` — a downloadable statement (`pdf` or `csv`), up to one year. The filename is in `Content-Disposition`.
- `GET /api/account/notifications` — the latest 30 notifications and `unreadCount`; mark them read with `POST /api/account/notifications/read-all` or `/:id/read`.

---

## Quick Start Checklist

- [ ] Sign up / log in → store JWT → fetch `/api/auth/me`
- [ ] Call `/health` to confirm the service is up
- [ ] Use `Authorization: Bearer <token>` on every request
- [ ] Generate a fresh UUID as `Idempotency-Key` for credit/debit calls
- [ ] Use `nextCursor` for paginating transaction history
- [ ] Clear the token and call `/api/auth/logout` on sign-out
