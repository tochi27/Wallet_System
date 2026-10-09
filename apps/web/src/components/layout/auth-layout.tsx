import { Outlet } from "react-router"
import { Brand } from "@/components/layout/brand"

export function AuthLayout() {
  return (
    <div className="page-glow flex min-h-svh flex-col items-center justify-center gap-6 px-4 py-10">
      <Brand />
      <div className="w-full max-w-sm">
        <Outlet />
      </div>
    </div>
  )
}
