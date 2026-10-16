import { useDeferredValue, useState } from "react"
import { useMutation, useQueryClient, type InfiniteData, type UseInfiniteQueryResult } from "@tanstack/react-query"
import { Loader2Icon, RefreshCwIcon, SearchIcon } from "lucide-react"
import { Link, useSearchParams } from "react-router"
import { toast } from "sonner"
import {
  adminKeys,
  recheckPayment,
  useAdminDeposits,
  useAdminWithdrawals,
  type AdminDeposit,
  type AdminWithdrawal,
  type Page,
  type PaymentFilter,
} from "@/api/admin"
import { EmptyState, LoadMore, PaymentBadge, Panel } from "@/components/admin/admin-ui"
import { formatDateTime } from "@/lib/admin"
import { Money } from "@/components/money"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { errorMessage } from "@/lib/api"
import { useAuth } from "@/lib/auth-context"
import { can } from "@/lib/permissions"
import { cn } from "@/lib/utils"

type Kind = "deposits" | "withdrawals"

const FILTERS: Record<Kind, { value: string; label: string }[]> = {
  deposits: [
    { value: "", label: "All" },
    { value: "stuck", label: "Stuck" },
    { value: "PENDING", label: "Pending" },
    { value: "SUCCESSFUL", label: "Successful" },
    { value: "FAILED", label: "Failed" },
    { value: "ABANDONED", label: "Abandoned" },
  ],
  withdrawals: [
    { value: "", label: "All" },
    { value: "stuck", label: "Stuck" },
    { value: "PROCESSING", label: "Processing" },
    { value: "SUCCESSFUL", label: "Successful" },
    { value: "FAILED", label: "Failed" },
    { value: "REVERSED", label: "Reversed" },
  ],
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
        active ? "border-primary bg-primary text-primary-foreground" : "border-border text-muted-foreground hover:text-foreground"
      )}
    >
      {children}
    </button>
  )
}

export function AdminPaymentsPage() {
  // Filters live in the URL so the Overview's "needs attention" links land on the right view
  const [params, setParams] = useSearchParams()
  const kind: Kind = params.get("tab") === "withdrawals" ? "withdrawals" : "deposits"
  const filterValue = params.get("stuck") === "true" ? "stuck" : (params.get("status") ?? "")
  const [search, setSearch] = useState("")
  const term = useDeferredValue(search.trim())

  const setView = (nextKind: Kind, nextFilter: string) => {
    const next = new URLSearchParams({ tab: nextKind })
    if (nextFilter === "stuck") next.set("stuck", "true")
    else if (nextFilter) next.set("status", nextFilter)
    setParams(next, { replace: true })
  }

  const filter: PaymentFilter = {
    stuck: filterValue === "stuck" || undefined,
    status: filterValue && filterValue !== "stuck" ? filterValue : undefined,
    search: term || undefined,
  }

  return (
    <Panel
      action={
        <div className="flex w-full flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex gap-1 rounded-full bg-muted p-1">
              {(["deposits", "withdrawals"] as const).map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setView(k, "")}
                  className={cn(
                    "rounded-full px-4 py-1.5 text-sm font-medium capitalize",
                    kind === k ? "bg-card shadow-sm" : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {k}
                </button>
              ))}
            </div>
            <div className="relative w-full sm:w-64">
              <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Reference" className="pl-9" aria-label="Search by reference" />
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {FILTERS[kind].map((f) => (
              <Chip key={f.value} active={filterValue === f.value} onClick={() => setView(kind, f.value)}>
                {f.label}
              </Chip>
            ))}
          </div>
        </div>
      }
    >
      {kind === "deposits" ? <DepositsTable filter={filter} /> : <WithdrawalsTable filter={filter} />}
    </Panel>
  )
}

function useRecheck(kind: Kind) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (reference: string) => recheckPayment(kind, reference),
    onSuccess: (result) => {
      toast.success(
        result.before === result.after
          ? `${result.reference}: still ${result.after.toLowerCase()}`
          : `${result.reference}: ${result.before.toLowerCase()} → ${result.after.toLowerCase()}`
      )
      void queryClient.invalidateQueries({ queryKey: adminKeys.all })
    },
    onError: (error) => toast.error(errorMessage(error)),
  })
}

