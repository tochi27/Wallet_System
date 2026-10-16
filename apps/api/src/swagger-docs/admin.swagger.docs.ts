/**
 * @swagger
 * tags:
 *   name: Admin
 *   description: |
 *     Operations tools for admins: users, payments, Paystack events, reconciliation and the audit
 *     log, balance adjustments, the ledger and staff roles. Every route needs a staff role (VIEWER,
 *     SUPPORT, FINANCE or OWNER, read fresh on each request); actions need specific roles, and
 *     others get 403. Admins are made with `npm run admin:grant -- <email> "<reason>"`, never through the
 *     API; grants and revocations are audited with a null admin and the machine account in `details`.
 *     Only balance adjustments move money, through the ledger and with a second admin above 10,000 naira.
 *
 * components:
 *   parameters:
 *     AdminLimit:
 *       in: query
 *       name: limit
 *       schema: { type: integer, minimum: 1, maximum: 100, default: 25 }
 *     AdminCursor:
 *       in: query
 *       name: cursor
 *       description: The `nextCursor` from the previous page
 *       schema: { type: string }
 *     AdminSearch:
 *       in: query
 *       name: search
 *       schema: { type: string }
 *   schemas:
 *     AdminReason:
 *       type: object
 *       required: [reason]
 *       properties:
 *         reason:
 *           type: string
 *           minLength: 3
 *           maxLength: 500
 *           description: Recorded permanently in the audit log. Not shown to the user.
 *           example: Customer confirmed identity by phone
 *     RecheckResult:
 *       type: object
 *       properties:
 *         reference: { type: string }
 *         before: { type: string, example: PENDING }
 *         after: { type: string, example: SUCCESSFUL }
 */

