import type { Customer } from '@/types/domain'

const text = (value?: string) => value?.trim().replace(/\s+/g, ' ').toLocaleLowerCase() ?? ''
const lines = (value?: string[]) => (value ?? []).map(text).filter(Boolean).join('\n')

/** True only when an explicitly entered shipped-to value differs from billing. */
export function hasDifferentShippingDetails(customer: Customer): boolean {
  return (
    (!!customer.shippingName && text(customer.shippingName) !== text(customer.name)) ||
    (!!customer.shippingGstin && text(customer.shippingGstin) !== text(customer.gstin)) ||
    (!!customer.shippingStateCode && text(customer.shippingStateCode) !== text(customer.stateCode)) ||
    (!!customer.shippingAddressLines?.length && lines(customer.shippingAddressLines) !== lines(customer.addressLines))
  )
}
