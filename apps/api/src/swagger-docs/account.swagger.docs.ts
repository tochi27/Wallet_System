/**
 * @swagger
 * tags:
 *   name: Account
 *   description: Password, transaction PIN, notification preferences and in-app notifications
 */

/**
 * @swagger
 * /api/account/pin:
 *   post:
 *     summary: Set the transaction PIN (first time)
 *     description: |
 *       A 4-digit PIN that `POST /api/wallet/transfer` and `POST /api/payments/withdrawals` require.
 *       Needs the account password. Repeated digits and straight runs (1111, 1234, 4321) are refused.
 *       Errors never use 401, so a wrong password or PIN doesn't sign the user out.
 *     tags: [Account]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [password, pin]
 *             properties:
 *               password:
 *                 type: string
 *               pin:
 *                 type: string
 *                 pattern: '^\d{4}$'
 *                 example: "7391"
 *     responses:
 *       200:
 *         description: Transaction PIN set
 *       400:
 *         description: Invalid or guessable PIN, or incorrect password
 *       409:
 *         description: A PIN already exists (use PUT to change it)
 *   put:
 *     summary: Change the transaction PIN
 *     description: Prove identity with the current PIN, or with the password if the PIN is forgotten (this also clears a lockout).
 *     tags: [Account]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [newPin]
 *             properties:
 *               currentPin:
 *                 type: string
 *               password:
 *                 type: string
 *               newPin:
 *                 type: string
 *                 pattern: '^\d{4}$'
 *     responses:
 *       200:
 *         description: Transaction PIN changed
 *       400:
 *         description: Missing proof, wrong current PIN or password, or invalid new PIN
 *       423:
 *         description: Locked after 5 wrong PINs (use the password instead, or wait 30 minutes)
 */

/**
 * @swagger
 * /api/account/password:
 *   put:
 *     summary: Change the password
 *     description: |
 *       Signs out every session, including the caller's token, and returns a fresh token so this
 *       session can continue. A wrong current password is 400, never 401, so it doesn't sign the
 *       user out. Shares the auth rate limit (10 per 15 minutes).
 *     tags: [Account]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [currentPassword, newPassword]
 *             properties:
 *               currentPassword:
 *                 type: string
 *               newPassword:
 *                 type: string
 *                 minLength: 8
 *     responses:
 *       200:
 *         description: Password changed
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: object
 *                   properties:
 *                     token:
 *                       type: string
 *                       description: Replace the stored token with this one
 *       400:
 *         description: Wrong current password, new password too short, or the same as the current one
 */

/**
 * @swagger
 * /api/account/preferences:
 *   patch:
 *     summary: Update preferences
 *     description: |
 *       Send either or both. `emailNotifications` turns emails about money movement on or off
 *       (security alerts are always emailed). `aiInsightsEnabled: true` records the user's consent
 *       and queues their first AI insights for `timezone`; `false` turns insights off and deletes
 *       the stored ones.
 *     tags: [Account]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               emailNotifications:
 *                 type: boolean
 *               aiInsightsEnabled:
 *                 type: boolean
 *               timezone:
 *                 type: string
 *                 example: Africa/Lagos
 *     responses:
 *       200:
 *         description: Preferences saved; returns the updated profile
 */

/**
 * @swagger
 * /api/account/notifications:
 *   get:
 *     summary: Recent in-app notifications
 *     description: |
 *       The 30 most recent notifications and the unread count. Types include money.received,
 *       money.sent, withdrawal.started|paid|failed and security.pin_set|pin_changed|pin_locked|new_device|password_changed.
 *     tags: [Account]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Notifications fetched successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: object
 *                   properties:
 *                     unreadCount:
 *                       type: integer
 *                     items:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           id:
 *                             type: string
 *                           type:
 *                             type: string
 *                             example: money.received
 *                           title:
 *                             type: string
 *                           body:
 *                             type: string
 *                           data:
 *                             type: object
 *                             nullable: true
 *                           readAt:
 *                             type: string
 *                             format: date-time
 *                             nullable: true
 *                           createdAt:
 *                             type: string
 *                             format: date-time
 */

/**
 * @swagger
 * /api/account/notifications/read-all:
 *   post:
 *     summary: Mark all notifications read
 *     tags: [Account]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: All notifications marked as read
 */

/**
 * @swagger
 * /api/account/notifications/{id}/read:
 *   post:
 *     summary: Mark one notification read
 *     tags: [Account]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Notification marked as read
 */

/**
 * @swagger
 * /api/wallet/transactions/{transactionId}:
 *   get:
 *     summary: Receipt for one transaction
 *     description: |
 *       The transaction plus context: the other party of a transfer (name only), the Paystack
 *       deposit or withdrawal behind it, and any reversal link.
 *     tags: [Wallet]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: transactionId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Transaction fetched successfully
 *       404:
 *         description: Not found, or not the caller's
 */

/**
 * @swagger
 * /api/wallet/statement:
 *   get:
 *     summary: Download an account statement (PDF or CSV)
 *     description: |
 *       Completed and reversed transactions for calendar days `from`..`to` in `timezone`, with
 *       opening and closing balances and a running balance per row. Up to one year and 5,000 rows.
 *       Sent as an attachment (`Content-Disposition`, exposed to the browser via CORS).
 *     tags: [Wallet]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: from
 *         required: true
 *         schema:
 *           type: string
 *           format: date
 *           example: "2026-10-01"
 *       - in: query
 *         name: to
 *         required: true
 *         schema:
 *           type: string
 *           format: date
 *           example: "2026-10-31"
 *       - in: query
 *         name: format
 *         schema:
 *           type: string
 *           enum: [pdf, csv]
 *           default: pdf
 *       - in: query
 *         name: timezone
 *         schema:
 *           type: string
 *           default: UTC
 *           example: Africa/Lagos
 *     responses:
 *       200:
 *         description: The statement file
 *         content:
 *           application/pdf: {}
 *           text/csv: {}
 *       400:
 *         description: Invalid dates or format, range over a year, or too many transactions
 */

/**
 * @swagger
 * /api/account/limits:
 *   get:
 *     summary: The user's tier, limits and how much of today's allowance is used
 *     description: |
 *       Tier 1 (every verified account): ₦50,000 per transfer or withdrawal, ₦200,000 a day, and a
 *       ₦500,000 wallet balance. Tier 2 (raised by staff): ₦500,000, ₦2,000,000 a day, no balance cap.
 *       The day runs midnight to midnight Nigerian time. Transfers and withdrawals over a limit, and
 *       deposits that would pass the cap, return 400 with a message saying how much is left. Money
 *       that has already been paid (a completed deposit, a transfer from someone else) is always credited.
 *     tags: [Account]
 *     responses:
 *       200:
 *         description: Limits and usage. Amounts are naira strings; `balance.max` and `balance.room` are null when there's no cap.
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               message: Limits fetched
 *               data:
 *                 tier: TIER_1
 *                 emailVerified: true
 *                 perTransaction: "50000.00"
 *                 daily: { limit: "200000.00", used: "25000.00", remaining: "175000.00", resetsAt: "2026-10-15T23:00:00.000Z" }
 *                 balance: { max: "500000.00", current: "450000.00", room: "50000.00" }
 *       401:
 *         description: Not signed in
 */
