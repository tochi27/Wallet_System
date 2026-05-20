import request from "supertest";
import app from "../../app";
import prisma from "../../config/db";
import redisClient from "../../services/redis.service";

jest.mock("../../config/db", () => ({
  __esModule: true,
  default: { $queryRaw: jest.fn() },
}));

jest.mock("../../services/redis.service", () => ({
  __esModule: true,
  default: { ping: jest.fn() },
}));

describe("GET /health", () => {
  beforeEach(() => jest.clearAllMocks());

  it("returns 200 and status ok when all services are up", async () => {
    (prisma.$queryRaw as jest.Mock).mockResolvedValue([]);
    (redisClient.ping as jest.Mock).mockResolvedValue("PONG");

    const res = await request(app).get("/health");

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
    expect(res.body.services.database).toBe("ok");
    expect(res.body.services.redis).toBe("ok");
    expect(typeof res.body.uptime).toBe("number");
  });

  it("returns 503 and status degraded when database is down", async () => {
    (prisma.$queryRaw as jest.Mock).mockRejectedValue(new Error("Connection refused"));
    (redisClient.ping as jest.Mock).mockResolvedValue("PONG");

    const res = await request(app).get("/health");

    expect(res.status).toBe(503);
    expect(res.body.status).toBe("degraded");
    expect(res.body.services.database).toBe("error");
    expect(res.body.services.redis).toBe("ok");
  });

  it("returns 503 and status degraded when Redis is down", async () => {
    (prisma.$queryRaw as jest.Mock).mockResolvedValue([]);
    (redisClient.ping as jest.Mock).mockRejectedValue(new Error("Redis connection error"));

    const res = await request(app).get("/health");

    expect(res.status).toBe(503);
    expect(res.body.status).toBe("degraded");
    expect(res.body.services.database).toBe("ok");
    expect(res.body.services.redis).toBe("error");
  });

  it("returns 503 and status degraded when both services are down", async () => {
    (prisma.$queryRaw as jest.Mock).mockRejectedValue(new Error("DB error"));
    (redisClient.ping as jest.Mock).mockRejectedValue(new Error("Redis error"));

    const res = await request(app).get("/health");

    expect(res.status).toBe(503);
    expect(res.body.status).toBe("degraded");
    expect(res.body.services.database).toBe("error");
    expect(res.body.services.redis).toBe("error");
  });
});
