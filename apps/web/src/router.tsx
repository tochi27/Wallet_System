import { createBrowserRouter } from "react-router"
import { GuestOnly, RequireAuth } from "@/components/auth/route-guards"
import { AdminLayout } from "@/components/admin/admin-layout"
import { AppShell } from "@/components/layout/app-shell"
import { AuthLayout } from "@/components/layout/auth-layout"
import { AdminAdjustmentsPage } from "@/pages/admin/admin-adjustments-page"
import { AdminAuditLogPage } from "@/pages/admin/admin-audit-log-page"
import { AdminEventsPage } from "@/pages/admin/admin-events-page"
import { AdminLedgerPage } from "@/pages/admin/admin-ledger-page"
import { AdminOverviewPage } from "@/pages/admin/admin-overview-page"
import { AdminPaymentsPage } from "@/pages/admin/admin-payments-page"
import { AdminReconciliationPage } from "@/pages/admin/admin-reconciliation-page"
import { AdminStaffPage } from "@/pages/admin/admin-staff-page"
import { AdminUserPage } from "@/pages/admin/admin-user-page"
import { AdminUsersPage } from "@/pages/admin/admin-users-page"
import { AdminVerificationPage } from "@/pages/admin/admin-verification-page"
import { AdminVerificationsPage } from "@/pages/admin/admin-verifications-page"
import { DepositCallbackPage } from "@/pages/deposit-callback-page"
import { ForgotPasswordPage } from "@/pages/forgot-password-page"
import { HomePage } from "@/pages/home-page"
import { InsightsPage } from "@/pages/insights-page"
import { ReceiptPage } from "@/pages/receipt-page"
import { ResetPasswordPage } from "@/pages/reset-password-page"
import { VerifyEmailPage } from "@/pages/verify-email-page"
import { UpgradePage } from "@/pages/upgrade-page"
import { RouteErrorPage } from "@/pages/route-error-page"
import { SettingsPage } from "@/pages/settings-page"
import { LoginPage } from "@/pages/login-page"
import { NotFoundPage } from "@/pages/not-found-page"
import { SignupPage } from "@/pages/signup-page"
import { WalletPage } from "@/pages/wallet-page"

export const router = createBrowserRouter([
  // Any page that crashes shows a friendly error screen instead of the developer one
  {
    errorElement: <RouteErrorPage />,
    children: [
      {
        element: <GuestOnly />,
        children: [
          {
            element: <AuthLayout />,
            children: [
              { path: "/login", element: <LoginPage /> },
              { path: "/signup", element: <SignupPage /> },
            ],
          },
        ],
      },
      // Not guest-only: a signed-in user can still follow a reset or verification link from their email
      {
        element: <AuthLayout />,
        children: [
          { path: "/forgot-password", element: <ForgotPasswordPage /> },
          { path: "/reset-password", element: <ResetPasswordPage /> },
          { path: "/verify-email", element: <VerifyEmailPage /> },
        ],
      },
      {
        element: <RequireAuth />,
        children: [
          {
            element: <AppShell />,
            children: [
              { path: "/", element: <HomePage /> },
              { path: "/wallet", element: <WalletPage /> },
              { path: "/insights", element: <InsightsPage /> },
              { path: "/deposit/callback", element: <DepositCallbackPage /> },
              { path: "/transactions/:transactionId", element: <ReceiptPage /> },
              { path: "/settings", element: <SettingsPage /> },
              { path: "/settings/upgrade", element: <UpgradePage /> },
              {
                path: "/admin",
                element: <AdminLayout />,
                children: [
                  { index: true, element: <AdminOverviewPage /> },
                  { path: "users", element: <AdminUsersPage /> },
                  { path: "users/:id", element: <AdminUserPage /> },
                  { path: "verifications", element: <AdminVerificationsPage /> },
                  { path: "verifications/:id", element: <AdminVerificationPage /> },
                  { path: "payments", element: <AdminPaymentsPage /> },
                  { path: "events", element: <AdminEventsPage /> },
                  { path: "adjustments", element: <AdminAdjustmentsPage /> },
                  { path: "ledger", element: <AdminLedgerPage /> },
                  { path: "reconciliation", element: <AdminReconciliationPage /> },
                  { path: "staff", element: <AdminStaffPage /> },
                  { path: "audit-log", element: <AdminAuditLogPage /> },
                ],
              },
            ],
          },
        ],
      },
      { path: "*", element: <NotFoundPage /> },
    ],
  },
])
