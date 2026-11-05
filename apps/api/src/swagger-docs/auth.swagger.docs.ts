/**
 * @swagger
 * tags:
 *   name: Auth
 *   description: User authentication — signup, login, and logout
 */

/**
 * @swagger
 * /api/auth/signup:
 *   post:
 *     summary: Register a new user
 *     tags: [Auth]
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - name
 *               - email
 *               - password
 *             properties:
 *               name:
 *                 type: string
 *                 minLength: 1
 *                 maxLength: 100
 *                 example: Jane Doe
 *               email:
 *                 type: string
 *                 format: email
 *                 example: jane@example.com
 *               password:
 *                 type: string
 *                 minLength: 8
 *                 example: supersecret99
 *     responses:
 *       200:
 *         description: Signup successful
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
 *                   example: Signup successful
 *                 data:
 *                   type: object
 *                   properties:
 *                     user:
 *                       type: object
 *                       properties:
 *                         id:
 *                           type: string
 *                           format: uuid
 *                         name:
 *                           type: string
 *                           example: Jane Doe
 *                         email:
 *                           type: string
 *                           example: jane@example.com
 *                         createdAt:
 *                           type: string
 *                           format: date-time
 *       400:
 *         description: Validation error or email already registered
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             examples:
 *               emailExists:
 *                 summary: Email already registered
 *                 value:
 *                   success: false
 *                   message: Email already exists
 *               validation:
 *                 summary: Validation failure
 *                 value:
 *                   success: false
 *                   message: Password must be at least 8 characters
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */

/**
 * @swagger
 * /api/auth/login:
 *   post:
 *     summary: Log in and receive a JWT
 *     tags: [Auth]
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *               - password
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *                 example: jane@example.com
 *               password:
 *                 type: string
 *                 example: supersecret99
 *     responses:
 *       200:
 *         description: Login successful — use the returned token as a Bearer token
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
 *                   example: Login successful
 *                 data:
 *                   type: object
 *                   properties:
 *                     token:
 *                       type: string
 *                       example: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
 *       400:
 *         description: Invalid credentials or validation error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             example:
 *               success: false
 *               message: Invalid credentials
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */

/**
 * @swagger
 * /api/auth/logout:
 *   post:
 *     summary: Invalidate the current JWT
 *     description: |
 *       Blacklists the Bearer token so it cannot be reused.
 *       The token is hashed before storage and expires automatically when the JWT expires.
 *     tags: [Auth]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Logout successful
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
 *                   example: Logout successful
 *       400:
 *         description: Authorization header missing or malformed
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             examples:
 *               missingHeader:
 *                 value:
 *                   success: false
 *                   message: Authorization header missing
 *               invalidFormat:
 *                 value:
 *                   success: false
 *                   message: Invalid token format
 */

/**
 * @swagger
 * /api/auth/me:
 *   get:
 *     summary: Get the authenticated user's profile
 *     tags: [Auth]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: User fetched successfully
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
 *                   example: User fetched successfully
 *                 data:
 *                   type: object
 *                   properties:
 *                     user:
 *                       type: object
 *                       properties:
 *                         id:
 *                           type: string
 *                           format: uuid
 *                         name:
 *                           type: string
 *                           example: Jane Doe
 *                         email:
 *                           type: string
 *                           example: jane@example.com
 *                         createdAt:
 *                           type: string
 *                           format: date-time
 *                         emailNotifications:
 *                           type: boolean
 *                           description: Whether money-movement emails are on (security alerts always are)
 *                         emailVerified:
 *                           type: boolean
 *                           description: Whether the user has followed the link in their verification email. Until then every way of moving money returns 403.
 *                         hasPin:
 *                           type: boolean
 *                           description: Whether a transaction PIN is set
 *                         pinLockedUntil:
 *                           type: string
 *                           format: date-time
 *                           nullable: true
 *                           description: Set only while transfers and withdrawals are locked after 5 wrong PINs
 *                         passwordChangedAt:
 *                           type: string
 *                           format: date-time
 *                           nullable: true
 *                           description: Last password change or reset; null if never changed
 *       401:
 *         description: Unauthorized — missing, invalid, expired, or blacklisted token
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
 * /api/auth/forgot-password:
 *   post:
 *     summary: Email a password reset link
 *     description: |
 *       Always answers 200 with the same message, whether or not the email has an account, so it
 *       can't be used to find out who is registered. If it does, a link to
 *       `APP_URL/reset-password?token=…` is emailed. The link works once and expires in 30 minutes;
 *       a new request replaces any earlier link. At most one email per address every 2 minutes.
 *     tags: [Auth]
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email]
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *                 example: jane@example.com
 *     responses:
 *       200:
 *         description: Request accepted
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
 *                   example: If an account exists for that email, we've sent a link to reset the password.
 *       400:
 *         description: Invalid email address
 *       429:
 *         description: Rate limited
 */

/**
 * @swagger
 * /api/auth/reset-password:
 *   post:
 *     summary: Set a new password with a reset link's token
 *     description: |
 *       Signs out every existing session (tokens issued before the reset are rejected) and clears
 *       a transaction PIN lockout. The user then logs in with the new password.
 *     tags: [Auth]
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [token, password]
 *             properties:
 *               token:
 *                 type: string
 *                 description: The `token` query parameter from the emailed link
 *               password:
 *                 type: string
 *                 minLength: 8
 *     responses:
 *       200:
 *         description: Password reset
 *       400:
 *         description: Password too short, or the link is invalid, already used or expired
 *       429:
 *         description: Rate limited
 */

/**
 * @swagger
 * /api/auth/verify-email:
 *   post:
 *     summary: Verify the user's email with the token from the verification link
 *     description: |
 *       Signup emails a link to `APP_URL/verify-email?token=…` (in development without
 *       an email provider, the link is printed in the API log instead). Works whether or not the
 *       person is signed in: holding the link proves they own the inbox. The link works once and
 *       expires in 24 hours; opening an already-used link that verified the account answers 200
 *       with `status: already_verified`.
 *     tags: [Auth]
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [token]
 *             properties:
 *               token:
 *                 type: string
 *                 description: The `token` query parameter from the emailed link
 *     responses:
 *       200:
 *         description: Verified, or already verified
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
 *                   example: Email verified. You can now move money.
 *                 data:
 *                   type: object
 *                   properties:
 *                     status:
 *                       type: string
 *                       enum: [verified, already_verified]
 *       400:
 *         description: The link is invalid or has expired
 *       429:
 *         description: Rate limited
 */

/**
 * @swagger
 * /api/auth/resend-verification:
 *   post:
 *     summary: Email the signed-in user a new verification link
 *     description: |
 *       Replaces any earlier unused link. At most one email every 2 minutes and 5 a day (the
 *       signup email counts).
 *     tags: [Auth]
 *     responses:
 *       200:
 *         description: A new link was sent
 *       401:
 *         description: Not signed in
 *       409:
 *         description: The email is already verified
 *       429:
 *         description: Too soon after the last link (the message says how long to wait), or the daily limit is reached
 */
