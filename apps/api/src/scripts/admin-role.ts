/**
 * Makes someone an OWNER, or removes all their staff access. Deliberately a command-line script,
 * not an API endpoint, so a compromised account can never promote itself. It's for the first owner
 * after a deploy, or recovery if every owner is locked out; otherwise owners manage staff roles
 * from the admin console. Every change is written to the audit log.
 *
 *   npm run admin:grant -- someone@example.com "New support lead"
 *   npm run admin:revoke -- someone@example.com "Left the company"
 */
// Loads .env.{NODE_ENV} (and validates it) before Prisma connects
import "../config/env";
import os from "os";
import prisma from "../config/db";

const [command, email, ...reasonWords] = process.argv.slice(2);
const reason = reasonWords.join(" ").trim();

// Who ran it: there's no signed-in admin, so record the machine account instead
const operator = () => {
  try {
    return `${os.userInfo().username}@${os.hostname()}`;
  } catch {
    return os.hostname();
  }
};

const main = async () => {
  if ((command !== "grant" && command !== "revoke") || !email || reason.length < 3) {
    console.error('Usage: admin-role <grant|revoke> <email> "<reason, at least 3 characters>"');
    process.exitCode = 1;
    return;
  }

  const user = await prisma.user.findUnique({ where: { email }, select: { id: true, role: true } });
  if (!user) {
    console.error(`No user with the email ${email}`);
    process.exitCode = 1;
    return;
  }

  const role = command === "grant" ? "OWNER" : "USER";
  if (user.role === role) {
    console.log(`${email} is already ${role === "OWNER" ? "an owner" : "not staff"}`);
    return;
  }

  // The role change and its audit entry succeed or fail together
  await prisma.$transaction([
    prisma.user.update({ where: { id: user.id }, data: { role } }),
    prisma.adminAuditLog.create({
      data: {
        adminId: null,
        action: command === "grant" ? "admin.grant" : "admin.revoke",
        targetType: "User",
        targetId: user.id,
        reason,
        details: { via: "command line", operator: operator(), email, from: user.role, to: role },
      },
    }),
  ]);
  console.log(role === "OWNER" ? `${email} is now an owner` : `${email} is no longer staff`);
};

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