function RecheckButton({ kind, reference }: { kind: Kind; reference: string }) {
  const recheck = useRecheck(kind)
  const { user } = useAuth()
  if (!can(user?.role, "payments.recheck")) return null
  return (
    <Button variant="outline" size="sm" className="rounded-full" disabled={recheck.isPending} onClick={() => recheck.mutate(reference)}>
      {recheck.isPending ? <Loader2Icon className="animate-spin" aria-hidden /> : <RefreshCwIcon aria-hidden />}
      Recheck
    </Button>
  )
}

function Rows<T>({ query, render }: { query: UseInfiniteQueryResult<InfiniteData<Page<T>>>; render: (items: T[]) => React.ReactNode }) {
  if (query.error) return <EmptyState>{errorMessage(query.error)}</EmptyState>
  if (query.isPending)
    return (
      <div className="flex flex-col gap-3 p-5">
        {Array.from({ length: 5 }, (_, i) => (
          <Skeleton key={i} className="h-6 w-full" />
        ))}
      </div>
    )
  const items = query.data?.pages.flatMap((page) => page.items) ?? []
  if (items.length === 0) return <EmptyState>Nothing here.</EmptyState>
  return (
    <>
      {render(items)}
      <LoadMore hasMore={query.hasNextPage} loading={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()} />
    </>
  )
}

function UserCell({ user }: { user: { id: string; name: string; email: string } }) {
  return (
    <Link to={`/admin/users/${user.id}`} className="hover:underline">
      <span className="block font-medium">{user.name}</span>
      <span className="block text-xs text-muted-foreground">{user.email}</span>
    </Link>
  )
}

function DepositsTable({ filter }: { filter: PaymentFilter }) {
  const query = useAdminDeposits(filter)
  return (
    <Rows<AdminDeposit>
      query={query}
      render={(items) => (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="pl-5">User</TableHead>
              <TableHead>Reference</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead className="hidden lg:table-cell">Started</TableHead>
              <TableHead className="pr-5" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((d) => (
              <TableRow key={d.id}>
                <TableCell className="pl-5">
                  <UserCell user={d.user} />
                </TableCell>
                <TableCell className="font-mono text-xs">{d.reference}</TableCell>
                <TableCell>
                  <PaymentBadge status={d.status} />
                  {d.failureReason && <span className="mt-1 block text-xs text-muted-foreground">{d.failureReason}</span>}
                </TableCell>
                <TableCell className="text-right font-medium tabular-nums">
                  <Money value={d.amount} />
                </TableCell>
                <TableCell className="hidden text-muted-foreground lg:table-cell">{formatDateTime(d.createdAt)}</TableCell>
                <TableCell className="pr-5 text-right">{d.status === "PENDING" && <RecheckButton kind="deposits" reference={d.reference} />}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    />
  )
}

function WithdrawalsTable({ filter }: { filter: PaymentFilter }) {
  const query = useAdminWithdrawals(filter)
  return (
    <Rows<AdminWithdrawal>
      query={query}
      render={(items) => (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="pl-5">User</TableHead>
              <TableHead>To</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead className="hidden lg:table-cell">Started</TableHead>
              <TableHead className="pr-5" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((w) => (
              <TableRow key={w.id}>
                <TableCell className="pl-5">
                  <UserCell user={w.user} />
                </TableCell>
                <TableCell>
                  <span className="block">
                    {w.bankAccount.bankName} ····{w.bankAccount.accountNumberLast4}
                  </span>
                  <span className="block font-mono text-xs text-muted-foreground">{w.reference}</span>
                </TableCell>
                <TableCell>
                  <PaymentBadge status={w.status} />
                  {w.failureReason && <span className="mt-1 block text-xs text-muted-foreground">{w.failureReason}</span>}
                </TableCell>
                <TableCell className="text-right font-medium tabular-nums">
                  <Money value={w.amount} />
                </TableCell>
                <TableCell className="hidden text-muted-foreground lg:table-cell">{formatDateTime(w.createdAt)}</TableCell>
                <TableCell className="pr-5 text-right">{w.status === "PROCESSING" && <RecheckButton kind="withdrawals" reference={w.reference} />}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    />
  )
}
