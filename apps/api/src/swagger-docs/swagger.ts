import path from "path";

const isCompiled = __filename.endsWith(".js");
const docsGlob = path.join(__dirname, isCompiled ? "*.docs.js" : "*.docs.ts");

export const swaggerOptions = {
  definition: {
    openapi: "3.0.1",
    info: {
      title: "Wallet System API",
      version: "1.0.0",
      description:
        "A production-grade wallet engine supporting credits, debits, peer-to-peer transfers, reversals, and webhook notifications.",
      contact: {
        name: "Tochukwu Amaechina",
        email: "tochukwuamaechina2703@gmail.com",
      },
      license: {
        name: "MIT",
        url: "https://opensource.org/licenses/MIT",
      },
    },
    servers: [
      {
        url: "/",
        description: "Current server",
      },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "JWT",
        },
      },
      schemas: {
        Transaction: {
          type: "object",
          properties: {
            id: { type: "string", format: "uuid", example: "550e8400-e29b-41d4-a716-446655440000" },
            userId: { type: "string", format: "uuid" },
            type: { type: "string", enum: ["CREDIT", "DEBIT"] },
            status: {
              type: "string",
              enum: ["PENDING", "PROCESSING", "SUCCESSFUL", "FAILED", "REVERSED"],
            },
            amount: { type: "string", example: "100.00" },
            balanceBefore: { type: "string", example: "0.00" },
            balanceAfter: { type: "string", example: "100.00" },
            reference: { type: "string", example: "3f7b8c2d-4e5f-6a7b-8c9d-0e1f2a3b4c5d" },
            description: { type: "string", nullable: true, example: "Wallet top-up" },
            transferId: { type: "string", nullable: true, format: "uuid" },
            reversalOf: { type: "string", nullable: true, format: "uuid" },
            timestamp: { type: "string", format: "date-time" },
          },
        },
        Webhook: {
          type: "object",
          properties: {
            id: { type: "string", format: "uuid" },
            url: { type: "string", format: "uri", example: "https://your-server.com/webhooks" },
            events: {
              type: "array",
              items: { type: "string", enum: ["CREDIT", "DEBIT", "TRANSFER", "REVERSAL", "*"] },
              example: ["CREDIT", "DEBIT"],
            },
            isActive: { type: "boolean", example: true },
            createdAt: { type: "string", format: "date-time" },
          },
        },
        WebhookDelivery: {
          type: "object",
          properties: {
            id: { type: "string", format: "uuid" },
            event: { type: "string", enum: ["CREDIT", "DEBIT", "TRANSFER", "REVERSAL"], example: "CREDIT" },
            statusCode: { type: "integer", nullable: true, example: 200 },
            success: { type: "boolean", example: true },
            attempt: { type: "integer", description: "Which attempt number this was (1-based)", example: 1 },
            error: { type: "string", nullable: true, description: "Error message for failed attempts; null on success", example: null },
            createdAt: { type: "string", format: "date-time" },
          },
        },
        ErrorResponse: {
          type: "object",
          properties: {
            success: { type: "boolean", example: false },
            message: { type: "string", example: "Error description" },
          },
        },
      },
    },
    security: [{ bearerAuth: [] }],
  },
  apis: [docsGlob],
};
