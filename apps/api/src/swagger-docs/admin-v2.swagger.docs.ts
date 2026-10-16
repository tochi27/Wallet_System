/**
 * @swagger
 * /api/admin/users/{id}/adjustments:
 *   post:
 *     summary: Adjust a user's balance (Finance or Owner)
 *     description: |
 *       Credits (refund, goodwill, correction) or debits (correction only) a wallet. Up to ₦10,000 it
 *       applies at once (200); above that it waits for a different admin's approval (202). Debits
 *       can't take a wallet below zero. Needs the admin's password. Recorded in the ledger (against
 *       the Adjustments account), the user's history and the audit log; the user is notified but
 *       never sees the internal reason.
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
 *             required: [direction, kind, amount, reason, password]
 *             properties:
 *               direction: { type: string, enum: [CREDIT, DEBIT] }
 *               kind: { type: string, enum: [REFUND, GOODWILL, CORRECTION] }
 *               amount: { type: number, example: 2500 }
 *               reason: { type: string, example: "Duplicate card charge on 3 Oct" }
 *               password: { type: string, description: "The admin's own password" }
 *     responses:
 *       200: { description: Applied }
 *       202: { description: Waiting for a second admin }
 *       400: { description: "Wrong password, own account, invalid amount, or a debit that isn't a correction" }
 *       403: { description: "Role can't adjust balances" }
 *       409: { description: Would take the wallet below zero }
 *
 * /api/admin/adjustments:
 *   get:
 *     summary: Balance adjustments
 *     tags: [Admin]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: status, schema: { type: string, enum: [PENDING, APPROVED, REJECTED] } }
 *       - { in: query, name: userId, schema: { type: string } }
 *       - $ref: '#/components/parameters/AdminLimit'
 *       - $ref: '#/components/parameters/AdminCursor'
 *     responses:
 *       200: { description: "`{ items, nextCursor }`" }
 *
 * /api/admin/adjustments/{id}/approve:
 *   post:
 *     summary: Approve a pending adjustment (a different Finance or Owner admin)
 *     description: "The requester can approve their own only in solo mode: when no other active Finance or Owner admin exists. It's then recorded as self-approved (soloApproval in the audit log)."

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
 *             required: [password]
 *             properties:
 *               password: { type: string }
 *               note: { type: string }
 *     responses:
 *       200: { description: Approved and applied }
 *       403: { description: "The requester can't approve their own adjustment while another admin could" }
 *       409: { description: Already decided, or would take the wallet below zero }
 *
 * /api/admin/adjustments/{id}/reject:
 *   post:
 *     summary: Reject a pending adjustment
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
 *             required: [password, reason]
 *             properties:
 *               password: { type: string }
 *               reason: { type: string }
 *     responses:
 *       200: { description: Rejected }
 *       409: { description: Not pending }
 *
 * /api/admin/staff:
 *   get:
 *     summary: Staff members and their roles
 *     tags: [Admin]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Staff fetched }
 *
 * /api/admin/users/{id}/role:
 *   put:
 *     summary: Grant, change or remove a staff role (Owner)
 *     description: "USER removes staff access. Owners can't change their own role, and the last owner can't be demoted. Needs the owner's password; audited."
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
 *             required: [role, reason, password]
 *             properties:
 *               role: { type: string, enum: [USER, VIEWER, SUPPORT, FINANCE, OWNER] }
 *               reason: { type: string }
 *               password: { type: string }
 *     responses:
 *       200: { description: Role updated }
 *       400: { description: "Wrong password, own role, or a frozen account" }
 *       403: { description: Not an owner }
 *       409: { description: Same role, or it would remove the last owner }
 *
 * /api/admin/ledger:
 *   get:
 *     summary: Ledger summary
 *     description: "System account balances (assets shown positive when held, liabilities when owed), the total owed to all user wallets, and the trial balance: the sum of every line, which the database keeps at zero."
 *     tags: [Admin]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Ledger fetched }
 *
 * /api/admin/ledger/entries:
 *   get:
 *     summary: Journal entries with their debit and credit lines
 *     tags: [Admin]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: type, schema: { type: string, enum: [OPENING_BALANCE, DEPOSIT, TRANSFER, WITHDRAWAL, WITHDRAWAL_PAID, WITHDRAWAL_REFUND, REVERSAL, ADJUSTMENT, DIRECT_FUNDING] } }
 *       - { in: query, name: userId, schema: { type: string } }
 *       - $ref: '#/components/parameters/AdminLimit'
 *       - $ref: '#/components/parameters/AdminCursor'
 *     responses:
 *       200: { description: "`{ items, nextCursor }`" }
 */
