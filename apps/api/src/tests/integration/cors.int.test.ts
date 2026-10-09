import request from "supertest";
import app from "../../app";

// Default CORS_ORIGINS (unset in .env.test) is the Vite dev server
const ALLOWED = "http://localhost:5173";

describe("CORS", () => {
  it("allows requests from a configured origin", async () => {
    const res = await request(app).get("/").set("Origin", ALLOWED);

    expect(res.headers["access-control-allow-origin"]).toBe(ALLOWED);
  });

  it("does not allow requests from other origins", async () => {
    const res = await request(app).get("/").set("Origin", "https://evil.example.com");

    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("answers preflight requests for the Idempotency-Key header", async () => {
    const res = await request(app)
      .options("/api/wallet/credit")
      .set("Origin", ALLOWED)
      .set("Access-Control-Request-Method", "POST")
      .set("Access-Control-Request-Headers", "authorization,content-type,idempotency-key");

    expect(res.status).toBe(204);
    expect(res.headers["access-control-allow-origin"]).toBe(ALLOWED);
    expect(res.headers["access-control-allow-headers"]).toMatch(/idempotency-key/i);
  });
});
