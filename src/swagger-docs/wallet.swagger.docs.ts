/**
 * @swagger
 * tags:
 *   name: Wallet
 *   description: Wallet operations — credit, debit, transfer, reverse, and history
 */

/**
 * @swagger
 * /api/wallet/credit:
 *   post:
 *     summary: Credit the authenticated user's wallet
 *     description: |
 *       Adds funds to the wallet. Supports idempotency via the `Idempotency-Key` header —
 *       duplicate requests with the same key return the original response without
 *       re-crediting the wallet.
 *     tags: [Wallet]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: header
 *         name: Idempotency-Key
 *         schema:
 *           type: string
 *         required: false
 *         description: Unique key to make this request idempotent (24-hour TTL)
 *         example: a1b2c3d4-e5f6-7890-abcd-ef1234567890
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - amount
 *             properties:
 *               amount:
 *                 type: number
 *                 minimum: 0.01
 *                 example: 100
 *               description:
 *                 type: string
 *                 maxLength: 255
 *                 example: Salary deposit
 *     responses:
 *       200:
 *         description: Wallet credited successfully
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
 *                   example: Wallet credited successfully
 *                 data:
 *                   $ref: '#/components/schemas/Transaction'
 *       400:
 *         description: Validation error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       401:
 *         description: Unauthorized — missing or invalid token
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */

/**
 * @swagger
 * /api/wallet/debit:
 *   post:
 *     summary: Debit the authenticated user's wallet
 *     description: |
 *       Deducts funds from the wallet. Supports idempotency via the `Idempotency-Key` header —
 *       duplicate requests with the same key return the original response without
 *       re-debiting the wallet.
 *     tags: [Wallet]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: header
 *         name: Idempotency-Key
 *         schema:
 *           type: string
 *         required: false
 *         description: Unique key to make this request idempotent (24-hour TTL)
 *         example: b2c3d4e5-f6a7-8901-bcde-f01234567891
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - amount
 *             properties:
 *               amount:
 *                 type: number
 *                 minimum: 0.01
 *                 example: 50
 *               description:
 *                 type: string
 *                 maxLength: 255
 *                 example: Monthly subscription
 *     responses:
 *       200:
 *         description: Wallet debited successfully
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
 *                   example: Wallet debited successfully
 *                 data:
 *                   $ref: '#/components/schemas/Transaction'
 *       400:
 *         description: Validation error or insufficient funds
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             examples:
 *               insufficientFunds:
 *                 summary: Balance too low
 *                 value:
 *                   success: false
 *                   message: Insufficient funds
 *               validation:
 *                 summary: Invalid amount
 *                 value:
 *                   success: false
 *                   message: Amount must be greater than zero
 *       401:
 *         description: Unauthorized
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */

/**
 * @swagger
 * /api/wallet/transfer:
 *   post:
 *     summary: Transfer funds to another user
 *     description: |
 *       Atomically debits the sender and credits the receiver using distributed locks.
 *       Supports idempotency via the `Idempotency-Key` header — duplicate requests with
 *       the same key return the original response without re-executing the transfer.
 *     tags: [Wallet]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: header
 *         name: Idempotency-Key
 *         schema:
 *           type: string
 *         required: false
 *         description: Unique key to make this request idempotent (24-hour TTL)
 *         example: a1b2c3d4-e5f6-7890-abcd-ef1234567890
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - receiverEmail
 *               - amount
 *             properties:
 *               receiverEmail:
 *                 type: string
 *                 format: email
 *                 example: receiver@example.com
 *               amount:
 *                 type: number
 *                 minimum: 0.01
 *                 example: 250
 *               description:
 *                 type: string
 *                 maxLength: 255
 *                 example: Rent payment
 *     responses:
 *       200:
 *         description: Transfer successful
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
 *                   example: Transfer successful
 *                 data:
 *                   type: object
 *                   properties:
 *                     transferId:
 *                       type: string
 *                       format: uuid
 *                       example: 7f4a2b8c-1d3e-4f5a-9b6c-2d0e1f3a4b5c
 *                     sender:
 *                       $ref: '#/components/schemas/Transaction'
 *                     receiver:
 *                       $ref: '#/components/schemas/Transaction'
 *       400:
 *         description: Validation error, insufficient funds, or business rule violation
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             examples:
 *               insufficientFunds:
 *                 value:
 *                   success: false
 *                   message: Insufficient funds
 *               receiverNotFound:
 *                 value:
 *                   success: false
 *                   message: Receiver not found
 *               selfTransfer:
 *                 value:
 *                   success: false
 *                   message: Cannot transfer to yourself
 *       401:
 *         description: Unauthorized
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */

