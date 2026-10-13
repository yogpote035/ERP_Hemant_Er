import { describe, expect, it } from 'vitest'
import type { Customer } from '@/types/domain'
import { hasDifferentShippingDetails } from './customerShipping'

const customer = (overrides: Partial<Customer> = {}): Customer => ({
  id: 'customer-1', unitId: 'u1', name: 'Acme Ltd', gstin: '27ABCDE1234F1Z5',
  stateCode: '27', addressLines: ['Pune', 'Maharashtra'], active: true, ...overrides,
})

describe('hasDifferentShippingDetails', () => {
  it('does not highlight blank or equivalent shipping details', () => {
    expect(hasDifferentShippingDetails(customer())).toBe(false)
    expect(hasDifferentShippingDetails(customer({
      shippingName: ' ACME LTD ', shippingGstin: '27abcde1234f1z5', shippingStateCode: '27',
      shippingAddressLines: [' Pune ', 'Maharashtra'],
    }))).toBe(false)
  })

  it('highlights when any shipped-to value differs from billing', () => {
    expect(hasDifferentShippingDetails(customer({ shippingName: 'Acme Warehouse' }))).toBe(true)
    expect(hasDifferentShippingDetails(customer({ shippingAddressLines: ['Mumbai'] }))).toBe(true)
    expect(hasDifferentShippingDetails(customer({ shippingGstin: '29ABCDE1234F1Z5' }))).toBe(true)
    expect(hasDifferentShippingDetails(customer({ shippingStateCode: '29' }))).toBe(true)
  })
})
