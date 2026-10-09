import { createBrowserRouter } from "react-router"
import { GuestOnly, RequireAuth } from "@/components/auth/route-guards"
import { AppShell } from "@/components/layout/app-shell"
import { AuthLayout } from "@/components/layout/auth-layout"
import { DepositCallbackPage } from "@/pages/deposit-callback-page"
import { HomePage } from "@/pages/home-page"
import { LoginPage } from "@/pages/login-page"
import { NotFoundPage } from "@/pages/not-found-page"
import { SignupPage } from "@/pages/signup-page"
import { WalletPage } from "@/pages/wallet-page"

export const router = createBrowserRouter([
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
  {
    element: <RequireAuth />,
    children: [
      {
        element: <AppShell />,
        children: [
          { path: "/", element: <HomePage /> },
          { path: "/wallet", element: <WalletPage /> },
          { path: "/deposit/callback", element: <DepositCallbackPage /> },
        ],
      },
    ],
  },
  { path: "*", element: <NotFoundPage /> },
])
