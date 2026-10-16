import { Role } from "@prisma/client";
import prisma from "../../config/db";
import { AdminActionError } from "./admin.service";
import { confirmAdminPassword } from "./adjustments.service";

export const listStaff = () =>
  prisma.user.findMany({
    where: { role: { not: Role.USER } },
    orderBy: [{ role: "desc" }, { name: "asc" }],
    select: { id: true, name: true, email: true, role: true, createdAt: true },
  });

/**
 * An owner grants, changes or removes someone's staff role (USER removes it). Owners can't change
 * their own role, and the last owner can't be demoted, so the console can never lock everyone out.
 */
export const setStaffRole = async (ownerId: string, userId: string, role: Role, reason: string, password: string) => {
  await confirmAdminPassword(ownerId, password);
  if (userId === ownerId) throw new AdminActionError("You can't change your own role", 400);

  const target = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, role: true, frozenAt: true } });
  if (!target) throw new AdminActionError("User not found", 404);
  if (target.role === role) throw new AdminActionError("They already have that role", 409);
  if (role !== Role.USER && target.frozenAt) throw new AdminActionError("A frozen account can't be given a staff role", 400);

  return prisma.$transaction(async (tx) => {
    if (target.role === Role.OWNER) {
      const owners = await tx.user.count({ where: { role: Role.OWNER } });
      if (owners <= 1) throw new AdminActionError("There must always be at least one owner", 409);
    }
    const updated = await tx.user.update({
      where: { id: userId },
      data: { role },
      select: { id: true, name: true, email: true, role: true, createdAt: true },
    });
    await tx.adminAuditLog.create({
      data: { adminId: ownerId, action: "staff.role_change", targetType: "User", targetId: userId, reason, details: { from: target.role, to: role } },
    });
    return updated;
  });
};
