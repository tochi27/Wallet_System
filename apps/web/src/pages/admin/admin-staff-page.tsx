import { useDeferredValue, useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { AlertCircleIcon, Loader2Icon, UserPlusIcon } from "lucide-react"
import { toast } from "sonner"
import { adminKeys, setStaffRole, useAdminUsers, useStaff } from "@/api/admin"
import { EmptyState, Panel, ToneBadge } from "@/components/admin/admin-ui"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { Textarea } from "@/components/ui/textarea"
import { tone } from "@/lib/admin"
import { errorMessage } from "@/lib/api"
import { useAuth } from "@/lib/auth-context"
import { can, ROLE_INFO, STAFF_ROLES, type Role } from "@/lib/permissions"

type Target = { id: string; name: string; email: string; role: Role }

export function AdminStaffPage() {
  const { user: me } = useAuth()
  const { data: staff, isPending, error } = useStaff()
  const [target, setTarget] = useState<Target | null>(null)
  const [adding, setAdding] = useState(false)
  const isOwner = can(me?.role, "staff.manage")

  return (
    <div className="flex flex-col gap-5">
      <Panel
        title="Staff"
        action={
          isOwner && (
            <Button size="sm" className="rounded-full" onClick={() => setAdding(true)}>
              <UserPlusIcon aria-hidden />
              Add staff
            </Button>
          )
        }
      >
        {error ? (
          <EmptyState>{errorMessage(error)}</EmptyState>
        ) : isPending ? (
          <div className="p-5">
            <Skeleton className="h-6 w-full" />
          </div>
        ) : staff.length === 0 ? (
          <EmptyState>No staff yet.</EmptyState>
        ) : (
          <ul className="divide-y divide-border/70">
            {staff.map((member) => (
              <li key={member.id} className="flex flex-wrap items-center gap-3 px-5 py-3.5">
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">
                    {member.name}
                    {member.id === me?.id && <span className="font-normal text-muted-foreground"> (you)</span>}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">{member.email}</span>
                </span>
                <ToneBadge className={member.role === "OWNER" ? tone.good : tone.quiet}>{ROLE_INFO[member.role].label}</ToneBadge>
                {isOwner && member.id !== me?.id && (
                  <Button size="sm" variant="outline" className="rounded-full" onClick={() => setTarget(member)}>
                    Change role
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title="What each role can do">
        <ul className="divide-y divide-border/70 text-sm">
          {STAFF_ROLES.map((role) => (
            <li key={role} className="flex gap-4 px-5 py-3">
              <span className="w-20 shrink-0 font-medium">{ROLE_INFO[role].label}</span>
              <span className="text-muted-foreground">{ROLE_INFO[role].description}</span>
            </li>
          ))}
        </ul>
      </Panel>

      {adding && <FindUserDialog onPick={(user) => { setAdding(false); setTarget(user) }} onClose={() => setAdding(false)} />}
      {target && <RoleDialog target={target} onClose={() => setTarget(null)} />}
    </div>
  )
}

function FindUserDialog({ onPick, onClose }: { onPick: (user: Target) => void; onClose: () => void }) {
  const [search, setSearch] = useState("")
  const term = useDeferredValue(search.trim())
  const { data } = useAdminUsers(term)
  const users = term.length >= 2 ? (data?.pages.flatMap((p) => p.items) ?? []).filter((u) => u.role === "USER").slice(0, 6) : []

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add staff</DialogTitle>
          <DialogDescription>Find the person by name or email. They need a PurpleWallet account first.</DialogDescription>
        </DialogHeader>
        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Name or email" autoFocus aria-label="Find a user" />
        <ul className="flex flex-col gap-1">
          {users.map((u) => (
            <li key={u.id}>
              <button type="button" onClick={() => onPick(u)} className="w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-muted">
                <span className="block font-medium">{u.name}</span>
                <span className="block text-xs text-muted-foreground">{u.email}</span>
              </button>
            </li>
          ))}
          {term.length >= 2 && users.length === 0 && <li className="px-3 py-2 text-sm text-muted-foreground">No customers match.</li>}
        </ul>
      </DialogContent>
    </Dialog>
  )
}

function RoleDialog({ target, onClose }: { target: Target; onClose: () => void }) {
  const queryClient = useQueryClient()
  const [role, setRole] = useState<Role>(target.role === "USER" ? "VIEWER" : target.role)
  const [reason, setReason] = useState("")
  const [password, setPassword] = useState("")

  const mutation = useMutation({
    mutationFn: () => setStaffRole(target.id, role, reason.trim(), password),
    onSuccess: (updated) => {
      void queryClient.invalidateQueries({ queryKey: adminKeys.all })
      toast.success(updated.role === "USER" ? `${target.name} is no longer staff` : `${target.name} is now ${ROLE_INFO[updated.role].label}`)
      onClose()
    },
  })
  const ready = role !== target.role && reason.trim().length >= 3 && password.length > 0

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{target.role === "USER" ? `Make ${target.name.split(" ")[0]} staff` : `Change ${target.name.split(" ")[0]}'s role`}</DialogTitle>
          <DialogDescription>{target.email}</DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            if (ready) mutation.mutate()
          }}
        >
          {mutation.isError && (
            <Alert variant="destructive">
              <AlertCircleIcon aria-hidden />
              <AlertDescription>{errorMessage(mutation.error)}</AlertDescription>
            </Alert>
          )}
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-sm font-medium">Role</legend>
            {[...STAFF_ROLES, ...(target.role !== "USER" ? (["USER"] as const) : [])].map((r) => (
              <label key={r} className="flex cursor-pointer items-start gap-3 rounded-xl border p-3 has-checked:border-primary has-checked:bg-primary/5">
                <input type="radio" name="role" value={r} checked={role === r} onChange={() => setRole(r)} className="mt-1 accent-primary" />
                <span>
                  <span className="block text-sm font-medium">{r === "USER" ? "Remove staff access" : ROLE_INFO[r].label}</span>
                  <span className="block text-xs text-muted-foreground">{ROLE_INFO[r].description}</span>
                </span>
              </label>
            ))}
          </fieldset>
          <Field>
            <FieldLabel htmlFor="role-reason">Reason</FieldLabel>
            <Textarea id="role-reason" rows={2} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Joined the support team" />
            <FieldDescription>Recorded in the audit log.</FieldDescription>
          </Field>
          <Field>
            <FieldLabel htmlFor="role-password">Your password</FieldLabel>
            <Input id="role-password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={!ready || mutation.isPending}>
              {mutation.isPending && <Loader2Icon className="animate-spin" aria-hidden />}
              Save role
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
