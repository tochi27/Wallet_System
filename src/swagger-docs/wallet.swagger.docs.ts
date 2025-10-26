/**
 * @swagger
 * tags:
 *   name: Wallet
 *   description: Wallet management APIs
 */

/**
 * @swagger
 * /api/wallet/credit:
 *   post:
 *     summary: Credit user's wallet
 *     tags: [Wallet]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               amount:
 *                 type: number
 *                 example: 100
 *     responses:
 *       200:
 *         description: Wallet credited successfully
 *       500:
 *         description: Failed to credit wallet
 */

/**
 * @swagger
 * /api/wallet/debit:
 *   post:
 *     summary: Debit user's wallet
 *     tags: [Wallet]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               amount:
 *                 type: number
 *                 example: 50
 *     responses:
 *       200:
 *         description: Wallet debited successfully
 *       500:
 *         description: Failed to debit wallet
 */

/**
 * @swagger
 * /api/wallet/balance:
 *   get:
 *     summary: Get user's wallet balance
 *     tags: [Wallet]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Wallet balance fetched successfully
 *       500:
 *         description: Failed to fetch balance
 */

/**
 * @swagger
 * /api/wallet/transactions:
 *   get:
 *     summary: Get wallet transaction history
 *     tags: [Wallet]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Transaction history fetched successfully
 *       500:
 *         description: Failed to fetch transactions
 */
