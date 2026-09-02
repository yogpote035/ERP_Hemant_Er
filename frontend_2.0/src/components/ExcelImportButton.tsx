import { useMemo, useRef, useState } from 'react'
import { ArrowLeft, FileSpreadsheet, Upload } from 'lucide-react'
import { toast } from 'sonner'
import { readRowsFromXlsx, type ImportedRow } from '@/lib/importXlsx'
import { Button, Card, Drawer } from '@/components/ui'

export interface ExcelImportColumn { key: string; label: string; required?: boolean }
interface PreviewIssue { row: number; kind: 'error' | 'existing' | 'duplicate'; message: string }
const norm = (value: unknown) => String(value ?? '').trim().toLowerCase()

/** Shared three-step import used outside the specialist inward-register importer. */
export function ExcelImportButton({ onRows, columns, existingKeys, rowKey, validateRow, label = 'Import', title = 'Import Excel workbook', size = 'md' }: {
  onRows: (rows: ImportedRow[], file: File) => void | Promise<void>
  columns: ExcelImportColumn[]
  existingKeys?: ReadonlySet<string>
  rowKey?: (row: ImportedRow) => string
  validateRow?: (row: ImportedRow, rowNumber: number) => string | undefined
  label?: string; title?: string; size?: 'sm' | 'md' | 'lg'
}) {
  const ref = useRef<HTMLInputElement>(null)
  const [open, setOpen] = useState(false)
  const [step, setStep] = useState<1 | 2 | 3>(1)
  const [file, setFile] = useState<File | null>(null)
  const [sourceRows, setSourceRows] = useState<ImportedRow[]>([])
  const [mapping, setMapping] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(false)
  const headers = useMemo(() => Object.keys(sourceRows[0] ?? {}), [sourceRows])
  const mappedRows = useMemo(() => sourceRows.map((source) => Object.fromEntries(columns.map((column) => {
    const sourceKey = mapping[column.key]
    return [column.label, sourceKey ? source[sourceKey] : '']
  }))), [columns, mapping, sourceRows])
  const preview = useMemo(() => {
    const issues: PreviewIssue[] = []; const accepted: ImportedRow[] = []; const seen = new Set<string>()
    mappedRows.forEach((row, index) => {
      const rowNumber = index + 2
      const missing = columns.find((column) => column.required && norm(row[column.label]) === '')
      if (missing) { issues.push({ row: rowNumber, kind: 'error', message: `${missing.label} is required` }); return }
      const validation = validateRow?.(row, rowNumber)
      if (validation) { issues.push({ row: rowNumber, kind: 'error', message: validation }); return }
      const key = norm(rowKey?.(row))
      if (key && existingKeys?.has(key)) { issues.push({ row: rowNumber, kind: 'existing', message: 'Record already exists and will be skipped' }); return }
      if (key && seen.has(key)) { issues.push({ row: rowNumber, kind: 'duplicate', message: 'Duplicate row in this workbook will be skipped' }); return }
      if (key) seen.add(key)
      accepted.push(row)
    })
    return { issues, accepted }
  }, [columns, existingKeys, mappedRows, rowKey, validateRow])
  function reset() { setStep(1); setFile(null); setSourceRows([]); setMapping({}); setLoading(false) }
  function close() { setOpen(false); reset() }
  async function selected(selectedFile?: File) {
    if (!selectedFile) return
    setLoading(true)
    try {
      const rows = await readRowsFromXlsx(selectedFile); const sourceHeaders = Object.keys(rows[0] ?? {})
      setMapping(Object.fromEntries(columns.map((column) => [column.key, sourceHeaders.find((header) => [column.label, column.key].some((candidate) => norm(candidate) === norm(header))) ?? ''])))
      setFile(selectedFile); setSourceRows(rows); setStep(2)
    } catch (error) { toast.error(error instanceof Error ? error.message : 'Excel import failed') }
    finally { setLoading(false) }
  }
  async function commit() {
    if (!file || preview.accepted.length === 0) return
    setLoading(true)
    try {
      await onRows(preview.accepted, file)
      if (skipped.length > 0) toast.info(`${skipped.length} existing or duplicate record${skipped.length === 1 ? '' : 's'} skipped`)
      close()
    }
    catch (error) { toast.error(error instanceof Error ? error.message : 'Excel import failed') }
    finally { setLoading(false) }
  }
  const errors = preview.issues.filter((issue) => issue.kind === 'error'); const skipped = preview.issues.filter((issue) => issue.kind !== 'error')
  return <>
    <Button className="w-24 shrink-0 justify-center" variant="secondary" size={size} leftIcon={<FileSpreadsheet size={15} />} onClick={() => setOpen(true)}>{label}</Button>
    <Drawer open={open} onClose={close} size="xl" title={title} description="Map columns, validate records, and import only new rows." defaultMaximized>
      <div className="space-y-4 p-4">
        <div className="flex flex-wrap items-center gap-2 text-[12px] text-muted-fg">{[['1','File'],['2','Map columns'],['3','Preview & import']].map(([number, text], index) => <span key={number} className={step === index + 1 ? 'font-semibold text-primary' : ''}><b className="mr-1 rounded-full bg-muted px-2 py-1">{number}</b>{text}{index < 2 ? <span className="ml-2">/</span> : null}</span>)}</div>
        {step === 1 ? <Card className="flex min-h-64 flex-col items-center justify-center gap-3 border-dashed"><FileSpreadsheet size={36} className="text-muted-fg"/><div className="font-semibold">Choose an .xlsx or .xls workbook</div><input ref={ref} type="file" accept=".xlsx,.xls" className="hidden" onChange={(event) => { const picked=event.target.files?.[0]; event.target.value=''; void selected(picked) }}/><Button leftIcon={<Upload size={15}/>} loading={loading} onClick={() => ref.current?.click()}>Choose workbook</Button></Card> : null}
        {step === 2 ? <Card className="space-y-4"><p className="text-[13px] text-muted-fg">Headers are auto-detected. Confirm or correct each mapping.</p><div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">{columns.map((column) => <label key={column.key} className="space-y-1.5 text-[12px]"><span className="font-medium">{column.label}{column.required ? ' *' : ''}</span><select className="input h-9" value={mapping[column.key] ?? ''} onChange={(event) => setMapping((current) => ({...current,[column.key]:event.target.value}))}><option value="">Not mapped</option>{headers.map((header) => <option key={header} value={header}>{header}</option>)}</select></label>)}</div><div className="flex justify-between"><Button variant="secondary" leftIcon={<ArrowLeft size={14}/>} onClick={() => setStep(1)}>Back</Button><Button disabled={columns.some((column) => column.required && !mapping[column.key])} onClick={() => setStep(3)}>Preview & validate</Button></div></Card> : null}
        {step === 3 ? <div className="space-y-4"><div className="grid grid-cols-3 gap-3"><Card><div className="text-xs text-muted-fg">Ready</div><div className="text-2xl font-bold text-success">{preview.accepted.length}</div></Card><Card><div className="text-xs text-muted-fg">Existing / duplicate</div><div className="text-2xl font-bold text-warning">{skipped.length}</div></Card><Card><div className="text-xs text-muted-fg">Errors</div><div className="text-2xl font-bold text-danger">{errors.length}</div></Card></div>{preview.issues.length ? <Card className="max-h-72 overflow-auto p-0"><div className="border-b border-border px-4 py-3 text-sm font-semibold">Validation results</div>{preview.issues.map((issue) => <div key={`${issue.row}-${issue.kind}`} className="border-b border-border/60 px-4 py-2 text-[12px]"><b className={issue.kind === 'error' ? 'text-danger' : 'text-warning'}>{issue.kind}</b> · row {issue.row} · {issue.message}</div>)}</Card> : <Card className="border-success/30 bg-success/10 text-sm text-success">All rows are valid and new.</Card>}<div className="flex justify-between"><Button variant="secondary" leftIcon={<ArrowLeft size={14}/>} onClick={() => setStep(2)}>Back</Button><Button loading={loading} disabled={errors.length > 0 || preview.accepted.length === 0} onClick={commit}>Import {preview.accepted.length} new record{preview.accepted.length === 1 ? '' : 's'}</Button></div></div> : null}
      </div>
    </Drawer>
  </>
}
