// tests/integration/auth.int.test.ts
import request from "supertest";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import app from "../../app";
import { findUserByEmail, registerUser } from "../../services/auth.service";
import { generateToken } from "../../utils/jwt.utils";
import { addToBlacklistWithExpiry } from "../../utils/tokenBlacklist.utils";

// --- Mock dependencies ---
jest.mock("../../services/auth.service.ts");
jest.mock("../../utils/tokenBlacklist.utils.ts");
jest.mock("../../utils/jwt.utils.ts");
jest.mock("bcryptjs");
jest.mock("jsonwebtoken");

describe("Auth Controllers (Integration with Express + Supertest)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ---------- SIGNUP ----------
  describe("POST /api/auth/signup", () => {
    it("should return 400 if email already exists", async () => {
      (findUserByEmail as jest.Mock).mockResolvedValue({ id: 1, email: "exists@test.com" });

      const res = await request(app)
        .post("/api/auth/signup")
        .send({ name: "Tochi", email: "exists@test.com", password: "123456" });

      expect(res.status).toBe(400);
      expect(res.body.message).toBe("Email already exists");
    });

    it("should create a new user successfully", async () => {
      (findUserByEmail as jest.Mock).mockResolvedValue(null);
      (registerUser as jest.Mock).mockResolvedValue({ id: 1, email: "new@test.com" });

      const res = await request(app)
        .post("/api/auth/signup")
        .send({ name: "Tochi", email: "new@test.com", password: "123456" });

      expect(res.status).toBe(200);
      expect(res.body.message).toBe("Signup successful");
      expect(res.body.data.user.email).toBe("new@test.com");
    });
  });

  // ---------- LOGIN ----------
  describe("POST /api/auth/login", () => {
    it("should return 400 if user not found", async () => {
      (findUserByEmail as jest.Mock).mockResolvedValue(null);

      const res = await request(app)
        .post("/api/auth/login")
        .send({ email: "ghost@test.com", password: "123456" });

      expect(res.status).toBe(400);
      expect(res.body.message).toBe("Invalid credentials");
    });

    it("should return 400 if password is wrong", async () => {
      (findUserByEmail as jest.Mock).mockResolvedValue({ id: 1, password: "hashedpw" });
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      const res = await request(app)
        .post("/api/auth/login")
        .send({ email: "user@test.com", password: "wrongpw" });

      expect(res.status).toBe(400);
      expect(res.body.message).toBe("Invalid credentials");
    });

    it("should return token if login successful", async () => {
      (findUserByEmail as jest.Mock).mockResolvedValue({ id: 1, password: "hashedpw" });
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
      (generateToken as jest.Mock).mockReturnValue("fake-token");

      const res = await request(app)
        .post("/api/auth/login")
        .send({ email: "user@test.com", password: "123456" });

      expect(res.status).toBe(200);
      expect(res.body.data.token).toBe("fake-token");
    });
  });

  // ---------- LOGOUT ----------
  describe("POST /api/auth/logout", () => {
    it("should return 400 if Authorization header missing", async () => {
      const res = await request(app).post("/api/auth/logout");
      expect(res.status).toBe(400);
      expect(res.body.message).toBe("Authorization header missing");
    });

    it("should return 400 if token format is invalid", async () => {
      const res = await request(app)
        .post("/api/auth/logout")
        .set("Authorization", "Bearer"); // no token

      expect(res.status).toBe(400);
      expect(res.body.message).toBe("Invalid token format");
    });

    it("should logout successfully and blacklist token", async () => {
      (jwt.decode as jest.Mock).mockReturnValue({ exp: Math.floor(Date.now() / 1000) + 3600 });

      const res = await request(app)
        .post("/api/auth/logout")
        .set("Authorization", "Bearer validtoken");

      expect(addToBlacklistWithExpiry).toHaveBeenCalledWith("validtoken", expect.any(Number));
      expect(res.status).toBe(200);
      expect(res.body.message).toBe("Logout successful");
    });
  });
});
