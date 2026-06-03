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

**Response `201`**
```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": "clx1abc123",
    "name": "Jane Doe",
    "email": "jane@example.com"
  }
}
```

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

**Response `200`** — same shape as signup.

Store the `token` — every subsequent request requires it.

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

### Credit (Add Funds)

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

### Debit (Spend Funds)

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

### Reverse a Transaction

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
  "error": "Insufficient balance"
}
```

| Status | Meaning |
|:-------|:--------|
| `400` | Bad request (validation error, insufficient balance) |
| `401` | Missing or invalid/expired token |
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

- [ ] Sign up / log in → store JWT
- [ ] Call `/health` to confirm the service is up
- [ ] Use `Authorization: Bearer <token>` on every request
- [ ] Generate a fresh UUID as `Idempotency-Key` for credit/debit calls
- [ ] Use `nextCursor` for paginating transaction history
- [ ] Clear the token and call `/api/auth/logout` on sign-out
