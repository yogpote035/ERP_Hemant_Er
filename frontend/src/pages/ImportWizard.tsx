import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { FileSpreadsheet, Upload, CheckCircle2, AlertTriangle, ArrowRight, ArrowLeft } from 'lucide-react'
import { useStore } from '@/store'
import { unitOptions } from '@/masters/options'
import {
  MIO_FIELDS,
  autoDetectColumns,
  groupMioRows,
  summarize,
  type MioColumnMap,
  type MioFieldKey,
  type ParsedInward,
  type ImportIssue,
} from '@/lib/mioImport'
import { runImportMio, previewImportIssues } from '@/store/importCommands'
import { useCan } from '@/hooks/useCan'
import { toastCommandError, toastCommandSuccess } from '@/lib/commandToast'
import { Button, Card, EmptyState, SearchableDropdown } from '@/components/ui'

type Step = 1 | 2 | 3
const STEPS: { n: Step; label: string }[] = [
  { n: 1, label: 'File & unit' },
  { n: 2, label: 'Map columns' },
  { n: 3, label: 'Preview & import' },
]
const intFmt = (n: number) => n.toLocaleString('en-IN')

export default function ImportWizard() {
  const can = useCan()
  const units = useStore(unitOptions)
  const [step, setStep] = useState<Step>(1)
  const [fileName, setFileName] = useState('')
  const [sheetNames, setSheetNames] = useState<string[]>([])
  const [workbookRows, setWorkbookRows] = useState<Record<string, unknown[][]>>({})
  const [sheet, setSheet] = useState('')
  const [unitId, setUnitId] = useState('')
  const [colMap, setColMap] = useState<MioColumnMap | null>(null)
  const [parsing, setParsing] = useState(false)
  const [parseError, setParseError] = useState('')
  const [importing, setImporting] = useState(false)
  const [done, setDone] = useState<{ inwards: number; dispatches: number; invoices: number } | null>(null)

  const rows = useMemo(() => (sheet ? workbookRows[sheet] ?? [] : []), [sheet, workbookRows])
  const header = rows[0] ?? []
  const dataRows = useMemo(() => rows.slice(1), [rows])

  async function onFile(file: File) {
    setParseError('')
    setParsing(true)
    try {
      const XLSX = await import('xlsx')
      const buf = await file.arrayBuffer()
      const wb = XLSX.read(buf, { type: 'array', cellDates: false })
      const byName: Record<string, unknown[][]> = {}
      for (const name of wb.SheetNames) {
        const ws = wb.Sheets[name]
        if (ws) byName[name] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', blankrows: false }) as unknown[][]
      }
      setFileName(file.name)
      setSheetNames(wb.SheetNames)
      setWorkbookRows(byName)
      setSheet(wb.SheetNames[0] ?? '')
      setColMap(null)
    } catch (e) {
      setParseError(e instanceof Error ? e.message : 'Could not read the workbook')
    } finally {
      setParsing(false)
    }
  }

  function goMap() {
    setColMap(autoDetectColumns(header))
    setStep(2)
  }

  const grouped = useMemo<{ inwards: ParsedInward[]; issues: ImportIssue[] }>(() => {
    if (step < 3 || !colMap) return { inwards: [], issues: [] }
    return groupMioRows(dataRows, colMap)
  }, [step, colMap, dataRows])

  const issues = useMemo<ImportIssue[]>(() => {
    if (step < 3 || !unitId) return grouped.issues
    const storeIssues = previewImportIssues(useStore.getState(), { unitId, inwards: grouped.inwards })
    return [...grouped.issues, ...storeIssues]
  }, [step, unitId, grouped])

  const stats = useMemo(() => summarize(grouped.inwards), [grouped])
  const errorCount = issues.filter((i) => i.level === 'error').length
  const warnCount = issues.filter((i) => i.level === 'warn').length

  function doImport() {
    setImporting(true)
    try {
      const res = runImportMio({ unitId, inwards: grouped.inwards })
      toastCommandSuccess('Workbook imported', res.cascade)
      setDone(res.data)
    } catch (e) {
      toastCommandError(e)
    } finally {
      setImporting(false)
    }
  }

  if (!can('import', 'create')) {
    return (
      <Card>
        <EmptyState icon={FileSpreadsheet} title="No import access" description="Excel import requires manager or admin rights." />
      </Card>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Excel import</h1>
          <p className="mt-0.5 text-[13px] text-muted-fg">
            Drop the MIO register &rarr; map columns &rarr; preview &rarr; one undoable import.
          </p>
        </div>
        <a
          href="/sample/HEW-sample-MIO.xlsx"
          download
          className="btn btn-secondary h-9 text-[13px]"
        >
          <FileSpreadsheet size={15} /> Download sample workbook
        </a>
      </div>

      {/* Stepper */}
      <ol className="flex flex-wrap items-center gap-2 text-[12px]" aria-label="Import steps">
        {STEPS.map((s, i) => (
          <li key={s.n} className="flex items-center gap-2" aria-current={step === s.n ? 'step' : undefined}>
            <span
              className={
                'flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-semibold ' +
                (step >= s.n ? 'bg-primary text-primary-fg' : 'bg-muted text-muted-fg')
              }
            >
              {s.n}
            </span>
            <span className={step === s.n ? 'font-semibold text-fg' : 'text-muted-fg'}>{s.label}</span>
            {i < STEPS.length - 1 ? <span className="mx-1 text-faint">/</span> : null}
          </li>
        ))}
      </ol>

      {done ? (
        <Card>
          <div className="flex flex-col items-center gap-3 py-6 text-center">
            <CheckCircle2 size={40} className="text-success" />
            <div className="text-lg font-semibold">Import complete</div>
            <p className="text-[13px] text-muted-fg">
              {intFmt(done.inwards)} challans · {intFmt(done.dispatches)} dispatches · {intFmt(done.invoices)} draft bills.
              This was one undoable transaction.
            </p>
            <div className="flex gap-2">
              <Link to="/inward" className="btn btn-primary">View register</Link>
              <Button
                variant="secondary"
                onClick={() => {
                  setDone(null)
                  setStep(1)
                  setFileName('')
                  setSheetNames([])
                  setWorkbookRows({})
                  setSheet('')
                  setColMap(null)
                }}
              >
                Import another
              </Button>
            </div>
          </div>
        </Card>
      ) : step === 1 ? (
        <Card className="space-y-4">
          <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border bg-muted/40 px-4 py-10 text-center hover:border-primary">
            <Upload size={26} className="text-muted-fg" />
            <span className="text-sm font-medium">{fileName || 'Choose or drop an .xlsx workbook'}</span>
            <span className="text-[12px] text-faint">SheetJS parses it in your browser — nothing is uploaded.</span>
            <input
              type="file"
              accept=".xlsx,.xls"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) void onFile(f)
              }}
            />
          </label>
          {parsing ? <p className="text-[13px] text-muted-fg">Reading workbook…</p> : null}
          {parseError ? <p className="text-[13px] text-danger">{parseError}</p> : null}

          {sheetNames.length > 0 ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="flex flex-col gap-1.5">
                <span className="text-[11.5px] font-medium text-muted-fg">Sheet</span>
                <SearchableDropdown
                  value={sheet}
                  onChange={(v) => setSheet(v)}
                  options={sheetNames.map((n) => ({ value: n, label: `${n} (${(workbookRows[n]?.length ?? 1) - 1} rows)` }))}
                />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="text-[11.5px] font-medium text-muted-fg">Target unit</span>
                <SearchableDropdown
                  value={unitId}
                  onChange={(v) => setUnitId(v)}
                  options={units}
                  placeholder="Select a unit…"
                />
              </label>
            </div>
          ) : null}

          <div className="flex justify-end">
            <Button rightIcon={<ArrowRight size={15} />} disabled={!sheet || !unitId || rows.length < 2} onClick={goMap}>
              Map columns
            </Button>
          </div>
        </Card>
      ) : step === 2 && colMap ? (
        <Card className="space-y-4">
          <p className="text-[13px] text-muted-fg">
            Auto-detected from the header row — fix any mapping. Columns set to <em>Not mapped</em> are skipped.
          </p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {MIO_FIELDS.map((f) => (
              <label key={f.key} className="flex flex-col gap-1.5">
                <span className="text-[11.5px] font-medium text-muted-fg">
                  {f.label}
                  {f.required ? <span className="text-danger"> *</span> : null}
                </span>
                <SearchableDropdown
                  value={String(colMap[f.key])}
                  onChange={(v) => setColMap({ ...colMap, [f.key]: Number(v) } as MioColumnMap)}
                  options={[
                    { value: '-1', label: '— Not mapped —' },
                    ...header.map((h, idx) => ({ value: String(idx), label: String(h) || `Column ${idx + 1}` })),
                  ]}
                />
              </label>
            ))}
          </div>
          {(() => {
            const missing = MIO_FIELDS.filter((f) => f.required && (colMap[f.key as MioFieldKey] ?? -1) < 0)
            return missing.length ? (
              <p className="text-[13px] text-danger">
                Map the required columns: {missing.map((m) => m.label).join(', ')}
              </p>
            ) : null
          })()}
          <div className="flex justify-between">
            <Button variant="secondary" leftIcon={<ArrowLeft size={15} />} onClick={() => setStep(1)}>
              Back
            </Button>
            <Button
              rightIcon={<ArrowRight size={15} />}
              disabled={MIO_FIELDS.some((f) => f.required && (colMap[f.key as MioFieldKey] ?? -1) < 0)}
              onClick={() => setStep(3)}
            >
              Preview
            </Button>
          </div>
        </Card>
      ) : step === 3 ? (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-5">
            <Stat label="Challans" value={intFmt(stats.inwardCount)} />
            <Stat label="Dispatches" value={intFmt(stats.dispatchCount)} />
            <Stat label="Received qty" value={intFmt(stats.receivedQty)} />
            <Stat label="Billed (OK)" value={intFmt(stats.billedQty)} />
            <Stat label="Rejection" value={intFmt(stats.rejectionQty)} />
          </div>

          {issues.length > 0 ? (
            <Card className="p-0">
              <div className="flex items-center gap-2 border-b border-border px-4 py-3 text-[13px] font-semibold">
                <AlertTriangle size={15} className={errorCount ? 'text-danger' : 'text-warning'} />
                {errorCount} error{errorCount === 1 ? '' : 's'} · {warnCount} warning{warnCount === 1 ? '' : 's'}
              </div>
              <ul className="max-h-52 divide-y divide-border overflow-y-auto text-[12px]">
                {issues.slice(0, 100).map((iss, i) => (
                  <li key={i} className="flex items-start gap-2 px-4 py-1.5">
                    <span className={iss.level === 'error' ? 'font-semibold text-danger' : 'text-warning'}>
                      {iss.level === 'error' ? 'ERR' : 'warn'}
                    </span>
                    {iss.row ? <span className="text-faint">row {iss.row}</span> : null}
                    <span>{iss.message}</span>
                  </li>
                ))}
              </ul>
            </Card>
          ) : (
            <div className="rounded-lg border border-success/30 bg-success/10 px-3.5 py-2.5 text-[13px] text-success">
              No issues — ready to import.
            </div>
          )}

          {/* Sample preview */}
          <Card className="overflow-x-auto p-0">
            <div className="border-b border-border px-4 py-3 text-[13px] font-semibold">First challans (preview)</div>
            <table className="w-full text-[12px]">
              <thead>
                <tr className="bg-muted text-left text-[10.5px] uppercase tracking-wide text-muted-fg">
                  <th scope="col" className="px-3 py-2 font-semibold">Challan</th>
                  <th scope="col" className="px-3 py-2 font-semibold">Part</th>
                  <th scope="col" className="px-3 py-2 font-semibold">Date</th>
                  <th scope="col" className="px-3 py-2 text-right font-semibold">Received</th>
                  <th scope="col" className="px-3 py-2 text-right font-semibold">Dispatches</th>
                </tr>
              </thead>
              <tbody>
                {grouped.inwards.slice(0, 12).map((inw) => (
                  <tr key={inw.rowIndex} className="border-t border-border/60">
                    <td className="px-3 py-1.5 mono">{inw.challanNo}</td>
                    <td className="px-3 py-1.5">{inw.partNo}</td>
                    <td className="px-3 py-1.5 mono text-muted-fg">{inw.challanDate || '—'}</td>
                    <td className="px-3 py-1.5 text-right mono">{intFmt(inw.receivedQty)}</td>
                    <td className="px-3 py-1.5 text-right mono">{inw.dispatches.length}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          <div className="flex justify-between">
            <Button variant="secondary" leftIcon={<ArrowLeft size={15} />} onClick={() => setStep(2)}>
              Back
            </Button>
            <Button onClick={doImport} loading={importing} disabled={errorCount > 0 || stats.inwardCount === 0}>
              Import {intFmt(stats.inwardCount)} challans
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="card p-3">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-fg">{label}</div>
      <div className="mt-1 text-xl font-bold">{value}</div>
    </div>
  )
}