/**
 * @swagger
 * /api/admin/overview:
 *   get:
 *     summary: Totals and anything needing attention
 *     description: User counts, total held in wallets, successful deposits and withdrawals in the last 24 hours, and counts of stuck payments (over 30 minutes), unprocessed Paystack events and balance mismatches.
 *     tags: [Admin]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Overview fetched }
 *       403: { description: Not an admin }
 *
 * /api/admin/users:
 *   get:
 *     summary: Search users by name, email or ID
 *     tags: [Admin]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - $ref: '#/components/parameters/AdminSearch'
 *       - $ref: '#/components/parameters/AdminLimit'
 *       - $ref: '#/components/parameters/AdminCursor'
 *     responses:
 *       200: { description: "`{ items, nextCursor }`" }
 *
 * /api/admin/users/{id}:
 *   get:
 *     summary: One user in detail
 *     description: Profile, balance with a ledger check, PIN and freeze state, recent transactions, deposits, withdrawals, saved banks (last 4 digits), devices and admin history. Never password or PIN hashes.
 *     tags: [Admin]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     responses:
 *       200: { description: User fetched }
 *       404: { description: User not found }
 *
 * /api/admin/users/{id}/freeze:
 *   post:
 *     summary: Freeze an account
 *     description: The user can still sign in, see their wallet and receive money, but transfers, withdrawals and saving bank accounts return 403. They're notified (without the reason). Admins can't freeze themselves or other admins.
 *     tags: [Admin]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     requestBody:
 *       required: true
 *       content: { application/json: { schema: { $ref: '#/components/schemas/AdminReason' } } }
 *     responses:
 *       200: { description: Account frozen; returns the updated user }
 *       400: { description: Missing reason, own account, or an admin }
 *       409: { description: Already frozen }
 *
 * /api/admin/users/{id}/unfreeze:
 *   post:
 *     summary: Lift a freeze
 *     tags: [Admin]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     requestBody:
 *       required: true
 *       content: { application/json: { schema: { $ref: '#/components/schemas/AdminReason' } } }
 *     responses:
 *       200: { description: Account unfrozen; returns the updated user }
 *       409: { description: Not frozen }
 *
 * /api/admin/users/{id}/unlock-pin:
 *   post:
 *     summary: Clear a transaction PIN lockout
 *     tags: [Admin]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     requestBody:
 *       required: true
 *       content: { application/json: { schema: { $ref: '#/components/schemas/AdminReason' } } }
 *     responses:
 *       200: { description: PIN unlocked; returns the updated user }
 *       409: { description: PIN isn't locked }
 *
 * /api/admin/users/{id}/tier:
 *   post:
 *     summary: Move a user to another tier (changes their limits)
 *     description: |
 *       Needs `users.manage` (SUPPORT and above). Not on your own account. Audited with the old and
 *       new tier; the user is told their new limits. Limits per tier are in `src/config/limits.ts`.
 *     tags: [Admin]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [tier, reason]
 *             properties:
 *               tier: { type: string, enum: [TIER_1, TIER_2] }
 *               reason: { type: string, minLength: 3, maxLength: 500 }
 *     responses:
 *       200: { description: Tier changed; returns the updated user }
 *       400: { description: Invalid tier, missing reason, or your own account }
 *       409: { description: Already on that tier }
 *
 * /api/admin/deposits:
 *   get:
 *     summary: Deposits across all users
 *     tags: [Admin]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: status, schema: { type: string, enum: [PENDING, SUCCESSFUL, FAILED, ABANDONED] } }
 *       - { in: query, name: stuck, description: Pending for over 30 minutes, schema: { type: boolean } }
 *       - $ref: '#/components/parameters/AdminSearch'
 *       - $ref: '#/components/parameters/AdminLimit'
 *       - $ref: '#/components/parameters/AdminCursor'
 *     responses:
 *       200: { description: "`{ items, nextCursor }`" }
 *
 * /api/admin/deposits/{reference}/recheck:
 *   post:
 *     summary: Ask Paystack for a deposit's latest status
 *     description: Settles through the same exactly-once code as the webhook, so it's safe to repeat. Audited.
 *     tags: [Admin]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: reference, required: true, schema: { type: string } }
 *     responses:
 *       200:
 *         description: Rechecked
 *         content: { application/json: { schema: { $ref: '#/components/schemas/RecheckResult' } } }
 *       404: { description: Deposit not found }
 *       502: { description: Paystack error }
 *
 * /api/admin/withdrawals:
 *   get:
 *     summary: Withdrawals across all users
 *     tags: [Admin]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: status, schema: { type: string, enum: [PROCESSING, SUCCESSFUL, FAILED, REVERSED] } }
 *       - { in: query, name: stuck, description: Processing for over 30 minutes, schema: { type: boolean } }
 *       - $ref: '#/components/parameters/AdminSearch'
 *       - $ref: '#/components/parameters/AdminLimit'
 *       - $ref: '#/components/parameters/AdminCursor'
 *     responses:
 *       200: { description: "`{ items, nextCursor }`" }
 *
 * /api/admin/withdrawals/{reference}/recheck:
 *   post:
 *     summary: Ask Paystack for a withdrawal's latest status
 *     description: A failed or reversed transfer is refunded exactly once. Audited.
 *     tags: [Admin]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: reference, required: true, schema: { type: string } }
 *     responses:
 *       200:
 *         description: Rechecked
 *         content: { application/json: { schema: { $ref: '#/components/schemas/RecheckResult' } } }
 *       404: { description: Withdrawal not found }
 *       502: { description: Paystack error }
 *
 * /api/admin/paystack-events:
 *   get:
 *     summary: Paystack webhook events received
 *     tags: [Admin]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: processed, schema: { type: boolean } }
 *       - { in: query, name: event, schema: { type: string, example: charge.success } }
 *       - $ref: '#/components/parameters/AdminSearch'
 *       - $ref: '#/components/parameters/AdminLimit'
 *       - $ref: '#/components/parameters/AdminCursor'
 *     responses:
 *       200: { description: "`{ items, nextCursor }` (without payloads)" }
 *
 * /api/admin/paystack-events/{id}:
 *   get:
 *     summary: One Paystack event with its full payload
 *     tags: [Admin]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     responses:
 *       200: { description: Event fetched }
 *       404: { description: Event not found }
 *
 * /api/admin/reconciliation:
 *   get:
 *     summary: Balance checks
 *     description: Wallets whose stored balance differs from the sum of their completed transactions, the total held in wallets, and the Paystack balance for comparison.
 *     tags: [Admin]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Reconciliation fetched }
 *
 * /api/admin/audit-log:
 *   get:
 *     summary: Every admin action, newest first
 *     description: Append-only. A database trigger rejects any UPDATE or DELETE on the table.
 *     tags: [Admin]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - $ref: '#/components/parameters/AdminLimit'
 *       - $ref: '#/components/parameters/AdminCursor'
 *     responses:
 *       200: { description: "`{ items, nextCursor }`" }
 */
