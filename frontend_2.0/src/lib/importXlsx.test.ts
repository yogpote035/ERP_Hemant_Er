import { describe, expect, it } from 'vitest'
import { excelBoolean, excelNumber, excelText, excelValue } from './importXlsx'

describe('Excel import value normalization', () => {
  it('matches exported headers without case or surrounding-space sensitivity', () => {
    const row = { ' Unit ': 'HEW', 'GST %': 18 }
    expect(excelValue(row, 'unit')).toBe('HEW')
    expect(excelValue(row, 'gst %')).toBe(18)
  })

  it('parses formatted numbers and percentages', () => {
    expect(excelNumber('1,234.50')).toBe(1234.5)
    expect(excelNumber('18%')).toBe(18)
    expect(excelNumber('')).toBeUndefined()
    expect(excelNumber('not a number')).toBeUndefined()
  })

  it('normalizes text and common spreadsheet boolean values', () => {
    expect(excelText('  ABC  ')).toBe('ABC')
    expect(excelBoolean('Active')).toBe(true)
    expect(excelBoolean('yes')).toBe(true)
    expect(excelBoolean('No')).toBe(false)
  })
})
