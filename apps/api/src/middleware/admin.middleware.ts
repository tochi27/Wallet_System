import { Request, Response, NextFunction } from "express";
import { can, isStaff, type Permission } from "../services/admin/permissions";
import { errorResponse } from "../utils/response.utils";

// Runs after authenticate, which reads the role from the database on every request
export const requireAdmin = (req: Request, res: Response, next: NextFunction) => {
  if (!isStaff(req.userRole)) return errorResponse(res, "Admins only", 403);
  next();
};

/** Only staff whose role includes `permission`. */
export const requirePermission = (permission: Permission) => (req: Request, res: Response, next: NextFunction) => {
  if (!can(req.userRole, permission)) return errorResponse(res, "Your admin role doesn't allow this", 403);
  next();
};
