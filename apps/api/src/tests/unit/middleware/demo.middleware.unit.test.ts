import prisma from "../../../config/db";
import { isDemoEmail, isUndeliverable } from "../../../config/demo";
import { blockDemoAccount } from "../../../middleware/demo.middleware";

jest.mock("../../../config/db", () => ({ __esModule: true, default: { user: { findUnique: jest.fn() } } }));

const run = async () => {
  const req = { userId: "u1" } as any;
  const res = { status: jest.fn().mockReturnThis(), json: jest.fn() } as any;
  const next = jest.fn();
  await blockDemoAccount("password")(req, res, next);
  return { res, next };
};

describe("demo accounts", () => {
  beforeEach(() => jest.clearAllMocks());

  it("recognises demo and undeliverable addresses", () => {
    expect(isDemoEmail("demo@PurpleWallet.demo")).toBe(true);
    expect(isDemoEmail("ada@gmail.com")).toBe(false);
    expect(isUndeliverable("demo@purplewallet.demo")).toBe(true);
    expect(isUndeliverable("e2e@example.com")).toBe(true);
    expect(isUndeliverable("x@school.test")).toBe(true);
    expect(isUndeliverable("ada@gmail.com")).toBe(false);
  });

  it("refuses to change a demo account's password, with 403 (never 401)", async () => {
    (prisma.user.findUnique as jest.Mock).mockResolvedValue({ email: "demo@purplewallet.demo" });
    const { res, next } = await run();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json.mock.calls[0][0].message).toContain("shared demo account, so its password can't be changed");
    expect(next).not.toHaveBeenCalled();
  });

  it("lets everyone else through", async () => {
    (prisma.user.findUnique as jest.Mock).mockResolvedValue({ email: "ada@gmail.com" });
    expect((await run()).next).toHaveBeenCalled();
  });

  it("lets the request through if the lookup fails", async () => {
    (prisma.user.findUnique as jest.Mock).mockRejectedValue(new Error("db down"));
    expect((await run()).next).toHaveBeenCalled();
  });
});