/**
 * @swagger
 * /api/wallet/transactions/{transactionId}/reverse:
 *   post:
 *     summary: Reverse a transaction
 *     description: |
 *       Reverses a SUCCESSFUL transaction. For transfers, both the sender's and
 *       receiver's legs are reversed atomically. A transaction can only be reversed once.
 *     tags: [Wallet]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: transactionId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: ID of the transaction to reverse
 *         example: 550e8400-e29b-41d4-a716-446655440000
 *     responses:
 *       200:
 *         description: Transaction reversed successfully
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
 *                   example: Transaction reversed successfully
 *                 data:
 *                   $ref: '#/components/schemas/Transaction'
 *       400:
 *         description: Business rule violation
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             examples:
 *               cannotReverseReversal:
 *                 value:
 *                   success: false
 *                   message: Cannot reverse a reversal
 *               insufficientFunds:
 *                 value:
 *                   success: false
 *                   message: Insufficient funds to reverse this transaction
 *       401:
 *         description: Unauthorized
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       404:
 *         description: Transaction not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             example:
 *               success: false
 *               message: Transaction not found
 *       409:
 *         description: Transaction has already been reversed
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             example:
 *               success: false
 *               message: Transaction has already been reversed
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */

/**
 * @swagger
 * /api/wallet/balance:
 *   get:
 *     summary: Get the authenticated user's wallet balance
 *     description: |
 *       Returns both the stored wallet balance and a computed balance derived from
 *       the sum of all successful CREDIT and DEBIT transactions.
 *     tags: [Wallet]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Wallet balance fetched successfully
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
 *                   example: Wallet balance fetched successfully
 *                 data:
 *                   type: object
 *                   properties:
 *                     balance:
 *                       type: string
 *                       description: Stored wallet balance
 *                       example: "1250.00"
 *                     computed:
 *                       type: string
 *                       description: Balance recomputed from transaction history
 *                       example: "1250.00"
 *       401:
 *         description: Unauthorized
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */

/**
 * @swagger
 * /api/wallet/transactions:
 *   get:
 *     summary: Get the authenticated user's transaction history
 *     description: |
 *       Returns a cursor-paginated list of transactions, newest first.
 *       Pass the `nextCursor` from one response as the `cursor` query param of the
 *       next request to advance through pages. A `null` `nextCursor` means you have
 *       reached the last page. Cursors are opaque — do not construct them manually.
 *     tags: [Wallet]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 100
 *           default: 20
 *         required: false
 *         description: Number of transactions to return per page
 *       - in: query
 *         name: cursor
 *         schema:
 *           type: string
 *         required: false
 *         description: Opaque cursor from the previous page's `nextCursor` field
 *     responses:
 *       200:
 *         description: Transaction history fetched successfully
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
 *                   example: Transaction history fetched successfully
 *                 data:
 *                   type: object
 *                   properties:
 *                     items:
 *                       type: array
 *                       items:
 *                         $ref: '#/components/schemas/Transaction'
 *                     nextCursor:
 *                       type: string
 *                       nullable: true
 *                       description: Pass as `cursor` to fetch the next page; null when no more pages remain
 *                       example: 550e8400-e29b-41d4-a716-446655440000
 *       400:
 *         description: Invalid query parameters
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       401:
 *         description: Unauthorized
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
