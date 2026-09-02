export type ImportedRow = Record<string, unknown>

/** Read the first non-empty worksheet as header-keyed records. */
export async function readRowsFromXlsx(file: File): Promise<ImportedRow[]> {
  const XLSX = await import('xlsx')
  const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: false })
  const sheetName = workbook.SheetNames[0]
  if (!sheetName) throw new Error('Workbook has no worksheets')
  const sheet = workbook.Sheets[sheetName]
  if (!sheet) throw new Error('Could not read the first worksheet')
  const rows = XLSX.utils.sheet_to_json<ImportedRow>(sheet, { defval: '', raw: true })
  if (rows.length === 0) throw new Error('Workbook has no data rows')
  return rows
}

export function excelValue(row: ImportedRow, ...headers: string[]): unknown {
  const entries = Object.entries(row)
  for (const header of headers) {
    const normalized = header.trim().toLowerCase()
    const found = entries.find(([key]) => key.trim().toLowerCase() === normalized)
    if (found) return found[1]
  }
  return undefined
}

export function excelText(value: unknown): string {
  return value == null ? '' : String(value).trim()
}

export function excelNumber(value: unknown): number | undefined {
  if (value == null || value === '') return undefined
  const parsed = typeof value === 'number' ? value : Number(String(value).replace(/,/g, '').replace(/%$/, ''))
  return Number.isFinite(parsed) ? parsed : undefined
}

export function excelBoolean(value: unknown): boolean {
  if (typeof value === 'boolean') return value
  return ['true', 'yes', 'y', '1', 'active'].includes(excelText(value).toLowerCase())
}
