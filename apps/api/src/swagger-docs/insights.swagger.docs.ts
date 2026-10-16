/**
 * @swagger
 * tags:
 *   name: Insights
 *   description: |
 *     AI spending insights (opt-in). Every figure is calculated by PurpleWallet; Google Gemini only
 *     categorises spending and words the insights, and any insight quoting a figure we didn't
 *     calculate is dropped. People are pseudonymised ("Person A") before anything is sent. Without
 *     GEMINI_API_KEY, or when Gemini is unavailable, insights use template sentences instead.
 *
 * /api/insights:
 *   get:
 *     summary: The user's insights
 *     description: |
 *       Returns the stored insights. If they're from an earlier day (or are templates while the AI
 *       may be back), a background refresh is queued and `refreshing` is true; poll until it's false.
 *       `enabled` is false until the user opts in via `PATCH /api/account/preferences`.
 *     tags: [Insights]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: timezone
 *         description: IANA timezone; decides where "today" and each 30-day period start
 *         schema: { type: string, default: UTC, example: Africa/Lagos }
 *     responses:
 *       200:
 *         description: Insights fetched
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: object
 *                   properties:
 *                     enabled: { type: boolean }
 *                     refreshing: { type: boolean }
 *                     insight:
 *                       type: object
 *                       nullable: true
 *                       properties:
 *                         headline: { type: string, example: "You spent ₦381,000 in the last 30 days, up 54%." }
 *                         insights:
 *                           type: array
 *                           items:
 *                             type: object
 *                             properties:
 *                               kind: { type: string, enum: [spending, category, recipient, regular, unusual, tip] }
 *                               tone: { type: string, enum: [positive, neutral, attention] }
 *                               title: { type: string }
 *                               body: { type: string }
 *                               category: { type: string, nullable: true }
 *                         facts:
 *                           type: object
 *                           description: The calculated figures (totals, categories, top recipients, regular and unusual payments)
 *                         source: { type: string, enum: [AI, TEMPLATE] }
 *                         generatedAt: { type: string, format: date-time }
 *       400: { description: Invalid timezone }
 *
 * /api/insights/refresh:
 *   post:
 *     summary: Regenerate insights now
 *     description: Queues a refresh (up to 5 a day per user). Poll `GET /api/insights` until `refreshing` is false.
 *     tags: [Insights]
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               timezone: { type: string, example: Africa/Lagos }
 *     responses:
 *       202: { description: Refresh queued }
 *       403: { description: AI insights are off for this user }
 *       429: { description: Daily refresh limit reached }
 *
 * /api/wallet/transactions/{transactionId}/category:
 *   patch:
 *     summary: Set a spending category
 *     description: The user's choice always wins; AI categorising only fills transactions that have no category. Only money spent can be categorised (not money in, withdrawals to the user's own bank, or reversals).
 *     tags: [Insights]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: transactionId, required: true, schema: { type: string } }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [category]
 *             properties:
 *               category:
 *                 type: string
 *                 enum: [FOOD, BILLS, TRANSPORT, SHOPPING, ENTERTAINMENT, HEALTH, FAMILY_FRIENDS, SAVINGS, OTHER]
 *     responses:
 *       200: { description: Category saved }
 *       400: { description: Unknown category, or not a spend }
 *       404: { description: Not found, or not the caller's }
 */
