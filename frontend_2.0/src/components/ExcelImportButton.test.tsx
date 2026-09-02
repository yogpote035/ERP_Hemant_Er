import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import * as XLSX from 'xlsx'
import { ExcelImportButton } from './ExcelImportButton'

describe('ExcelImportButton wizard', () => {
  it('opens the shared three-step import workflow', () => {
    render(<ExcelImportButton columns={[{ key: 'code', label: 'Code', required: true }]} onRows={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Import' }))
    expect(screen.getByText('Import Excel workbook')).toBeInTheDocument()
    expect(screen.getByText('Map columns')).toBeInTheDocument()
    expect(screen.getByText('Preview & import')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Choose workbook' })).toBeInTheDocument()
  })

  it('reads a real workbook, reports an existing row, and commits only new rows', async () => {
    const onRows = vi.fn()
    render(
      <ExcelImportButton
        columns={[{ key: 'code', label: 'Code', required: true }, { key: 'name', label: 'Name', required: true }]}
        existingKeys={new Set(['existing'])}
        rowKey={(row) => String(row.Code)}
        onRows={onRows}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: 'Import' }))
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet([{ Code: 'EXISTING', Name: 'Old' }, { Code: 'NEW', Name: 'New' }]), 'Data')
    const bytes = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' })
    const file = new File([bytes], 'records.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
    Object.defineProperty(file, 'arrayBuffer', { value: async () => bytes })
    fireEvent.change(document.querySelector('input[type="file"]')!, { target: { files: [file] } })
    await screen.findByText('Headers are auto-detected. Confirm or correct each mapping.')
    fireEvent.click(screen.getByRole('button', { name: 'Preview & validate' }))
    expect(await screen.findByText('existing')).toBeInTheDocument()
    expect(document.body.textContent).toContain('Record already exists and will be skipped')
    fireEvent.click(screen.getByRole('button', { name: 'Import 1 new record' }))
    await waitFor(() => expect(onRows).toHaveBeenCalledTimes(1))
    expect(onRows.mock.calls[0]![0]).toEqual([{ Code: 'NEW', Name: 'New' }])
  })
})
