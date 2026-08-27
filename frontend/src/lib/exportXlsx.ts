/**
 * exportXlsx.ts — lazy SheetJS export of tabular rows to an .xlsx download.
 * `xlsx` is dynamic-imported so it stays out of the main bundle (it already
 * ships as the import-wizard's lazy chunk).
 */
export interface ExportColumn {
  key: string
  label: string
}

export async function exportRowsToXlsx(
  filename: string,
  sheetName: string,
  columns: ExportColumn[],
  rows: Record<string, unknown>[]
): Promise<void> {
  const XLSX = await import('xlsx')
  const header = columns.map((c) => c.label)
  const body = rows.map((r) => columns.map((c) => r[c.key] ?? ''))
  const ws = XLSX.utils.aoa_to_sheet([header, ...body])
  const wb = XLSX.utils.book_new()
  // Sheet names are capped at 31 chars and can't contain certain characters.
  const safeSheet = (sheetName || 'Sheet1').replace(/[\\/?*[\]:]/g, ' ').slice(0, 31)
  XLSX.utils.book_append_sheet(wb, ws, safeSheet)
  XLSX.writeFile(wb, filename)
}
