import request from "supertest";
import app from "../../app";
import { findUserById } from "../../services/auth.service";
import { getInsights, InsightsError, requestRefresh, setInsightsEnabled, setTransactionCategory } from "../../services/insights/insights.service";

jest.mock("../../middleware/auth.middleware", () => ({
  authenticate: (req: any, res: any, next: any) => {
    if (!req.headers.authorization) return res.status(401).json({ success: false, message: "No token provided" });
    req.userId = "user123";
    next();
  },
}));
jest.mock("../../services/insights/insights.service", () => ({
  ...jest.requireActual("../../services/insights/insights.service"),
  getInsights: jest.fn(),
  requestRefresh: jest.fn(),
  setInsightsEnabled: jest.fn(),
  setTransactionCategory: jest.fn(),
}));
jest.mock("../../services/auth.service", () => ({ ...jest.requireActual("../../services/auth.service"), findUserById: jest.fn(), updatePreferences: jest.fn() }));

const auth = { Authorization: "Bearer token" };

describe("Insights API", () => {
  beforeEach(() => jest.clearAllMocks());

  it("returns insights for the caller's timezone", async () => {
    (getInsights as jest.Mock).mockResolvedValue({ enabled: true, refreshing: false, insight: { headline: "Hi" } });

    const res = await request(app).get("/api/insights?timezone=Africa/Lagos").set(auth);

    expect(res.status).toBe(200);
    expect(getInsights).toHaveBeenCalledWith("user123", "Africa/Lagos");
    expect(res.body.data.insight.headline).toBe("Hi");
  });

  it("rejects an unknown timezone", async () => {
    const res = await request(app).get("/api/insights?timezone=Mars/Base").set(auth);

    expect(res.status).toBe(400);
    expect(getInsights).not.toHaveBeenCalled();
  });

  it("requires sign-in", async () => {
    expect((await request(app).get("/api/insights")).status).toBe(401);
  });

  it("queues a refresh (202) and passes on the daily limit as 429", async () => {
    const ok = await request(app).post("/api/insights/refresh").set(auth).send({ timezone: "Africa/Lagos" });
    expect(ok.status).toBe(202);

    (requestRefresh as jest.Mock).mockRejectedValue(new InsightsError("You can refresh insights 5 times a day. Try again tomorrow.", 429));
    const limited = await request(app).post("/api/insights/refresh").set(auth).send({});
    expect(limited.status).toBe(429);
  });

  it("opts in through preferences, with the timezone for the first insights", async () => {
    (findUserById as jest.Mock).mockResolvedValue({ id: "user123", aiInsightsEnabled: true });

    const res = await request(app).patch("/api/account/preferences").set(auth).send({ aiInsightsEnabled: true, timezone: "Africa/Lagos" });

    expect(res.status).toBe(200);
    expect(setInsightsEnabled).toHaveBeenCalledWith("user123", true, "Africa/Lagos");
    expect(res.body.data.user.aiInsightsEnabled).toBe(true);
  });

  it("refuses an empty preferences update", async () => {
    const res = await request(app).patch("/api/account/preferences").set(auth).send({});

    expect(res.status).toBe(400);
  });

  it("sets a transaction's category", async () => {
    (setTransactionCategory as jest.Mock).mockResolvedValue({ id: "t1", category: "FOOD", categorySource: "USER" });

    const res = await request(app).patch("/api/wallet/transactions/t1/category").set(auth).send({ category: "FOOD" });

    expect(res.status).toBe(200);
    expect(setTransactionCategory).toHaveBeenCalledWith("user123", "t1", "FOOD");
  });

  it("rejects an unknown category", async () => {
    const res = await request(app).patch("/api/wallet/transactions/t1/category").set(auth).send({ category: "CARS" });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/category must be one of/);
  });
});
