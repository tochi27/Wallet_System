import { useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { BellIcon } from "lucide-react"
import { useNavigate } from "react-router"
import {
  markAllNotificationsRead,
  markNotificationRead,
  notificationKeys,
  notificationLink,
  useNotifications,
  type Notification,
} from "@/api/account"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { cn } from "@/lib/utils"

const relative = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" })

function timeAgo(iso: string) {
  const seconds = (new Date(iso).getTime() - Date.now()) / 1000
  const steps: [Intl.RelativeTimeFormatUnit, number][] = [
    ["day", 86_400],
    ["hour", 3_600],
    ["minute", 60],
  ]
  for (const [unit, size] of steps) {
    if (Math.abs(seconds) >= size) return relative.format(Math.round(seconds / size), unit)
  }
  return "just now"
}

type NotificationBellProps = {
  // "icon": round icon button (phone header). "sidebar": nav-style row, labelled on wide screens.
  variant?: "icon" | "sidebar"
}

export function NotificationBell({ variant = "icon" }: NotificationBellProps) {
  const [open, setOpen] = useState(false)
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { data } = useNotifications()
  const unread = data?.unreadCount ?? 0

  const refresh = () => queryClient.invalidateQueries({ queryKey: notificationKeys.all })
  const readAll = useMutation({ mutationFn: markAllNotificationsRead, onSuccess: refresh })

  const openNotification = (notification: Notification) => {
    setOpen(false)
    if (!notification.readAt) void markNotificationRead(notification.id).then(refresh)
    navigate(notificationLink(notification))
  }

  const badge = unread > 0 && (
    <span className="absolute -top-0.5 -right-0.5 flex min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] leading-4 font-semibold text-white">
      {unread > 9 ? "9+" : unread}
    </span>
  )
  const label = unread > 0 ? `Notifications, ${unread} unread` : "Notifications"

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        {variant === "icon" ? (
          <Button variant="ghost" size="icon" className="relative rounded-full" aria-label={label}>
            <BellIcon />
            {badge}
          </Button>
        ) : (
          <button
            type="button"
            aria-label={label}
            title="Notifications"
            className="flex h-11 w-full items-center justify-center gap-3 rounded-xl px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground lg:justify-start"
          >
            <span className="relative">
              <BellIcon className="size-5" aria-hidden />
              {badge}
            </span>
            <span className="sr-only lg:not-sr-only">Notifications</span>
          </button>
        )}
      </PopoverTrigger>
      <PopoverContent align={variant === "icon" ? "end" : "start"} side={variant === "icon" ? "bottom" : "right"} className="w-80 p-0">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <p className="text-sm font-semibold">Notifications</p>
          {unread > 0 && (
            <button
              type="button"
              className="text-xs font-medium text-primary hover:underline"
              onClick={() => readAll.mutate()}
              disabled={readAll.isPending}
            >
              Mark all read
            </button>
          )}
        </div>
        <div className="max-h-96 overflow-y-auto">
          {!data || data.items.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-muted-foreground">You're all caught up.</p>
          ) : (
            <ul className="divide-y">
              {data.items.map((notification) => (
                <li key={notification.id}>
                  <button
                    type="button"
                    onClick={() => openNotification(notification)}
                    className={cn(
                      "flex w-full gap-3 px-4 py-3 text-left transition-colors hover:bg-muted",
                      !notification.readAt && "bg-secondary/40"
                    )}
                  >
                    <span
                      className={cn("mt-1.5 size-2 shrink-0 rounded-full", notification.readAt ? "bg-transparent" : "bg-primary")}
                      aria-hidden
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium">{notification.title}</span>
                      {/* Notification text can include user-typed notes; React renders it as plain text */}
                      <span className="line-clamp-2 block text-xs text-muted-foreground">{notification.body}</span>
                      <span className="mt-1 block text-[11px] text-muted-foreground">{timeAgo(notification.createdAt)}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}
