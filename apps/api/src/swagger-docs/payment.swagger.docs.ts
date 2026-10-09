/**
 * @swagger
 * tags:
 *   name: Payments
 *   description: |
 *     Real money in and out through Paystack. The wallet is only credited after Paystack
 *     confirms a payment (verified server-side), and each payment is credited exactly once.
 */

/**
 * @swagger
 * components:
 *   schemas:
 *     Deposit:
 *       type: object
 *       properties:
 *         reference:
 *           type: string
 *           example: dep_b016ca74bd4fa991c23d1744
 *         amount:
 *           type: string
 *           example: "5000.00"
 *         currency:
 *           type: string
 *           example: NGN
 *         status:
 *           type: string
 *           enum: [PENDING, SUCCESSFUL, FAILED, ABANDONED]
 *         authorizationUrl:
 *           type: string
 *           nullable: true
 *           description: Paystack checkout page to send the user to
 *           example: https://checkout.paystack.com/5hym4lhg2xa54aw
 *         channel:
 *           type: string
 *           nullable: true
 *           example: card
 *         paidAt:
 *           type: string
 *           format: date-time
 *           nullable: true
 *         failureReason:
 *           type: string
 *           nullable: true
 *           example: Declined
 *         transactionId:
 *           type: string
 *           nullable: true
 *           description: The wallet credit created for this deposit, once successful
 *         createdAt:
 *           type: string
 *           format: date-time
 */

/**
 * @swagger
 * /api/payments/deposits:
 *   post:
 *     summary: Start a deposit through Paystack
 *     description: |
 *       Records a PENDING deposit and returns a Paystack checkout link (`authorizationUrl`).
 *       Send the user there; Paystack redirects back to `PAYSTACK_CALLBACK_URL` with
 *       `?reference=…`, after which `GET /api/payments/deposits/{reference}` reports the outcome.
 *       Nothing is credited until Paystack confirms the payment.
 *     tags: [Payments]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: header
 *         name: Idempotency-Key
 *         schema:
 *           type: string
 *         required: false
 *         description: Repeating a key returns the same deposit instead of starting a new one
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [amount]
 *             properties:
 *               amount:
 *                 type: number
 *                 minimum: 100
 *                 maximum: 10000000
 *                 description: Naira, up to 2 decimal places
 *                 example: 5000
 *     responses:
 *       200:
 *         description: Deposit started
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: Deposit started
 *                 data:
 *                   $ref: '#/components/schemas/Deposit'
 *       400:
 *         description: Invalid amount
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       401:
 *         description: Unauthorized
 *       502:
 *         description: Paystack rejected the request or could not be reached
 *       503:
 *         description: Payments are not configured (no PAYSTACK_SECRET_KEY)
 */

/**
 * @swagger
 * /api/payments/deposits/{reference}:
 *   get:
 *     summary: Get a deposit's status
 *     description: |
 *       While the deposit is PENDING, this first checks with Paystack, so the page the user
 *       returns to can show the result without waiting for the webhook. Safe to poll.
 *     tags: [Payments]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: reference
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Deposit fetched successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   $ref: '#/components/schemas/Deposit'
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: No deposit with that reference belongs to the caller
 */

/**
 * @swagger
 * /api/payments/paystack/webhook:
 *   post:
 *     summary: Paystack webhook receiver
 *     description: |
 *       Called by Paystack, not by clients. Requests must carry a valid `x-paystack-signature`
 *       (HMAC-SHA512 of the raw body with the Paystack secret key). Events are stored once,
 *       acknowledged immediately and processed on a queue; `charge.success` re-verifies the
 *       payment with Paystack before crediting.
 *     tags: [Payments]
 *     security: []
 *     parameters:
 *       - in: header
 *         name: x-paystack-signature
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               event:
 *                 type: string
 *                 example: charge.success
 *               data:
 *                 type: object
 *     responses:
 *       200:
 *         description: Event received
 *       401:
 *         description: Invalid signature
 *       500:
 *         description: Event could not be stored; Paystack will retry
 *       503:
 *         description: Payments are not configured
 */

