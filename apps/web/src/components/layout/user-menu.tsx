import { ChevronsUpDownIcon, LogOutIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useAuth } from "@/lib/auth-context"
import { useTheme, type Theme } from "@/lib/theme-context"
import { cn } from "@/lib/utils"

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("")
}

type UserMenuProps = {
  // "header": avatar only (phones). "sidebar": avatar, plus name and email when the sidebar is wide.
  variant?: "header" | "sidebar"
}

export function UserMenu({ variant = "header" }: UserMenuProps) {
  const { user, signOut } = useAuth()
  const { theme, setTheme } = useTheme()

  if (!user) return null
  const sidebar = variant === "sidebar"

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          className={cn(
            sidebar ? "h-auto w-full justify-center gap-3 rounded-xl p-2 lg:justify-start" : "size-9 rounded-full p-0"
          )}
          aria-label="Account menu"
        >
          <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-semibold text-secondary-foreground">
            {initials(user.name)}
          </span>
          {sidebar && (
            <>
              <span className="hidden min-w-0 flex-1 text-left lg:block">
                <span className="block truncate text-sm font-medium">{user.name}</span>
                <span className="block truncate text-xs font-normal text-muted-foreground">{user.email}</span>
              </span>
              <ChevronsUpDownIcon className="hidden text-muted-foreground lg:block" aria-hidden />
            </>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align={sidebar ? "start" : "end"} side={sidebar ? "top" : "bottom"} className="w-60">
        <DropdownMenuLabel className="font-normal">
          <div className="truncate font-medium text-foreground">{user.name}</div>
          <div className="truncate text-xs text-muted-foreground">{user.email}</div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-xs text-muted-foreground">Theme</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={theme} onValueChange={(value) => setTheme(value as Theme)}>
          <DropdownMenuRadioItem value="light">Light</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="dark">Dark</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="system">System</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => void signOut()}>
          <LogOutIcon aria-hidden />
          Log out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
