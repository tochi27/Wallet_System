import { Request, Response } from "express";
import { requireAdmin, requirePermission } from "../../../middleware/admin.middleware";
import { can } from "../../../services/admin/permissions";

const run = (middleware: (req: Request, res: Response, next: () => void) => unknown, role?: string) => {
  const res = { status: jest.fn().mockReturnThis(), json: jest.fn() } as unknown as Response;
  const next = jest.fn();
  middleware({ userRole: role } as unknown as Request, res, next);
  return { res, next };
};

describe("admin roles", () => {
  it.each(["VIEWER", "SUPPORT", "FINANCE", "OWNER"])("lets %s into the admin area", (role) => {
    expect(run(requireAdmin, role).next).toHaveBeenCalled();
  });

  it.each([undefined, "USER"])("keeps %s out with 403", (role) => {
    const { res, next } = run(requireAdmin, role);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it.each([
    ["VIEWER", "admin.view", true],
    ["VIEWER", "users.manage", false],
    ["SUPPORT", "users.manage", true],
    ["SUPPORT", "adjustments.manage", false],
    ["FINANCE", "adjustments.manage", true],
    ["FINANCE", "staff.manage", false],
    ["OWNER", "staff.manage", true],
    ["USER", "admin.view", false],
  ] as const)("%s can %s: %s", (role, permission, allowed) => {
    expect(can(role, permission)).toBe(allowed);
    const { next } = run(requirePermission(permission), role);
    expect(next).toHaveBeenCalledTimes(allowed ? 1 : 0);
  });
});
