import bcrypt from "bcryptjs";
import prisma from "../../../config/db";
import { findUserById, registerUser } from "../../../services/auth.service";

jest.mock("../../../config/db", () => ({
  __esModule: true,
  default: {
    user: {
      create: jest.fn(),
      findUnique: jest.fn(),
    },
  },
}));

jest.mock("bcryptjs");

const publicFields = { id: true, name: true, email: true, createdAt: true };

describe("auth.service", () => {
  beforeEach(() => jest.clearAllMocks());

  describe("registerUser", () => {
    it("hashes the password and never selects it back", async () => {
      (bcrypt.hash as jest.Mock).mockResolvedValue("hashed-pw");
      (prisma.user.create as jest.Mock).mockResolvedValue({ id: "u1" });

      await registerUser("Tochi", "new@test.com", "password123");

      expect(bcrypt.hash).toHaveBeenCalledWith("password123", 10);
      const args = (prisma.user.create as jest.Mock).mock.calls[0][0];
      expect(args.data.password).toBe("hashed-pw");
      expect(args.data.wallet).toEqual({ create: { balance: 0 } });
      expect(args.select).toEqual(publicFields);
    });
  });

  describe("findUserById", () => {
    it("looks up by id and selects only public fields", async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);

      await findUserById("u1");

      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { id: "u1" },
        select: publicFields,
      });
    });
  });
});
