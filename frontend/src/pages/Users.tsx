import { useMemo, useState, type ReactNode } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { cn } from '@/lib/cn'
import { ShieldCheck, Plus, Pencil, UserCheck, UserX, KeyRound, RotateCcw, Trash2, Shield, Users as UsersIcon, Copy } from 'lucide-react'
import type { Id, User } from '@/types/domain'
import {
  ACTIONS,
  MODULES,
  effectivePermissions,
  permits,
  type Action,
  type Module,
  type PermissionSet,
  type RoleDef,
  type RoleId,
} from '@/types/rbac'
import { useStore, currentUser } from '@/store'
import { values } from '@/store/normalized'
import {
  runCreateUser,
  runUpdateUser,
  runToggleUserActive,
  runSetUserOverride,
  diffOverride,
} from '@/store/userCommands'
import {
  runCreateRole,
  runUpdateRolePermissions,
  runRenameRole,
  runDeleteRole,
  runResetRole,
} from '@/store/roleCommands'
import { useCan } from '@/hooks/useCan'
import { toastCommandError, toastCommandSuccess } from '@/lib/commandToast'
import { Badge, Button, Card, Drawer, EmptyState, SearchableDropdown, type BadgeTone } from '@/components/ui'

const BUILTIN_TONE: Record<string, BadgeTone> = { admin: 'primary', manager: 'success', operator: 'muted' }
function roleTone(role: RoleDef | undefined): BadgeTone {
  if (!role) return 'muted'
  return role.builtIn ? BUILTIN_TONE[role.id] ?? 'muted' : 'warning'
}
function permCount(p: PermissionSet): number {
  let n = 0
  for (const m of MODULES) for (const a of ACTIONS) if (permits(p, m, a)) n++
  return n
}
function gridToPermissions(grid: Set<string>): PermissionSet {
  const out: PermissionSet = {}
  for (const m of MODULES) {
    const acts = ACTIONS.filter((a) => grid.has(`${m}:${a}`))
    if (acts.length) out[m] = acts
  }
  return out
}

interface UnitOpt { id: Id; code: string; name: string }
type Tab = 'users' | 'roles'

export default function Users() {
  const [tab, setTab] = useState<Tab>('users')
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold tracking-tight">Users &amp; roles</h1>
        <p className="mt-0.5 text-[13px] text-muted-fg">
          Accounts, role presets &amp; custom roles, unit access and per-user permission overrides.
        </p>
      </div>

      <div className="flex gap-1 border-b border-border">
        <TabButton active={tab === 'users'} onClick={() => setTab('users')} icon={<UsersIcon size={14} />}>Users</TabButton>
        <TabButton active={tab === 'roles'} onClick={() => setTab('roles')} icon={<Shield size={14} />}>Roles</TabButton>
      </div>

      {tab === 'users' ? <UsersTab /> : <RolesTab />}
    </div>
  )
}

