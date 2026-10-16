/**
 * @swagger
 * /api/account/upgrade:
 *   get:
 *     summary: The user's latest Tier 2 request and whether they can send one now
 *     tags: [Account]
 *     responses:
 *       200:
 *         description: "`{ tier, canApply, latest }`. `latest.rejection` has `{ reason, label, message }` when staff rejected it."
 *   post:
 *     summary: Send ID for a Tier 2 upgrade
 *     description: |
 *       Multipart form. Needs a verified email; one pending request at a time. Photos are checked by
 *       their contents (JPEG, PNG or PDF, up to 5 MB each), re-encoded to strip location and camera
 *       data, then stored AES-256-GCM encrypted with the ID number. The back is required for
 *       NATIONAL_ID, DRIVERS_LICENCE and VOTERS_CARD. The selfie must be a photo.
 *     tags: [Account]
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [legalName, dateOfBirth, idType, idNumber, ID_FRONT, SELFIE]
 *             properties:
 *               legalName: { type: string, description: As it appears on the ID }
 *               dateOfBirth: { type: string, format: date, description: At least 18 years ago }
 *               idType: { type: string, enum: [NIN_SLIP, NATIONAL_ID, DRIVERS_LICENCE, PASSPORT, VOTERS_CARD] }
 *               idNumber: { type: string, description: "NIN 11 digits; passport a letter + 8 digits; VIN 19 characters; spaces and dashes ignored" }
 *               ID_FRONT: { type: string, format: binary }
 *               ID_BACK: { type: string, format: binary }
 *               SELFIE: { type: string, format: binary, description: The user holding the ID }
 *     responses:
 *       201: { description: Sent for review }
 *       400: { description: Invalid details, or a photo missing, too big or unreadable }
 *       403: { description: Email not verified }
 *       409: { description: Already on Tier 2, or a request is already being checked }
 *
 * /api/account/support:
 *   get:
 *     summary: The support email for the app's "Help & support" link
 *     tags: [Account]
 *     responses:
 *       200: { description: "`{ email }` (SUPPORT_EMAIL, or the EMAIL_FROM address)" }
 *
 * /api/admin/verifications:
 *   get:
 *     summary: ID checks for Tier 2 (pending ones oldest first)
 *     description: Needs `kyc.review` (SUPPORT and above). Viewers can't see ID checks.
 *     tags: [Admin]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: status, schema: { type: string, enum: [PENDING, APPROVED, REJECTED], default: PENDING } }
 *       - $ref: '#/components/parameters/AdminLimit'
 *       - $ref: '#/components/parameters/AdminCursor'
 *     responses:
 *       200: { description: "`{ items, nextCursor }`; items show only the last 4 of the ID number" }
 *
 * /api/admin/verifications/{id}:
 *   get:
 *     summary: One ID check, with the decrypted ID number (audited as kyc.view)
 *     tags: [Admin]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     responses:
 *       200: { description: Details, documents (ids and types), the account and earlier checks }
 *       404: { description: Not found }
 *
 * /api/admin/verifications/{id}/documents/{documentId}:
 *   get:
 *     summary: A decrypted ID photo, PDF or selfie
 *     description: Sent with `Cache-Control no-store`. Opening a request's documents is audited (at most once per reviewer per request every 15 minutes).
 *     tags: [Admin]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *       - { in: path, name: documentId, required: true, schema: { type: string } }
 *     responses:
 *       200: { description: The file (image/jpeg or application/pdf) }
 *       404: { description: Not found, or deleted 30 days after a rejection }
 *
 * /api/admin/verifications/{id}/approve:
 *   post:
 *     summary: Approve an ID check; the user moves to Tier 2 and is notified
 *     tags: [Admin]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     responses:
 *       200: { description: Approved; returns the updated check }
 *       400: { description: It's your own check }
 *       409: { description: Already reviewed }
 *
 * /api/admin/verifications/{id}/reject:
 *   post:
 *     summary: Reject an ID check with a reason the user sees; they can send it again
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
 *             required: [reason]
 *             properties:
 *               reason: { type: string, enum: [BLURRY_PHOTO, NAME_MISMATCH, EXPIRED_ID, SELFIE_MISMATCH, WRONG_DOCUMENT, OTHER] }
 *               message: { type: string, maxLength: 300, description: Shown to the user }
 *     responses:
 *       200: { description: Rejected; returns the updated check }
 *       400: { description: Invalid reason, or your own check }
 *       409: { description: Already reviewed }
 */
