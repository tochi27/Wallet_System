import request from "supertest";
import {
  registerWebhook,
  listWebhooks,
  deleteWebhook,
  getDeliveries,
} from "../../services/webhook.service";
import { generateToken } from "../../utils/jwt.utils";
import app from "../../app";

jest.mock("../../middleware/auth.middleware", () => ({
  authenticate: (req: any, res: any, next: any) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({ message: "Authorization header missing" });
    }
    req.userId = "user123";
    next();
  },
}));

jest.mock("../../services/webhook.service");
jest.mock("../../queues/webhook.queue", () => ({
  webhookQueue: { add: jest.fn().mockResolvedValue({ id: "mock-job-id" }) },
}));

const validWebhook = {
  id: "wh-001",
  url: "https://example.com/hook",
  events: ["CREDIT"],
  isActive: true,
  createdAt: new Date().toISOString(),
  secret: "abc123def456abc123def456abc123def456abc123def456abc123def456abcd",
};

describe("Webhook Controllers (Integration with Express + Supertest)", () => {
  const userId = "user123";
  let token: string;

  beforeAll(() => {
    token = generateToken(userId);
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ── POST /api/webhooks ────────────────────────────────────────────────────

  describe("POST /api/webhooks", () => {
    it("registers a webhook and returns 201 with secret", async () => {
      (registerWebhook as jest.Mock).mockResolvedValue(validWebhook);

      const res = await request(app)
        .post("/api/webhooks")
        .set("Authorization", `Bearer ${token}`)
        .send({ url: "https://example.com/hook", events: ["CREDIT"] });

      expect(res.status).toBe(201);
      expect(res.body.message).toBe(
        "Webhook registered. Save the secret — it will not be shown again."
      );
      expect(res.body.data.id).toBe("wh-001");
      expect(res.body.data.secret).toBeDefined();
      expect(registerWebhook).toHaveBeenCalledWith(
        "user123",
        "https://example.com/hook",
        ["CREDIT"]
      );
    });

    it("returns 401 when token is missing", async () => {
      const res = await request(app)
        .post("/api/webhooks")
        .send({ url: "https://example.com/hook", events: ["CREDIT"] });

      expect(res.status).toBe(401);
    });

    it("returns 400 for an invalid URL", async () => {
      const res = await request(app)
        .post("/api/webhooks")
        .set("Authorization", `Bearer ${token}`)
        .send({ url: "not-a-valid-url", events: ["CREDIT"] });

      expect(res.status).toBe(400);
      expect(res.body.message).toBe("Invalid webhook URL");
    });

    it("returns 400 when events array is empty", async () => {
      const res = await request(app)
        .post("/api/webhooks")
        .set("Authorization", `Bearer ${token}`)
        .send({ url: "https://example.com/hook", events: [] });

      expect(res.status).toBe(400);
    });

    it("returns 400 when events contains an invalid event name", async () => {
      const res = await request(app)
        .post("/api/webhooks")
        .set("Authorization", `Bearer ${token}`)
        .send({ url: "https://example.com/hook", events: ["INVALID_EVENT"] });

      expect(res.status).toBe(400);
    });

    it("accepts wildcard * as a valid event", async () => {
      (registerWebhook as jest.Mock).mockResolvedValue({ ...validWebhook, events: ["*"] });

      const res = await request(app)
        .post("/api/webhooks")
        .set("Authorization", `Bearer ${token}`)
        .send({ url: "https://example.com/hook", events: ["*"] });

      expect(res.status).toBe(201);
    });
  });

  // ── GET /api/webhooks ─────────────────────────────────────────────────────

  describe("GET /api/webhooks", () => {
    it("returns the list of webhooks for the user", async () => {
      const webhooks = [validWebhook, { ...validWebhook, id: "wh-002" }];
      (listWebhooks as jest.Mock).mockResolvedValue(webhooks);

      const res = await request(app)
        .get("/api/webhooks")
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.message).toBe("Webhooks fetched successfully");
      expect(res.body.data).toHaveLength(2);
      expect(listWebhooks).toHaveBeenCalledWith("user123");
    });

    it("returns 401 when token is missing", async () => {
      const res = await request(app).get("/api/webhooks");
      expect(res.status).toBe(401);
    });
  });

  // ── DELETE /api/webhooks/:webhookId ───────────────────────────────────────

  describe("DELETE /api/webhooks/:webhookId", () => {
    it("deletes a webhook and returns 200", async () => {
      (deleteWebhook as jest.Mock).mockResolvedValue(undefined);

      const res = await request(app)
        .delete("/api/webhooks/wh-001")
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.message).toBe("Webhook deleted successfully");
      expect(deleteWebhook).toHaveBeenCalledWith("wh-001", "user123");
    });

    it("returns 404 when webhook is not found", async () => {
      (deleteWebhook as jest.Mock).mockRejectedValue(new Error("Webhook not found"));

      const res = await request(app)
        .delete("/api/webhooks/ghost-id")
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(404);
      expect(res.body.message).toBe("Webhook not found");
    });

    it("returns 401 when token is missing", async () => {
      const res = await request(app).delete("/api/webhooks/wh-001");
      expect(res.status).toBe(401);
    });
  });

  // ── GET /api/webhooks/:webhookId/deliveries ───────────────────────────────

  describe("GET /api/webhooks/:webhookId/deliveries", () => {
    const mockDeliveries = [
      {
        id: "d-001",
        event: "CREDIT",
        statusCode: 200,
        success: true,
        attempt: 1,
        error: null,
        createdAt: new Date().toISOString(),
      },
      {
        id: "d-002",
        event: "CREDIT",
        statusCode: 503,
        success: false,
        attempt: 2,
        error: "HTTP 503",
        createdAt: new Date().toISOString(),
      },
    ];

    it("returns delivery history for a webhook", async () => {
      (getDeliveries as jest.Mock).mockResolvedValue(mockDeliveries);

      const res = await request(app)
        .get("/api/webhooks/wh-001/deliveries")
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.message).toBe("Delivery history fetched successfully");
      expect(res.body.data).toHaveLength(2);
      expect(res.body.data[0].attempt).toBe(1);
      expect(res.body.data[1].error).toBe("HTTP 503");
      expect(getDeliveries).toHaveBeenCalledWith("wh-001", "user123");
    });

    it("returns 404 when webhook not found", async () => {
      (getDeliveries as jest.Mock).mockRejectedValue(new Error("Webhook not found"));

      const res = await request(app)
        .get("/api/webhooks/ghost-id/deliveries")
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(404);
      expect(res.body.message).toBe("Webhook not found");
    });

    it("returns 401 when token is missing", async () => {
      const res = await request(app).get("/api/webhooks/wh-001/deliveries");
      expect(res.status).toBe(401);
    });
  });
});
