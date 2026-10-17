import { beforeAll, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MultiSelectDropdown } from './MultiSelectDropdown'

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn()
})

describe('MultiSelectDropdown option metadata', () => {
  it('shows a searchable, colour-distinguished date hint beside a challan number', async () => {
    const user = userEvent.setup()
    render(
      <MultiSelectDropdown
        aria-label="REF DC No (inward challans)"
        values={[]}
        onChange={vi.fn()}
        options={[{
          value: 'inward-1',
          label: 'U12627JDC02849',
          subtitle: 'IM-32218 · heat 65689 · avail 1,048',
          hint: '01-08-2026',
          hintTone: 'accent',
        }]}
      />
    )

    await user.click(screen.getByRole('combobox', { name: 'REF DC No (inward challans)' }))
    expect(screen.getByText('U12627JDC02849')).toBeVisible()
    expect(screen.getByText('01-08-2026')).toHaveClass('text-accent')

    await user.type(screen.getByLabelText('Search…'), '01-08-2026')
    expect(screen.getByText('U12627JDC02849')).toBeVisible()
  })
})
