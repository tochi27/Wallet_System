# Wallet System — Frontend Integration Guide

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
| `401` | Missing, invalid, expired, or logged-out token — clear it and send the user to log in |
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

## Quick Start Checklist

- [ ] Sign up / log in → store JWT → fetch `/api/auth/me`
- [ ] Call `/health` to confirm the service is up
- [ ] Use `Authorization: Bearer <token>` on every request
- [ ] Generate a fresh UUID as `Idempotency-Key` for credit/debit calls
- [ ] Use `nextCursor` for paginating transaction history
- [ ] Clear the token and call `/api/auth/logout` on sign-out
