import { useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Building2,
  ReceiptText,
  Users2,
  ShieldCheck,
  DatabaseBackup,
  Download,
  Upload,
  ArrowRight,
} from 'lucide-react'
import { toast } from 'sonner'
import { useShallow } from 'zustand/react/shallow'
import { useStore } from '@/store'
import { values } from '@/store/normalized'
import { systemApi } from '@/api/modules'
import { refreshAllData } from '@/api/refresh'
import { MASTER_SPECS } from '@/masters/registry'
import { EntityManager } from '@/masters/EntityManager'
import { Button, Card, Tabs } from '@/components/ui'
import type { MasterView } from '@/masters/types'

const unitSpec = MASTER_SPECS.find((s) => s.key === 'unit') as MasterView

type TabKey = 'company' | 'invoicing' | 'users' | 'roles' | 'backup'
const TABS = [
  { value: 'company', label: 'Company' },
  { value: 'invoicing', label: 'Invoicing' },
  { value: 'users', label: 'Users' },
  { value: 'roles', label: 'Roles' },
  { value: 'backup', label: 'Backup' },
] as const

/** Settings (mock §10) — company profile, invoicing, users, roles, backup. */
export default function Settings() {
  const [tab, setTab] = useState<TabKey>('company')

  return (
    <div className="space-y-4">
      <div className="min-w-0">
        <h1 className="text-[22px] font-bold tracking-tight">Settings</h1>
        <p className="mt-0.5 text-[13px] text-muted-fg">
          Company profile, invoicing, users, roles and backups.
        </p>
      </div>

      <Tabs items={TABS} value={tab} onChange={setTab} ariaLabel="Settings sections" />

      {tab === 'company' ? <CompanyTab /> : null}
      {tab === 'invoicing' ? <InvoicingTab /> : null}
      {tab === 'users' ? <LinkTab
        icon={Users2}
        title="Users"
        desc="Add team members, assign roles and the units each person can work in."
        to="/users"
        cta="Manage users"
      /> : null}
      {tab === 'roles' ? <LinkTab
        icon={ShieldCheck}
        title="Roles & permissions"
        desc="The role list and the permission matrix (modules × actions) that drives every screen guard."
        to="/users"
        cta="Open permission matrix"
      /> : null}
      {tab === 'backup' ? <BackupTab /> : null}
    </div>
  )
}

function SectionHead({ icon: Icon, title, desc }: { icon: typeof Building2; title: string; desc: string }) {
  return (
    <div className="flex items-start gap-2.5">
      <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
        <Icon size={16} />
      </span>
      <div>
        <h2 className="text-[15px] font-semibold">{title}</h2>
        <p className="text-[12.5px] text-muted-fg">{desc}</p>
      </div>
    </div>
  )
}

/** Company profile lives in the Unit master — the legal name, GSTIN, address,
 *  bank and invoice settings that print on invoices, e-way bills and letterheads. */
function CompanyTab() {
  return (
    <div className="space-y-4">
      <Card>
        <SectionHead
          icon={Building2}
          title="Company profile"
          desc="Used on invoices, e-way bills and letterheads. Each plant unit carries its own GSTIN."
        />
      </Card>
      <EntityManager spec={unitSpec} />
    </div>
  )
}

/** Invoicing summary — the per-unit number format + sequence padding + bank line. */
function InvoicingTab() {
  const units = useStore(useShallow((s) => values(s.masters.units)))
  return (
    <div className="space-y-4">
      <Card>
        <SectionHead
          icon={ReceiptText}
          title="Invoice numbering & banking"
          desc="The format and padding each unit uses to number tax invoices. Edit under the Company tab."
        />
      </Card>
      <Card className="overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted text-left text-[10.5px] uppercase tracking-wide text-muted-fg">
              <th className="px-3 py-2.5 font-semibold">Unit</th>
              <th className="px-3 py-2.5 font-semibold">Invoice format</th>
              <th className="px-3 py-2.5 font-semibold">Seq pad</th>
              <th className="px-3 py-2.5 font-semibold">Bank</th>
              <th className="px-3 py-2.5 font-semibold">Branch</th>
              <th className="px-3 py-2.5 font-semibold">IFSC</th>
            </tr>
          </thead>
          <tbody>
            {units.map((u) => (
              <tr key={u.id} className="border-b border-border/60 last:border-0">
                <td className="px-3 py-2.5 font-medium">{u.code} · {u.name}</td>
                <td className="px-3 py-2.5"><span className="mono text-xs">{u.invoiceFormat}</span></td>
                <td className="px-3 py-2.5 mono text-xs">{u.seqPad}</td>
                <td className="px-3 py-2.5">{u.bankName ?? '—'}</td>
                <td className="px-3 py-2.5">{u.bankBranch ?? '—'}</td>
                <td className="px-3 py-2.5 mono text-xs">{u.ifsc ?? '—'}</td>
              </tr>
            ))}
            {units.length === 0 ? (
              <tr><td colSpan={6} className="px-3 py-6 text-center text-muted-fg">No units configured yet.</td></tr>
            ) : null}
          </tbody>
        </table>
      </Card>
    </div>
  )
}

function LinkTab({ icon: Icon, title, desc, to, cta }: { icon: typeof Building2; title: string; desc: string; to: string; cta: string }) {
  return (
    <Card>
      <SectionHead icon={Icon} title={title} desc={desc} />
      <div className="mt-4">
        <Link to={to} className="btn btn-primary">
          {cta} <ArrowRight size={15} />
        </Link>
      </div>
    </Card>
  )
}

/** Admin database backup and restore using a MySQL/TiDB-compatible SQL dump. */
function BackupTab() {
  const fileRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)

  async function downloadSql() {
    setBusy(true)
    try {
      const sql = await systemApi.downloadSql()
      const url = URL.createObjectURL(new Blob([sql], { type: 'application/sql' }))
      const a = document.createElement('a')
      a.href = url
      a.download = `hew-erp-backup-${new Date().toISOString().slice(0, 10)}.sql`
      a.click()
      URL.revokeObjectURL(url)
      toast.success('SQL backup downloaded')
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Could not export SQL backup') }
    finally { setBusy(false) }
  }

  async function onImportFile(file: File) {
    setBusy(true)
    try {
      await systemApi.restoreSql(await file.text())
      await refreshAllData()
      useStore.setState({ _undo: [], _redo: [] })
      toast.success('SQL backup restored')
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Could not restore SQL backup') }
    finally { setBusy(false) }
  }

  return (
    <div className="space-y-4">
      <Card>
        <SectionHead
          icon={DatabaseBackup}
          title="Backup & restore"
          desc="Export or restore the complete MySQL/TiDB database as a compatible SQL file."
        />
        <div className="mt-4 flex flex-wrap gap-2">
          <Button leftIcon={<Download size={15} />} onClick={() => void downloadSql()} loading={busy}>
            Export SQL
          </Button>
          <Button variant="secondary" leftIcon={<Upload size={15} />} onClick={() => fileRef.current?.click()}>
            Restore SQL
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept="application/sql,text/sql,.sql"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) void onImportFile(f)
              e.target.value = ''
            }}
          />
        </div>
      </Card>

    </div>
  )
}
