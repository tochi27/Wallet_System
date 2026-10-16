import request from "supertest";
import app from "../../app";
import {
  approveUpgrade,
  getUpgradeDocument,
  getUpgradeRequest,
  listUpgradeRequests,
  rejectUpgrade,
  submitUpgrade,
  UpgradeError,
} from "../../services/kyc/upgrade.service";

// Tests choose the caller's role and whether their email is verified with headers
jest.mock("../../middleware/auth.middleware", () => ({
  authenticate: (req: any, res: any, next: any) => {
    if (!req.headers.authorization) return res.status(401).json({ success: false, message: "No token provided" });
    req.userId = "caller";
    req.userRole = req.headers["x-test-role"] ?? "USER";
    req.emailVerified = req.headers["x-test-unverified"] !== "true";
    next();
  },
}));
jest.mock("../../services/kyc/upgrade.service", () => ({
  ...jest.requireActual("../../services/kyc/upgrade.service"),
  submitUpgrade: jest.fn(),
  listUpgradeRequests: jest.fn(),
  getUpgradeRequest: jest.fn(),
  getUpgradeDocument: jest.fn(),
  approveUpgrade: jest.fn(),
  rejectUpgrade: jest.fn(),
}));

const user = { Authorization: "Bearer t" };
const support = { ...user, "x-test-role": "SUPPORT" };
const viewer = { ...user, "x-test-role": "VIEWER" };

const send = (fields: Record<string, string>, headers: Record<string, string> = user) => {
  let req = request(app).post("/api/account/upgrade").set(headers);
  for (const [key, value] of Object.entries(fields)) req = req.field(key, value);
  return req
    .attach("ID_FRONT", Buffer.from("front"), { filename: "front.jpg", contentType: "image/jpeg" })
    .attach("SELFIE", Buffer.from("selfie"), { filename: "selfie.jpg", contentType: "image/jpeg" });
};
const valid = { legalName: "Ada Obi", dateOfBirth: "1990-04-02", idType: "NIN_SLIP", idNumber: "123 4567 8901" };

describe("Tier upgrade (ID check)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (submitUpgrade as jest.Mock).mockResolvedValue({ id: "r1", status: "PENDING" });
  });

  describe("POST /api/account/upgrade", () => {
    it("takes the form and its photos, with the ID number tidied up", async () => {
      const res = await send(valid);

      expect(res.status).toBe(201);
      const [userId, details, files] = (submitUpgrade as jest.Mock).mock.calls[0];
      expect(userId).toBe("caller");
      expect(details).toEqual({ legalName: "Ada Obi", dateOfBirth: new Date("1990-04-02T00:00:00Z"), idType: "NIN_SLIP", idNumber: "12345678901" });
      expect(files.ID_FRONT.buffer.toString()).toBe("front");
      expect(files.SELFIE.buffer.toString()).toBe("selfie");
      expect(files.ID_BACK).toBeUndefined();
    });

    it.each([
      [{ idNumber: "1234" }, "11 digits"],
      [{ idType: "PASSPORT", idNumber: "12345678" }, "letter and 8 digits"],
      [{ dateOfBirth: "2015-01-01" }, "at least 18"],
      [{ legalName: "A" }, "full name"],
      [{ idType: "BVN" }, "type of ID"],
    ])("rejects %j", async (change, message) => {
      const res = await send({ ...valid, ...change });
      expect(res.status).toBe(400);
      expect(res.body.message).toContain(message);
      expect(submitUpgrade).not.toHaveBeenCalled();
    });

    it("refuses files over 5 MB before they reach the service", async () => {
      const res = await request(app)
        .post("/api/account/upgrade")
        .set(user)
        .field("legalName", "Ada Obi")
        .attach("ID_FRONT", Buffer.alloc(5 * 1024 * 1024 + 1), { filename: "big.jpg", contentType: "image/jpeg" });
      expect(res.status).toBe(400);
      expect(res.body.message).toContain("5 MB");
    });

    it("needs a verified email", async () => {
      const res = await send(valid, { ...user, "x-test-unverified": "true" });
      expect(res.status).toBe(403);
    });

    it("passes on the service's refusal", async () => {
      (submitUpgrade as jest.Mock).mockRejectedValue(new UpgradeError("We're already checking your ID.", 409));
      expect((await send(valid)).status).toBe(409);
    });
  });

  describe("staff review", () => {
    it.each([
      ["get", "/api/admin/verifications"],
      ["get", "/api/admin/verifications/r1"],
      ["get", "/api/admin/verifications/r1/documents/d1"],
      ["post", "/api/admin/verifications/r1/approve"],
    ] as const)("%s %s needs the review permission (a viewer can't see ID documents)", async (method, path) => {
      const res = await request(app)[method](path).set(viewer);
      expect(res.status).toBe(403);
      expect(getUpgradeRequest).not.toHaveBeenCalled();
      expect(approveUpgrade).not.toHaveBeenCalled();
    });

    it("lists pending requests by default", async () => {
      (listUpgradeRequests as jest.Mock).mockResolvedValue({ items: [], nextCursor: null });
      const res = await request(app).get("/api/admin/verifications").set(support);
      expect(res.status).toBe(200);
      expect(listUpgradeRequests).toHaveBeenCalledWith({ status: "PENDING", limit: 25 });
    });

    it("serves a document with no caching", async () => {
      (getUpgradeDocument as jest.Mock).mockResolvedValue({ kind: "SELFIE", mimeType: "image/jpeg", data: Buffer.from("jpeg bytes") });

      const res = await request(app).get("/api/admin/verifications/r1/documents/d1").set(support);

      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toBe("image/jpeg");
      expect(res.headers["cache-control"]).toBe("no-store, private");
      expect(getUpgradeDocument).toHaveBeenCalledWith("caller", "r1", "d1");
    });

    it("approves", async () => {
      (getUpgradeRequest as jest.Mock).mockResolvedValue({ id: "r1", status: "APPROVED" });
      const res = await request(app).post("/api/admin/verifications/r1/approve").set(support);
      expect(res.status).toBe(200);
      expect(approveUpgrade).toHaveBeenCalledWith("caller", "r1");
    });

    it("rejects with a reason and an optional message", async () => {
      (getUpgradeRequest as jest.Mock).mockResolvedValue({ id: "r1", status: "REJECTED" });
      const res = await request(app)
        .post("/api/admin/verifications/r1/reject")
        .set(support)
        .send({ reason: "BLURRY_PHOTO", message: " The photo is too dark. " });
      expect(res.status).toBe(200);
      expect(rejectUpgrade).toHaveBeenCalledWith("caller", "r1", "BLURRY_PHOTO", "The photo is too dark.");
    });

    it("needs a valid rejection reason", async () => {
      const res = await request(app).post("/api/admin/verifications/r1/reject").set(support).send({ reason: "NOPE" });
      expect(res.status).toBe(400);
      expect(rejectUpgrade).not.toHaveBeenCalled();
    });
  });

  describe("GET /api/account/support", () => {
    it("gives the support email", async () => {
      const res = await request(app).get("/api/account/support").set(user);
      expect(res.status).toBe(200);
      expect(res.body.data.email).toMatch(/@/);
    });
  });
});
