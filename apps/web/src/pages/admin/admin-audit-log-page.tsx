import { Link } from "react-router"
import { useAuditLog, type AuditEntry } from "@/api/admin"
import { EmptyState, LoadMore, Panel } from "@/components/admin/admin-ui"
import { actionLabel, actorName, formatDateTime } from "@/lib/admin"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { errorMessage } from "@/lib/api"

function Target({ entry }: { entry: AuditEntry }) {
  if (entry.targetType === "User") {
    return (
      <Link to={`/admin/users/${entry.targetId}`} className="block hover:underline">
        {entry.targetUser ? (
          <>
            <span className="block font-medium">{entry.targetUser.name}</span>
            <span className="block text-xs text-muted-foreground">{entry.targetUser.email}</span>
          </>
        ) : (
          <span className="font-mono text-xs">{entry.targetId.slice(0, 8)}…</span>
        )}
      </Link>
    )
  }
  const reference = typeof entry.details?.reference === "string" ? entry.details.reference : entry.targetId
  return <span className="font-mono text-xs">{reference}</span>
}

export function AdminAuditLogPage() {
  const { data, error, isPending, hasNextPage, fetchNextPage, isFetchingNextPage } = useAuditLog()
  const entries = data?.pages.flatMap((page) => page.items) ?? []

  return (
    <Panel title="Audit log" action={<span className="text-xs text-muted-foreground">Permanent: entries can't be edited or deleted</span>}>
      {error ? (
        <EmptyState>{errorMessage(error)}</EmptyState>
      ) : isPending ? (
        <div className="flex flex-col gap-3 p-5">
          {Array.from({ length: 5 }, (_, i) => (
            <Skeleton key={i} className="h-6 w-full" />
          ))}
        </div>
      ) : entries.length === 0 ? (
        <EmptyState>No admin actions yet.</EmptyState>
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-5">When</TableHead>
                <TableHead>Admin</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Target</TableHead>
                <TableHead className="pr-5">Reason</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {entries.map((entry) => (
                <TableRow key={entry.id}>
                  <TableCell className="pl-5 whitespace-nowrap text-muted-foreground">{formatDateTime(entry.createdAt)}</TableCell>
                  <TableCell>{actorName(entry.admin)}</TableCell>
                  <TableCell className="font-medium whitespace-nowrap">
                    {actionLabel(entry.action)}
                    {typeof entry.details?.before === "string" && (
                      <span className="block text-xs font-normal text-muted-foreground">
                        {String(entry.details.before).toLowerCase()} → {String(entry.details.after).toLowerCase()}
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Target entry={entry} />
                  </TableCell>
                  <TableCell className="max-w-xs pr-5 whitespace-normal text-muted-foreground">{entry.reason}</TableCell>
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
