import { useDeferredValue, useState } from "react"
import { SearchIcon } from "lucide-react"
import { useSearchParams } from "react-router"
import { usePaystackEvent, usePaystackEvents, type EventFilter } from "@/api/admin"
import { EmptyState, LoadMore, Panel, ToneBadge } from "@/components/admin/admin-ui"
import { formatDateTime, tone } from "@/lib/admin"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { errorMessage } from "@/lib/api"
import { cn } from "@/lib/utils"

const VIEWS = [
  { value: "", label: "All" },
  { value: "false", label: "Not processed" },
  { value: "true", label: "Processed" },
]

export function AdminEventsPage() {
  const [params, setParams] = useSearchParams()
  const processed = params.get("processed") ?? ""
  const [search, setSearch] = useState("")
  const term = useDeferredValue(search.trim())
  const [openId, setOpenId] = useState<string | null>(null)

  const filter: EventFilter = { processed: processed === "" ? undefined : processed === "true", search: term || undefined }
  const query = usePaystackEvents(filter)
  const events = query.data?.pages.flatMap((page) => page.items) ?? []

  return (
    <>
      <Panel
        action={
          <div className="flex w-full flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap gap-2">
              {VIEWS.map((view) => (
                <button
                  key={view.value}
                  type="button"
                  aria-pressed={processed === view.value}
                  onClick={() => setParams(view.value ? { processed: view.value } : {}, { replace: true })}
                  className={cn(
                    "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                    processed === view.value ? "border-primary bg-primary text-primary-foreground" : "border-border text-muted-foreground hover:text-foreground"
                  )}
                >
                  {view.label}
                </button>
              ))}
            </div>
            <div className="relative w-full sm:w-64">
              <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Reference" className="pl-9" aria-label="Search by reference" />
            </div>
          </div>
        }
      >
        {query.error ? (
          <EmptyState>{errorMessage(query.error)}</EmptyState>
        ) : query.isPending ? (
          <div className="flex flex-col gap-3 p-5">
            {Array.from({ length: 5 }, (_, i) => (
              <Skeleton key={i} className="h-6 w-full" />
            ))}
          </div>
        ) : events.length === 0 ? (
          <EmptyState>No Paystack events here.</EmptyState>
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-5">Event</TableHead>
                  <TableHead>Reference</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="pr-5">Received</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {events.map((event) => (
                  <TableRow key={event.id} className="cursor-pointer" onClick={() => setOpenId(event.id)}>
                    <TableCell className="pl-5">
                      <button type="button" className="font-mono text-xs font-medium hover:underline" onClick={() => setOpenId(event.id)}>
                        {event.event}
                      </button>
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">{event.reference ?? "—"}</TableCell>
                    <TableCell>
                      {event.processedAt ? <ToneBadge className={tone.good}>Processed</ToneBadge> : <ToneBadge className={tone.waiting}>Not processed</ToneBadge>}
                    </TableCell>
                    <TableCell className="pr-5 text-muted-foreground">{formatDateTime(event.receivedAt)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <LoadMore hasMore={query.hasNextPage} loading={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()} />
          </>
        )}
      </Panel>
      <EventDialog id={openId} onClose={() => setOpenId(null)} />
    </>
  )
}

function EventDialog({ id, onClose }: { id: string | null; onClose: () => void }) {
  const { data, error } = usePaystackEvent(id)
  return (
    <Dialog open={id !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="font-mono text-base">{data?.event ?? "Event"}</DialogTitle>
          <DialogDescription>
            {data ? `Received ${formatDateTime(data.receivedAt)} · ${data.processedAt ? `processed ${formatDateTime(data.processedAt)}` : "not processed yet"}` : "Loading…"}
          </DialogDescription>
        </DialogHeader>
        {error ? (
          <p className="text-sm text-destructive">{errorMessage(error)}</p>
        ) : !data ? (
          <Skeleton className="h-64 w-full" />
        ) : (
          <pre className="max-h-[60vh] overflow-auto rounded-xl bg-muted p-4 font-mono text-xs leading-relaxed">{JSON.stringify(data.payload, null, 2)}</pre>
        )}
      </DialogContent>
    </Dialog>
  )
}