function TabButton({ active, onClick, icon, children }: { active: boolean; onClick: () => void; icon: ReactNode; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-[13px] font-medium transition ${
        active ? 'border-primary text-primary' : 'border-transparent text-muted-fg hover:text-fg'
      }`}
      aria-current={active ? 'page' : undefined}
    >
      {icon}
      {children}
    </button>
  )
}

// ── Users tab ────────────────────────────────────────────────────────────────
function UsersTab() {
  const can = useCan()
  const me = useStore(currentUser)
  const users = useStore(useShallow((s) => values(s.masters.users)))
  const rolesById = useStore((s) => s.masters.roles.byId)
  const unitsById = useStore((s) => s.masters.units.byId)
  const unitOpts = useStore(
    useShallow((s) => values(s.masters.units).filter((u) => u.active).map((u): UnitOpt => ({ id: u.id, code: u.code, name: u.name })))
  )
  const [form, setForm] = useState<{ user: User | null } | null>(null)
  const [permsUser, setPermsUser] = useState<User | null>(null)

  const canCreate = can('users', 'create')
  const canEdit = can('users', 'edit')

  function unitsLabel(u: User): string {
    if (u.role === 'admin') return 'All units'
    return u.assignedUnitIds.map((id) => unitsById[id]?.code ?? id).join(', ') || '—'
  }

  function onToggle(u: User) {
    try {
      const res = runToggleUserActive(u.id)
      toastCommandSuccess(res.data.active ? 'User activated' : 'User deactivated', res.cascade)
    } catch (e) {
      toastCommandError(e)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        {canCreate ? (
          <Button leftIcon={<Plus size={15} />} onClick={() => setForm({ user: null })}>New user</Button>
        ) : null}
      </div>

      {users.length === 0 ? (
        <Card><EmptyState icon={ShieldCheck} title="No users" description="Create the first user account." action={canCreate ? <Button leftIcon={<Plus size={15} />} onClick={() => setForm({ user: null })}>New user</Button> : undefined} /></Card>
      ) : (
        <Card className="overflow-x-auto p-0">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-border bg-muted text-left text-[10.5px] uppercase tracking-wide text-muted-fg">
                <th scope="col" className="px-3 py-2.5 font-semibold">Name</th>
                <th scope="col" className="px-3 py-2.5 font-semibold">Email</th>
                <th scope="col" className="px-3 py-2.5 font-semibold">Role</th>
                <th scope="col" className="px-3 py-2.5 font-semibold">Units</th>
                <th scope="col" className="px-3 py-2.5 font-semibold">Status</th>
                <th scope="col" className="px-3 py-2.5 text-right"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => {
                const isSelf = me?.id === u.id
                const role = rolesById[u.role]
                const hasOverride = !!u.overrides && (!!u.overrides.add || !!u.overrides.remove)
                return (
                  <tr key={u.id} className="border-b border-border/60 hover:bg-muted/40">
                    <td className="px-3 py-2.5 font-medium">{u.name}{isSelf ? <span className="ml-1.5 text-[10px] text-faint">(you)</span> : null}</td>
                    <td className="px-3 py-2.5 text-muted-fg">{u.email}</td>
                    <td className="px-3 py-2.5">
                      <Badge tone={roleTone(role)}>{role?.name ?? u.role}</Badge>
                      {hasOverride ? <span className="ml-1.5 text-[10px] text-warning">custom</span> : null}
                    </td>
                    <td className="px-3 py-2.5 text-muted-fg">{unitsLabel(u)}</td>
                    <td className="px-3 py-2.5">
                      <Badge tone={u.active ? 'success' : 'danger'}>{u.active ? 'Active' : 'Inactive'}</Badge>
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center justify-end gap-1">
                        {canEdit && u.role !== 'admin' ? (
                          <button type="button" className="btn btn-ghost h-8 w-8 p-0" aria-label={`Permissions for ${u.name}`} title="Permissions" onClick={() => setPermsUser(u)}>
                            <KeyRound size={15} />
                          </button>
                        ) : null}
                        {canEdit ? (
                          <button type="button" className="btn btn-ghost h-8 w-8 p-0" aria-label={`Edit ${u.name}`} onClick={() => setForm({ user: u })}>
                            <Pencil size={15} />
                          </button>
                        ) : null}
                        {canEdit ? (
                          <button
                            type="button"
                            className={`btn btn-ghost h-8 w-8 p-0 ${u.active ? 'text-danger' : 'text-success'} disabled:opacity-40`}
                            aria-label={u.active ? `Deactivate ${u.name}` : `Activate ${u.name}`}
                            title={isSelf && u.active ? 'You cannot deactivate yourself' : u.active ? 'Deactivate' : 'Activate'}
                            disabled={isSelf && u.active}
                            onClick={() => onToggle(u)}
                          >
                            {u.active ? <UserX size={15} /> : <UserCheck size={15} />}
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </Card>
      )}

      {form !== null ? (
        <UserFormDrawer key={form.user?.id ?? '__new__'} user={form.user} unitOpts={unitOpts} onClose={() => setForm(null)} />
      ) : null}

      {permsUser ? (
        <PermissionDrawer key={permsUser.id} user={permsUser} onClose={() => setPermsUser(null)} />
      ) : null}
    </div>
  )
}

function UserFormDrawer({ user, unitOpts, onClose }: { user: User | null; unitOpts: UnitOpt[]; onClose: () => void }) {
  const roles = useStore(useShallow((s) => values(s.masters.roles)))
  const [name, setName] = useState(user?.name ?? '')
  const [email, setEmail] = useState(user?.email ?? '')
  const [role, setRole] = useState<RoleId>(user?.role ?? 'operator')
  const [units, setUnits] = useState<Set<Id>>(new Set(user?.assignedUnitIds ?? []))
  const [submitting, setSubmitting] = useState(false)

  function toggleUnit(id: Id) {
    setUnits((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function onSave() {
    setSubmitting(true)
    try {
      const assignedUnitIds = [...units]
      if (user) {
        runUpdateUser({ id: user.id, name: name.trim(), email: email.trim(), role, assignedUnitIds })
        toastCommandSuccess('User updated', [`${name.trim()} · ${role}`])
      } else {
        runCreateUser({ name: name.trim(), email: email.trim(), role, assignedUnitIds })
        toastCommandSuccess('User created', [`${name.trim()} · ${role}`])
      }
      onClose()
    } catch (e) {
      toastCommandError(e)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Drawer
      open
      onClose={onClose}
      size="md"
      title={user ? 'Edit user' : 'New user'}
      description={user ? user.email : 'Create an account and assign role + units'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={onSave} loading={submitting} disabled={!name.trim() || !email.trim() || (role !== 'admin' && units.size === 0)}>
            {user ? 'Save changes' : 'Create user'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1.5">
            <span className="text-[11.5px] font-medium text-muted-fg">Name</span>
            <input className="input h-9" value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name" />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-[11.5px] font-medium text-muted-fg">Email</span>
            <input type="email" className="input h-9" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@hew.in" />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-[11.5px] font-medium text-muted-fg">Role</span>
            <SearchableDropdown
              aria-label="Role"
              value={role}
              onChange={(v) => setRole(v)}
              options={roles.map((r) => ({ value: r.id, label: r.name, subtitle: r.description }))}
            />
          </label>
        </div>

        {role === 'admin' ? (
          <p className="rounded-lg border border-primary/30 bg-primary/10 px-3 py-2 text-[12px] text-primary">
            Admins have access to every module and all units — no unit assignment needed.
          </p>
        ) : (
          <div>
            <p className="mb-1.5 text-[11.5px] font-medium text-muted-fg">Assigned units <span className="text-danger">*</span></p>
            <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
              {unitOpts.map((u) => (
                <label key={u.id} className="flex items-center gap-2 rounded-lg border border-border px-2.5 py-1.5 text-[12px]">
                  <input type="checkbox" className="h-4 w-4 rounded border-border text-primary focus-visible:ring-2 focus-visible:ring-ring" checked={units.has(u.id)} onChange={() => toggleUnit(u.id)} />
                  <span className="truncate" title={u.name}>{u.code}</span>
                </label>
              ))}
              {unitOpts.length === 0 ? <p className="text-[12px] text-faint">No active units.</p> : null}
            </div>
          </div>
        )}
        {user ? (
          <p className="text-[11px] text-faint">Use the key icon on the list to set per-user permission overrides. Deactivate from the list.</p>
        ) : null}
      </div>
    </Drawer>
  )
}

function PermissionDrawer({ user, onClose }: { user: User; onClose: () => void }) {
  const roleName = useStore((s) => s.masters.roles.byId[user.role]?.name ?? user.role)
  const preset = useMemo(() => effectivePermissions(user.role), [user.role])
  const initial = useMemo(() => {
    const eff = effectivePermissions(user.role, user.overrides)
    const set = new Set<string>()
    for (const m of MODULES) for (const a of ACTIONS) if (permits(eff, m, a)) set.add(`${m}:${a}`)
    return set
  }, [user])
  const [grid, setGrid] = useState<Set<string>>(initial)
  const [submitting, setSubmitting] = useState(false)

  const cell = (m: Module, a: Action) => `${m}:${a}`
  const toggle = (m: Module, a: Action) => {
    setGrid((prev) => {
      const next = new Set(prev)
      const k = cell(m, a)
      if (next.has(k)) next.delete(k)
      else next.add(k)
      return next
    })
  }

  function save() {
    setSubmitting(true)
    try {
      const overrides = diffOverride(preset, grid)
      const res = runSetUserOverride({ id: user.id, overrides })
      toastCommandSuccess('Permissions saved', res.cascade)
      onClose()
    } catch (e) {
      toastCommandError(e)
    } finally {
      setSubmitting(false)
    }
  }

  function reset() {
    setSubmitting(true)
    try {
      runSetUserOverride({ id: user.id, overrides: undefined })
      toastCommandSuccess('Reset to role defaults', [`${user.name} · ${roleName} preset`])
      onClose()
    } catch (e) {
      toastCommandError(e)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Drawer
      open
      onClose={onClose}
      size="xl"
      defaultMaximized
      title={`Permissions — ${user.name}`}
      description={`Role: ${roleName}. Ticks that differ from the role are saved as per-user overrides.`}
      footer={
        <>
          <Button variant="secondary" leftIcon={<RotateCcw size={14} />} onClick={reset} loading={submitting}>
            Reset to {roleName} defaults
          </Button>
          <Button onClick={save} loading={submitting}>Save permissions</Button>
        </>
      }
    >
      <PermMatrix grid={grid} onToggle={toggle} base={preset} />
      <p className="mt-3 text-[11px] text-faint">
        Highlighted boxes differ from the {roleName} role and will be saved as add/remove overrides. The command bus
        re-checks every permission, so this is the real boundary — not just UI gating.
      </p>
    </Drawer>
  )
}

// ── Roles tab ────────────────────────────────────────────────────────────────
function RolesTab() {
  const can = useCan()
  const roles = useStore(useShallow((s) => values(s.masters.roles)))
  const userCounts = useStore(
    useShallow((s) => {
      const counts: Record<string, number> = {}
      for (const u of values(s.masters.users)) counts[u.role] = (counts[u.role] ?? 0) + 1
      return counts
    })
  )
  const [matrixRole, setMatrixRole] = useState<RoleDef | null>(null)
  const [form, setForm] = useState<{ role: RoleDef | null } | null>(null)

  const canCreate = can('users', 'create')
  const canEdit = can('users', 'edit')
  const canDelete = can('users', 'delete')

  function onReset(r: RoleDef) {
    try {
      const res = runResetRole(r.id)
      toastCommandSuccess('Role reset', res.cascade)
    } catch (e) {
      toastCommandError(e)
    }
  }
  function onDelete(r: RoleDef) {
    try {
      const res = runDeleteRole(r.id)
      toastCommandSuccess('Role deleted', res.cascade)
    } catch (e) {
      toastCommandError(e)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        {canCreate ? (
          <Button leftIcon={<Plus size={15} />} onClick={() => setForm({ role: null })}>New role</Button>
        ) : null}
      </div>

      <Card className="overflow-x-auto p-0">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-b border-border bg-muted text-left text-[10.5px] uppercase tracking-wide text-muted-fg">
              <th scope="col" className="px-3 py-2.5 font-semibold">Role</th>
              <th scope="col" className="px-3 py-2.5 font-semibold">Description</th>
              <th scope="col" className="px-3 py-2.5 text-right font-semibold">Users</th>
              <th scope="col" className="px-3 py-2.5 text-right font-semibold">Permissions</th>
              <th scope="col" className="px-3 py-2.5 text-right"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {roles.map((r) => {
              const isAdmin = r.id === 'admin'
              const nUsers = userCounts[r.id] ?? 0
              return (
                <tr key={r.id} className="border-b border-border/60 hover:bg-muted/40">
                  <td className="px-3 py-2.5">
                    <Badge tone={roleTone(r)}>{r.name}</Badge>
                    <span className="ml-1.5 text-[10px] text-faint">{r.builtIn ? 'built-in' : 'custom'}</span>
                  </td>
                  <td className="px-3 py-2.5 text-muted-fg">{r.description ?? '—'}</td>
                  <td className="px-3 py-2.5 text-right mono">{nUsers}</td>
                  <td className="px-3 py-2.5 text-right mono">{isAdmin ? 'all' : permCount(r.permissions)}</td>
                  <td className="px-3 py-2.5">
                    <div className="flex items-center justify-end gap-1">
                      <button type="button" className="btn btn-ghost h-8 w-8 p-0" aria-label={`Edit permissions for ${r.name}`} title={isAdmin ? 'View (locked)' : 'Edit permissions'} onClick={() => setMatrixRole(r)}>
                        <KeyRound size={15} />
                      </button>
                      {canEdit && !r.builtIn ? (
                        <button type="button" className="btn btn-ghost h-8 w-8 p-0" aria-label={`Rename ${r.name}`} title="Rename" onClick={() => setForm({ role: r })}>
                          <Pencil size={15} />
                        </button>
                      ) : null}
                      {canEdit && r.builtIn && !isAdmin ? (
                        <button type="button" className="btn btn-ghost h-8 w-8 p-0" aria-label={`Reset ${r.name}`} title="Reset to default" onClick={() => onReset(r)}>
                          <RotateCcw size={15} />
                        </button>
                      ) : null}
                      {canDelete && !r.builtIn ? (
                        <button
                          type="button"
                          className="btn btn-ghost h-8 w-8 p-0 text-danger disabled:opacity-40"
                          aria-label={`Delete ${r.name}`}
                          title={nUsers > 0 ? 'Reassign its users first' : 'Delete role'}
                          disabled={nUsers > 0}
                          onClick={() => onDelete(r)}
                        >
                          <Trash2 size={15} />
                        </button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </Card>

      {matrixRole ? <RoleMatrixDrawer key={matrixRole.id} role={matrixRole} canEdit={canEdit} onClose={() => setMatrixRole(null)} /> : null}
      {form !== null ? <RoleFormDrawer key={form.role?.id ?? '__new__'} role={form.role} roles={roles} onClose={() => setForm(null)} /> : null}
    </div>
  )
}

function RoleMatrixDrawer({ role, canEdit, onClose }: { role: RoleDef; canEdit: boolean; onClose: () => void }) {
  const isAdmin = role.id === 'admin'
  const initial = useMemo(() => {
    const set = new Set<string>()
    for (const m of MODULES) for (const a of ACTIONS) if (isAdmin || permits(role.permissions, m, a)) set.add(`${m}:${a}`)
    return set
  }, [role, isAdmin])
  const [grid, setGrid] = useState<Set<string>>(initial)
  const [submitting, setSubmitting] = useState(false)
  const readOnly = isAdmin || !canEdit

  const toggle = (m: Module, a: Action) => {
    if (readOnly) return
    setGrid((prev) => {
      const next = new Set(prev)
      const k = `${m}:${a}`
      if (next.has(k)) next.delete(k)
      else next.add(k)
      return next
    })
  }

  function save() {
    setSubmitting(true)
    try {
      const res = runUpdateRolePermissions({ id: role.id, permissions: gridToPermissions(grid) })
      toastCommandSuccess('Role permissions saved', res.cascade)
      onClose()
    } catch (e) {
      toastCommandError(e)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Drawer
      open
      onClose={onClose}
      size="xl"
      defaultMaximized
      title={`Permissions — ${role.name}`}
      description={isAdmin ? 'The Admin role always has full access (locked).' : `Toggle what the ${role.name} role can do. Changes apply to every user with this role.`}
      footer={
        readOnly ? (
          <Button variant="secondary" onClick={onClose}>Close</Button>
        ) : (
          <>
            <Button variant="secondary" onClick={onClose}>Cancel</Button>
            <Button onClick={save} loading={submitting}>Save permissions</Button>
          </>
        )
      }
    >
      <PermMatrix grid={grid} onToggle={toggle} disabled={readOnly} />
      <p className="mt-3 text-[11px] text-faint">
        {isAdmin
          ? 'Admin is the super-role and cannot be restricted, so nobody can lock themselves out.'
          : 'This edits the role itself. For one-off exceptions on a single person, use the key icon on the Users tab instead.'}
      </p>
    </Drawer>
  )
}

function RoleFormDrawer({ role, roles, onClose }: { role: RoleDef | null; roles: RoleDef[]; onClose: () => void }) {
  const editing = !!role
  const [name, setName] = useState(role?.name ?? '')
  const [description, setDescription] = useState(role?.description ?? '')
  const [cloneFromId, setCloneFromId] = useState<Id>('')
  const [submitting, setSubmitting] = useState(false)

  function onSave() {
    setSubmitting(true)
    try {
      if (role) {
        runRenameRole({ id: role.id, name: name.trim(), description: description.trim() || undefined })
        toastCommandSuccess('Role updated', [name.trim()])
      } else {
        runCreateRole({ name: name.trim(), description: description.trim() || undefined, cloneFromId: cloneFromId || undefined })
        toastCommandSuccess('Role created', [name.trim()])
      }
      onClose()
    } catch (e) {
      toastCommandError(e)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Drawer
      open
      onClose={onClose}
      size="md"
      title={editing ? 'Rename role' : 'New role'}
      description={editing ? 'Built-in role matrices are edited via the key icon.' : 'Create a custom role, optionally cloning an existing one.'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={onSave} loading={submitting} disabled={!name.trim()}>{editing ? 'Save' : 'Create role'}</Button>
        </>
      }
    >
      <div className="space-y-4">
        <label className="flex flex-col gap-1.5">
          <span className="text-[11.5px] font-medium text-muted-fg">Role name</span>
          <input className="input h-9" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Accountant" />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-[11.5px] font-medium text-muted-fg">Description</span>
          <input className="input h-9" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What this role is for" />
        </label>
        {!editing ? (
          <label className="flex flex-col gap-1.5">
            <span className="flex items-center gap-1.5 text-[11.5px] font-medium text-muted-fg"><Copy size={12} /> Clone permissions from</span>
            <SearchableDropdown
              aria-label="Clone permissions from"
              value={cloneFromId}
              onChange={(v) => setCloneFromId(v)}
              placeholder="Start empty (no permissions)"
              options={roles.map((r) => ({ value: r.id, label: r.name, subtitle: r.description }))}
            />
            <span className="text-[11px] text-faint">You can fine-tune the matrix after creating it.</span>
          </label>
        ) : null}
      </div>
    </Drawer>
  )
}

// ── shared module × action matrix ──────────────────────────────────────────────
function PermMatrix({ grid, onToggle, base, disabled }: { grid: Set<string>; onToggle: (m: Module, a: Action) => void; base?: PermissionSet; disabled?: boolean }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[12px]">
        <thead>
          <tr className="border-b border-border bg-muted text-left text-[10.5px] uppercase tracking-wide text-muted-fg">
            <th scope="col" className="px-3 py-2 font-semibold">Module</th>
            {ACTIONS.map((a) => (
              <th key={a} scope="col" className="px-2 py-2 text-center font-semibold capitalize">{a}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {MODULES.map((m) => (
            <tr key={m} className="border-b border-border/60">
              <td className="px-3 py-1.5 font-medium capitalize">{m}</td>
              {ACTIONS.map((a) => {
                const checked = grid.has(`${m}:${a}`)
                const changed = base ? checked !== permits(base, m, a) : false
                return (
                  <td key={a} className="px-2 py-1.5 text-center">
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={disabled}
                      onChange={() => onToggle(m, a)}
                      aria-label={`${m} ${a}`}
                      className={cn('h-4 w-4 rounded border-border text-primary focus-visible:ring-2 focus-visible:ring-ring', changed && 'outline outline-2 outline-warning')}
                    />
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
