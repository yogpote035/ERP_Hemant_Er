import { beforeAll, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SearchableDropdown } from './SearchableDropdown'

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn()
})

describe('SearchableDropdown option badges', () => {
  it('shows a visible different ship-to badge on the selected customer and in the option list', async () => {
    const user = userEvent.setup()
    render(
      <SearchableDropdown
        aria-label="Consignee (Bill to)"
        value="different"
        onChange={vi.fn()}
        options={[
          { value: 'same', label: 'Same Address Customer' },
          { value: 'different', label: 'Warehouse Customer', badge: 'Different ship-to' },
        ]}
      />
    )

    expect(screen.getByRole('combobox', { name: 'Consignee (Bill to)' })).toHaveTextContent('Different ship-to')
    await user.click(screen.getByRole('combobox', { name: 'Consignee (Bill to)' }))
    expect(screen.getAllByText('Different ship-to')).toHaveLength(2)
  })
})
