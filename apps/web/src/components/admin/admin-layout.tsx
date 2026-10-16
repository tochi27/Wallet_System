import { Navigate, NavLink, Outlet } from "react-router"
import { ShieldCheckIcon } from "lucide-react"
import { useAuth } from "@/lib/auth-context"
import { can, isStaff, type Permission } from "@/lib/permissions"
import { cn } from "@/lib/utils"

const TABS: { to: string; label: string; end: boolean; permission?: Permission }[] = [
  { to: "/admin", label: "Overview", end: true },
  { to: "/admin/users", label: "Users", end: false },
  // ID documents are only for staff who review them
  { to: "/admin/verifications", label: "ID checks", end: false, permission: "kyc.review" },
  { to: "/admin/payments", label: "Payments", end: false },
  { to: "/admin/events", label: "Paystack events", end: false },
  { to: "/admin/adjustments", label: "Adjustments", end: false },
  { to: "/admin/ledger", label: "Ledger", end: false },
  { to: "/admin/reconciliation", label: "Reconciliation", end: false },
  { to: "/admin/staff", label: "Staff", end: false },
  { to: "/admin/audit-log", label: "Audit log", end: false },
]

// Admin pages. Hiding them is only a convenience: the API refuses non-admins whatever the UI does.
export function AdminLayout() {
  const { user } = useAuth()
  if (!isStaff(user?.role)) return <Navigate to="/" replace />

  return (
    <div className="flex flex-col gap-6">
      <div>
        <p className="flex items-center gap-1.5 text-xs font-semibold tracking-wider text-primary uppercase">
          <ShieldCheckIcon className="size-3.5" aria-hidden />
          Admin
        </p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight md:text-3xl">Operations</h1>
      </div>
      <nav className="-mx-4 overflow-x-auto px-4 md:mx-0 md:px-0" aria-label="Admin">
        <div className="flex w-max gap-1 rounded-full bg-muted p-1">
          {TABS.filter((tab) => !tab.permission || can(user?.role, tab.permission)).map((tab) => (
            <NavLink
              key={tab.to}
              to={tab.to}
              end={tab.end}
              className={({ isActive }) =>
                cn(
                  "rounded-full px-4 py-1.5 text-sm font-medium whitespace-nowrap transition-colors",
                  isActive ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                )
              }
            >
              {tab.label}
            </NavLink>
          ))}
        </div>
      </nav>
      <Outlet />
    </div>
  )
}
