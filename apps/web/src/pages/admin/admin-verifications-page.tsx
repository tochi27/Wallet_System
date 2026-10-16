import { useState } from "react"
import { Link, Navigate } from "react-router"
import { ID_TYPES, type UpgradeStatus } from "@/api/account"
import { useVerifications } from "@/api/admin"
import { EmptyState, LoadMore, Panel, ToneBadge } from "@/components/admin/admin-ui"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { formatDateTime, verificationLabel, verificationTone } from "@/lib/admin"
import { errorMessage } from "@/lib/api"
import { useAuth } from "@/lib/auth-context"
import { can } from "@/lib/permissions"
import { cn } from "@/lib/utils"

const FILTERS: { status: UpgradeStatus; label: string }[] = [
  { status: "PENDING", label: "Waiting" },
  { status: "APPROVED", label: "Approved" },
  { status: "REJECTED", label: "Rejected" },
]

// ID checks for Tier 2. Waiting ones are oldest first, so nobody waits longest by accident.
export function AdminVerificationsPage() {
  const { user: me } = useAuth()
  const [status, setStatus] = useState<UpgradeStatus>("PENDING")
  const { data, error, isPending, hasNextPage, fetchNextPage, isFetchingNextPage } = useVerifications(status)
  const items = data?.pages.flatMap((page) => page.items) ?? []

  if (!can(me?.role, "kyc.review")) return <Navigate to="/admin" replace />

  return (
    <Panel
      title="ID checks"
      action={
        <div className="flex gap-1 rounded-full bg-muted p-1" role="group" aria-label="Show">
          {FILTERS.map((filter) => (
            <button
              key={filter.status}
              type="button"
              aria-pressed={status === filter.status}
              onClick={() => setStatus(filter.status)}
              className={cn(
                "rounded-full px-3 py-1.5 text-sm font-medium transition-colors",
                status === filter.status ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
              )}
            >
              {filter.label}
            </button>
          ))}
        </div>
      }
    >
      {error ? (
        <EmptyState>{errorMessage(error)}</EmptyState>
      ) : isPending ? (
        <div className="flex flex-col gap-3 p-5">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-6 w-full" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <EmptyState>{status === "PENDING" ? "No ID checks waiting. You're all caught up." : "None yet."}</EmptyState>
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-5">User</TableHead>
                <TableHead>ID</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="hidden pr-5 md:table-cell">{status === "PENDING" ? "Sent" : "Reviewed"}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item) => (
                <TableRow key={item.id} className="relative">
                  <TableCell className="pl-5">
                    <Link to={`/admin/verifications/${item.id}`} className="font-medium after:absolute after:inset-0 hover:underline">
                      {item.user.name}
                    </Link>
                    <span className="block text-xs text-muted-foreground">{item.user.email}</span>
                  </TableCell>
                  <TableCell>
                    {ID_TYPES[item.idType].label}
                    <span className="block font-mono text-xs text-muted-foreground">••••{item.idNumberLast4}</span>
                  </TableCell>
                  <TableCell>
                    <ToneBadge className={verificationTone[item.status]}>{verificationLabel[item.status]}</ToneBadge>
                    {item.reviewedBy && <span className="mt-1 block text-xs text-muted-foreground">by {item.reviewedBy.name}</span>}
                  </TableCell>
                  <TableCell className="hidden pr-5 text-muted-foreground md:table-cell">
                    {formatDateTime(status === "PENDING" ? item.createdAt : (item.reviewedAt ?? item.createdAt))}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <LoadMore hasMore={hasNextPage} loading={isFetchingNextPage} onClick={() => void fetchNextPage()} />
        </>
      )}
    </Panel>
  )
}
