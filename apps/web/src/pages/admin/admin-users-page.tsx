import { useDeferredValue, useState } from "react"
import { SearchIcon } from "lucide-react"
import { Link } from "react-router"
import { useAdminUsers } from "@/api/admin"
import { EmptyState, LoadMore, Panel, ToneBadge } from "@/components/admin/admin-ui"
import { formatDateTime, tone } from "@/lib/admin"
import { Money } from "@/components/money"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { errorMessage } from "@/lib/api"
import { ROLE_INFO } from "@/lib/permissions"

export function AdminUsersPage() {
  const [search, setSearch] = useState("")
  // Don't refetch on every keystroke while typing quickly
  const term = useDeferredValue(search.trim())
  const { data, error, isPending, hasNextPage, fetchNextPage, isFetchingNextPage } = useAdminUsers(term)
  const users = data?.pages.flatMap((page) => page.items) ?? []

  return (
    <Panel
      title="Users"
      action={
        <div className="relative w-full sm:w-72">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Name, email or user ID"
            className="pl-9"
            aria-label="Search users"
          />
        </div>
      }
    >
      {error ? (
        <EmptyState>{errorMessage(error)}</EmptyState>
      ) : isPending ? (
        <div className="flex flex-col gap-3 p-5">
          {Array.from({ length: 5 }, (_, i) => (
            <Skeleton key={i} className="h-6 w-full" />
          ))}
        </div>
      ) : users.length === 0 ? (
        <EmptyState>No users match “{term}”.</EmptyState>
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-5">User</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Balance</TableHead>
                <TableHead className="hidden pr-5 md:table-cell">Joined</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map((user) => (
                <TableRow key={user.id} className="relative">
                  <TableCell className="pl-5">
                    <Link to={`/admin/users/${user.id}`} className="font-medium after:absolute after:inset-0 hover:underline">
                      {user.name}
                    </Link>
                    <span className="block text-xs text-muted-foreground">{user.email}</span>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {user.frozenAt ? <ToneBadge className={tone.bad}>Frozen</ToneBadge> : <ToneBadge className={tone.good}>Active</ToneBadge>}
                      {user.role !== "USER" && <ToneBadge className={tone.quiet}>{ROLE_INFO[user.role].label}</ToneBadge>}
                    </div>
                  </TableCell>
                  <TableCell className="text-right font-medium tabular-nums">
                    <Money value={user.balance} />
                  </TableCell>
                  <TableCell className="hidden pr-5 text-muted-foreground md:table-cell">{formatDateTime(user.createdAt)}</TableCell>
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
