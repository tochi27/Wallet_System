/**
 * @swagger
 * tags:
 *   name: Webhooks
 *   description: |
 *     Register endpoints to receive real-time event notifications.
 *     Each delivery is signed with HMAC-SHA256 using the webhook secret.
 *     Verify the `X-Webhook-Signature` header on receipt: `sha256=<hex-digest>`.
 *
 *     Failed deliveries are retried automatically up to **4 attempts** with
 *     exponential backoff (2 s, 4 s, 8 s). Every attempt is recorded in the
 *     delivery history and can be inspected via `GET /{webhookId}/deliveries`.
 *
 *     **Supported events:** `CREDIT`, `DEBIT`, `TRANSFER`, `REVERSAL`, `*` (all events)
 */

/**
 * @swagger
 * /api/webhooks:
 *   post:
 *     summary: Register a new webhook
 *     description: |
 *       Creates a webhook endpoint subscription for the specified events.
 *       The `secret` in the response is shown **only once** — store it securely.
 *       Use it to verify the `X-Webhook-Signature` header on incoming deliveries.
 *     tags: [Webhooks]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - url
 *               - events
 *             properties:
 *               url:
 *                 type: string
 *                 format: uri
 *                 example: https://your-server.com/webhooks/wallet
 *               events:
 *                 type: array
 *                 minItems: 1
 *                 items:
 *                   type: string
 *                   enum: [CREDIT, DEBIT, TRANSFER, REVERSAL, "*"]
 *                 example: [CREDIT, TRANSFER]
 *     responses:
 *       201:
 *         description: Webhook registered — save the secret, it will not be shown again
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
 *                   example: "Webhook registered. Save the secret — it will not be shown again."
 *                 data:
 *                   allOf:
 *                     - $ref: '#/components/schemas/Webhook'
 *                     - type: object
 *                       properties:
 *                         secret:
 *                           type: string
 *                           description: 64-character hex secret for HMAC-SHA256 signature verification
 *                           example: a3f1b2c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2
 *       400:
 *         description: Validation error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             examples:
 *               invalidUrl:
 *                 summary: URL is not valid
 *                 value:
 *                   success: false
 *                   message: Invalid webhook URL
 *               emptyEvents:
 *                 summary: Events list is empty
 *                 value:
 *                   success: false
 *                   message: At least one event is required
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
 *
 *   get:
 *     summary: List all active webhooks for the authenticated user
 *     tags: [Webhooks]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Webhooks fetched successfully
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
 *                   example: Webhooks fetched successfully
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Webhook'
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
 * /api/webhooks/{webhookId}/deliveries:
 *   get:
 *     summary: Get delivery history for a webhook
 *     description: |
 *       Returns the last 50 delivery attempts for a webhook, newest first.
 *       Each retry by the worker is recorded as a separate entry so you can
 *       see the full attempt trail — which attempts failed, with what error,
 *       and which attempt ultimately succeeded.
 *     tags: [Webhooks]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: webhookId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: ID of the webhook
 *         example: 550e8400-e29b-41d4-a716-446655440000
 *     responses:
 *       200:
 *         description: Delivery history fetched successfully
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
 *                   example: Delivery history fetched successfully
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/WebhookDelivery'
 *       401:
 *         description: Unauthorized
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       404:
 *         description: Webhook not found or does not belong to the user
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             example:
 *               success: false
 *               message: Webhook not found
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *
 * /api/webhooks/{webhookId}:
 *   delete:
 *     summary: Deactivate a webhook
 *     description: Soft-deletes the webhook by marking it inactive. Deliveries already in flight are not affected.
 *     tags: [Webhooks]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: webhookId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: ID of the webhook to deactivate
 *         example: 550e8400-e29b-41d4-a716-446655440000
 *     responses:
 *       200:
 *         description: Webhook deleted successfully
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
 *                   example: Webhook deleted successfully
 *       401:
 *         description: Unauthorized
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       404:
 *         description: Webhook not found or does not belong to the user
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             example:
 *               success: false
 *               message: Webhook not found
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