/**
 * @swagger
 * components:
 *   schemas:
 *     BankAccount:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *           format: uuid
 *         bankCode:
 *           type: string
 *           example: "057"
 *         bankName:
 *           type: string
 *           example: Zenith Bank
 *         accountNumberLast4:
 *           type: string
 *           example: "6789"
 *         accountName:
 *           type: string
 *           description: Name returned by the bank lookup, never supplied by the client
 *           example: ADA LOVELACE
 *         createdAt:
 *           type: string
 *           format: date-time
 *     Withdrawal:
 *       type: object
 *       properties:
 *         reference:
 *           type: string
 *           example: wd_dad8413b9f0981f2afc4fd5b
 *         amount:
 *           type: string
 *           example: "1000.00"
 *         currency:
 *           type: string
 *           example: NGN
 *         status:
 *           type: string
 *           enum: [PROCESSING, SUCCESSFUL, FAILED, REVERSED]
 *           description: FAILED and REVERSED withdrawals have been refunded to the wallet
 *         failureReason:
 *           type: string
 *           nullable: true
 *         bankAccount:
 *           type: object
 *           properties:
 *             bankName:
 *               type: string
 *             accountNumberLast4:
 *               type: string
 *             accountName:
 *               type: string
 *         createdAt:
 *           type: string
 *           format: date-time
 *         completedAt:
 *           type: string
 *           format: date-time
 *           nullable: true
 */

/**
 * @swagger
 * /api/payments/banks:
 *   get:
 *     summary: Banks that can receive withdrawals
 *     description: Cached for a day. With a Paystack test key, "Paystack Test Bank" (code 001) is listed first.
 *     tags: [Payments]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Banks fetched successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       name:
 *                         type: string
 *                       code:
 *                         type: string
 */

/**
 * @swagger
 * /api/payments/bank-accounts/resolve:
 *   post:
 *     summary: Look up the name on a bank account
 *     description: Lets the user confirm the account holder before saving. Nothing is stored.
 *     tags: [Payments]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [bankCode, accountNumber]
 *             properties:
 *               bankCode:
 *                 type: string
 *                 example: "057"
 *               accountNumber:
 *                 type: string
 *                 pattern: '^\d{10}$'
 *                 example: "0123456789"
 *     responses:
 *       200:
 *         description: Account resolved
 *       400:
 *         description: Invalid input, or no such account at that bank
 *       429:
 *         description: Paystack lookup limit reached (test mode allows 3 real lookups a day)
 */

/**
 * @swagger
 * /api/payments/bank-accounts:
 *   post:
 *     summary: Save a payout bank account
 *     description: |
 *       Looks the account up again server-side and registers it with Paystack as a transfer
 *       recipient. Only the last 4 digits of the account number are stored. Up to 5 accounts.
 *     tags: [Payments]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [bankCode, accountNumber]
 *             properties:
 *               bankCode:
 *                 type: string
 *               accountNumber:
 *                 type: string
 *     responses:
 *       200:
 *         description: Bank account saved
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   $ref: '#/components/schemas/BankAccount'
 *       400:
 *         description: Invalid input, unknown account, or account limit reached
 *   get:
 *     summary: List saved bank accounts
 *     tags: [Payments]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Bank accounts fetched successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/BankAccount'
 */

/**
 * @swagger
 * /api/payments/bank-accounts/{id}:
 *   delete:
 *     summary: Remove a saved bank account
 *     description: Hidden from the user; kept internally because past withdrawals reference it.
 *     tags: [Payments]
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
 *         description: Bank account removed
 *       404:
 *         description: Not found or not owned by the caller
 */

/**
 * @swagger
 * /api/payments/withdrawals:
 *   post:
 *     summary: Withdraw to a saved bank account
 *     description: |
 *       Debits the wallet immediately (so the money can't be spent twice), then sends a Paystack
 *       transfer. Returns PROCESSING; the webhook, a follow-up check and periodic reconciliation
 *       settle it. If the transfer fails or is reversed, the debit is reversed and the money
 *       returned, exactly once.
 *     tags: [Payments]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: header
 *         name: Idempotency-Key
 *         schema:
 *           type: string
 *         required: false
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [bankAccountId, amount]
 *             properties:
 *               bankAccountId:
 *                 type: string
 *                 format: uuid
 *               amount:
 *                 type: number
 *                 minimum: 100
 *                 maximum: 5000000
 *                 example: 1000
 *     responses:
 *       200:
 *         description: Withdrawal started
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   $ref: '#/components/schemas/Withdrawal'
 *       400:
 *         description: Invalid input or insufficient funds
 *       404:
 *         description: Bank account not found
 *   get:
 *     summary: Recent withdrawals
 *     tags: [Payments]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Withdrawals fetched successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Withdrawal'
 */
