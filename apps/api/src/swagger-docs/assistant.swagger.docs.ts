/**
 * @swagger
 * tags:
 *   name: Assistant
 *   description: |
 *     "Ask PurpleWallet": an AI assistant (Google Gemini) that answers questions about the user's own
 *     wallet using read-only tools. It cannot move money or change anything; for "send ₦5,000 to
 *     Grace" it returns an action for the app to pre-fill, which the user confirms with their PIN.
 *     Needs AI features turned on (`aiInsightsEnabled`). People are pseudonymised before anything
 *     reaches Gemini, and every ₦ amount or % in an answer must have come from a tool that turn.
 *     Nothing is stored server-side: the browser keeps the conversation and sends recent turns.
 *
 * /api/assistant:
 *   post:
 *     summary: Ask the assistant a question
 *     tags: [Assistant]
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [message]
 *             properties:
 *               message: { type: string, maxLength: 500, example: "How much did I spend on food this month?" }
 *               history:
 *                 type: array
 *                 maxItems: 20
 *                 description: Earlier turns of this conversation, oldest first (the last 10 are used)
 *                 items:
 *                   type: object
 *                   properties:
 *                     role: { type: string, enum: [user, assistant] }
 *                     text: { type: string }
 *               timezone: { type: string, example: Africa/Lagos }
 *     responses:
 *       200:
 *         description: The answer
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: object
 *                   properties:
 *                     answer: { type: string, example: "You spent ₦70,000 on food in the last 30 days." }
 *                     transactions:
 *                       type: array
 *                       description: Transactions the answer is about, so the user can check them
 *                       items: { type: object }
 *                     action:
 *                       type: object
 *                       nullable: true
 *                       description: |
 *                         `{ type: "send_money", recipientName, recipientEmail, amount }` or `{ type: "withdraw", amount }`.
 *                         `recipientEmail` is only given for someone the user has sent money to before.
 *                     fallback:
 *                       type: boolean
 *                       description: True when the AI's wording failed the figure check; only the evidence is shown
 *       400: { description: Empty or too-long question, or an invalid history or timezone }
 *       403: { description: AI features are off for this user }
 *       429: { description: 30 questions a day reached }
 *       503: { description: The AI is unavailable right now }
 */
