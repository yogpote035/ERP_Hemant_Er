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
    await screen.findByText('Headers are auto-detected. Map only the columns you want to import; unmapped columns stay empty.')
    fireEvent.click(screen.getByRole('button', { name: 'Preview & validate' }))
    expect(await screen.findByText('existing')).toBeInTheDocument()
    expect(document.body.textContent).toContain('Record already exists and will be skipped')
    fireEvent.click(screen.getByRole('button', { name: 'Import 1 new record' }))
    await waitFor(() => expect(onRows).toHaveBeenCalledTimes(1))
    expect(onRows.mock.calls[0]![0]).toEqual([{ Code: 'NEW', Name: 'New' }])
  })

  it('fills and disables the system unit for a single-unit employee import', async () => {
    const onRows = vi.fn()
    render(
      <ExcelImportButton
        columns={[{ key: 'empCode', label: 'Employee code' }]}
        contextFields={[{ key: 'unitId', label: 'Unit', value: 'u1', options: [{ value: 'u1', label: 'HEW' }], disabled: true, required: true }]}
        onRows={onRows}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: 'Import' }))
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet([{ 'Employee code': 'EMP-001' }]), 'Employees')
    const bytes = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' })
    const file = new File([bytes], 'employees.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
    Object.defineProperty(file, 'arrayBuffer', { value: async () => bytes })
    fireEvent.change(document.querySelector('input[type="file"]')!, { target: { files: [file] } })
    await screen.findByText('Headers are auto-detected. Map only the columns you want to import; unmapped columns stay empty.')
    expect(screen.getByRole('combobox', { name: 'Unit' })).toBeDisabled()
    expect(screen.getByText('This value comes from the system and is not mapped from the workbook.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Preview & validate' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Import 1 new record' }))
    await waitFor(() => expect(onRows).toHaveBeenCalledTimes(1))
    expect(onRows.mock.calls[0]![0]).toEqual([{ Unit: 'u1', 'Employee code': 'EMP-001' }])
  })

  it('requires a system unit selection for a multi-unit employee import', async () => {
    window.HTMLElement.prototype.scrollIntoView = vi.fn()
    const onRows = vi.fn()
    render(<ExcelImportButton columns={[{ key: 'empCode', label: 'Employee code' }]} contextFields={[{
      key: 'unitId', label: 'Unit', required: true,
      options: [{ value: 'u1', label: 'HEW' }, { value: 'u2', label: 'HI' }],
    }]} onRows={onRows} />)
    fireEvent.click(screen.getByRole('button', { name: 'Import' }))
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet([{ 'Employee code': 'EMP-002' }]), 'Employees')
    const bytes = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' })
    const file = new File([bytes], 'employees.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
    Object.defineProperty(file, 'arrayBuffer', { value: async () => bytes })
    fireEvent.change(document.querySelector('input[type="file"]')!, { target: { files: [file] } })
    await screen.findByText('Unit is required before previewing.')
    expect(screen.getByRole('button', { name: 'Preview & validate' })).toBeDisabled()
    fireEvent.click(screen.getByRole('combobox', { name: 'Unit' }))
    fireEvent.click(screen.getByRole('option', { name: 'HI' }))
    fireEvent.click(screen.getByRole('button', { name: 'Preview & validate' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Import 1 new record' }))
    await waitFor(() => expect(onRows).toHaveBeenCalledTimes(1))
    expect(onRows.mock.calls[0]![0]).toEqual([{ Unit: 'u2', 'Employee code': 'EMP-002' }])
  })
})
