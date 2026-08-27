/**
 * billingCommands.ts (plan P4) — finalize a draft into a legal GST invoice,
 * void one, and record (possibly multi-bill) payments.
 *
 * `finalizeInvoice` snapshots taxKind + totals + packing onto the invoice
 * (the sole place we store derived data — legal immutability) and flips it to
 * 'sent'. The Bill No IS the invoice number, so no sequence is minted here.
 * Payment status stays DERIVED (selectors/billing.ts).
 */
import { addDays } from 'date-fns'
import type { Id, Invoice, IssuerKind, Payment, PaymentAllocation, PaymentMode } from '@/types/domain'
import type { Paise } from '@/lib/money'
import { addP, formatINRSymbol } from '@/lib/money'
import { toISODate } from '@/lib/date'
import { getById, patchEntity, putEntity, removeEntity } from './normalized'
import { writableUnitIds } from './scope'
import { computeInvoice, deriveTaxKind } from '@/selectors/invoiceCompute'
import { outstandingForInvoice, paidForInvoice } from '@/selectors/billing'
import type { RootState } from './state'
import { runCommand, type ApplyOut, type Command, type CommandContext } from './commandBus'
import type { CommandResult } from './commands'

// ── finalize ───────────────────────────────────────────────────────────────────
export interface FinalizeInput {
  invoiceId: Id
  customerId: Id
  issuerKind: IssuerKind
  issuerVendorId?: Id
  invoiceDate?: string
  paymentTerms?: string
}

function issuerStateOf(s: RootState, inv: Invoice, input: FinalizeInput): string | undefined {
  if (input.issuerKind === 'supplier') return getById(s.masters.vendors, input.issuerVendorId)?.stateCode
  return getById(s.masters.units, inv.unitId)?.stateCode
}

function validateFinalize(s: RootState, input: FinalizeInput): { ok: true } | { ok: false; errors: string[] } {
  const errors: string[] = []
  const inv = getById(s.billing.invoices, input.invoiceId)
  if (!inv) return { ok: false, errors: ['Invoice not found'] }
  if (inv.lifecycle !== 'draft') errors.push(`Bill ${inv.billNo} is already ${inv.lifecycle}`)
  if (!writableUnitIds(s).has(inv.unitId)) errors.push("You don't have access to that unit")
  const cust = getById(s.masters.customers, input.customerId)
  if (!cust) errors.push('Choose a consignee (customer)')
  if (input.issuerKind === 'supplier') {
    const v = getById(s.masters.vendors, input.issuerVendorId)
    if (!v) errors.push('Choose the issuing RM supplier')
    else if (!v.gstin || !v.stateCode) errors.push('The issuing supplier needs a GSTIN + state code')
  }
  if (inv && computeInvoice(s, inv, 'igst').lines.length === 0) {
    errors.push('This bill has no billed dispatch lines to invoice')
  }
  return errors.length ? { ok: false, errors } : { ok: true }
}

function applyFinalize(draft: RootState, input: FinalizeInput, ctx: CommandContext): ApplyOut<{ id: Id }> {
  const inv = getById(draft.billing.invoices, input.invoiceId) as Invoice
  const cust = getById(draft.masters.customers, input.customerId)
  const issuerState = issuerStateOf(draft, inv, input)
  const taxKind = deriveTaxKind(issuerState, cust?.stateCode)
  const { totals, packing, lines } = computeInvoice(draft, inv, taxKind)
  const invoiceDate = input.invoiceDate || inv.invoiceDate || ctx.today
  const terms = cust?.paymentTermsDays
  const dueDate = terms != null ? toISODate(addDays(new Date(invoiceDate), terms)) : undefined
  const issuerId = input.issuerKind === 'supplier' && input.issuerVendorId ? input.issuerVendorId : inv.unitId

  // Freeze the issuer + consignee + line identity NOW. A later edit to the customer,
  // unit, vendor or part master must not mutate this already-issued legal document.
  const issuerVendor = input.issuerKind === 'supplier' ? getById(draft.masters.vendors, issuerId) : undefined
  const issuerUnit = getById(draft.masters.units, inv.unitId)
  const partySnapshot = {
    custName: cust?.name ?? '',
    custGstin: cust?.gstin ?? '',
    custStateCode: cust?.stateCode ?? '',
    custAddress: cust?.addressLines ?? [],
    issuerName: issuerVendor?.name ?? issuerUnit?.name ?? '',
    issuerGstin: issuerVendor?.gstin ?? issuerUnit?.gstin ?? '',
    issuerStateCode: (issuerVendor?.stateCode ?? issuerUnit?.stateCode) ?? '',
    issuerAddress: issuerVendor?.addressLines ?? issuerUnit?.addressLines ?? [],
  }

  patchEntity(draft.billing.invoices, inv.id, {
    customerId: input.customerId,
    issuerKind: input.issuerKind,
    issuerId,
    invoiceDate,
    dueDate,
    paymentTerms: input.paymentTerms,
    taxKind,
    totals,
    packing,
    partySnapshot,
    lineSnapshot: lines,
    lifecycle: 'sent',
  })

  const taxLabel = taxKind === 'igst' ? 'IGST' : 'CGST+SGST'
  return {
    result: { id: inv.id },
    cascade: [
      `Bill ${inv.billNo} issued to ${cust?.name ?? 'customer'}`,
      `${taxLabel} · ${formatINRSymbol(totals.grand)}`,
      dueDate ? `due ${dueDate}` : 'no due date',
    ],
    summary: `Issued invoice ${inv.billNo} (${formatINRSymbol(totals.grand)})`,
    refs: [{ type: 'invoice', id: inv.id }],
    unitId: inv.unitId,
  }
}

const finalizeCmd: Command<FinalizeInput, { id: Id }> = {
  name: 'finalizeInvoice', module: 'billing', action: 'edit', validate: validateFinalize, apply: applyFinalize,
}
export function runFinalizeInvoice(input: FinalizeInput): CommandResult<{ id: Id }> {
  return runCommand(finalizeCmd, input)
}

// ── void ─────────────────────────────────────────────────────────────────────
const voidCmd: Command<{ id: Id }, { id: Id }> = {
  name: 'voidInvoice',
  module: 'billing',
  action: 'edit',
  validate(s, input) {
    const inv = getById(s.billing.invoices, input.id)
    if (!inv) return { ok: false, errors: ['Invoice not found'] }
    if (inv.lifecycle !== 'sent') return { ok: false, errors: ['Only an issued invoice can be voided'] }
    if (!writableUnitIds(s).has(inv.unitId)) return { ok: false, errors: ["You don't have access to that unit"] }
    if (paidForInvoice(s, input.id) > 0) return { ok: false, errors: ['Reverse its payments before voiding'] }
    return { ok: true }
  },
  apply(draft, input) {
    const inv = getById(draft.billing.invoices, input.id) as Invoice
    patchEntity(draft.billing.invoices, inv.id, { lifecycle: 'void' })
    return {
      result: { id: inv.id },
      cascade: [`Bill ${inv.billNo} voided`, 'no longer counts toward receivables'],
      summary: `Voided invoice ${inv.billNo}`,
      refs: [{ type: 'invoice', id: inv.id }],
      unitId: inv.unitId,
    }
  },
}
export function runVoidInvoice(id: Id): CommandResult<{ id: Id }> {
  return runCommand(voidCmd, { id })
}

// ── payment ────────────────────────────────────────────────────────────────────
export interface PaymentInput {
  mode: PaymentMode
  ref: string
  date: string
  amountPaise: Paise
  allocations: PaymentAllocation[]
}

function validatePayment(s: RootState, input: PaymentInput): { ok: true } | { ok: false; errors: string[] } {
  const errors: string[] = []
  if (!(input.amountPaise > 0)) errors.push('Amount must be greater than zero')
  if (input.allocations.length === 0) errors.push('Allocate the payment to at least one bill')
  let allocated = 0 as Paise
  const perInvoice = new Map<Id, Paise>()
  for (const a of input.allocations) {
    const inv = getById(s.billing.invoices, a.invoiceId)
    if (!inv) {
      errors.push('Allocation targets a missing invoice')
      continue
    }
    if (inv.lifecycle !== 'sent') errors.push(`Bill ${inv.billNo} is not issued — can't receive payment`)
    if (!writableUnitIds(s).has(inv.unitId)) errors.push(`No access to bill ${inv.billNo}'s unit`)
    if (!(a.amountPaise > 0)) errors.push(`Allocation to ${inv.billNo} must be positive`)
    perInvoice.set(a.invoiceId, addP(perInvoice.get(a.invoiceId) ?? (0 as Paise), a.amountPaise))
    allocated = addP(allocated, a.amountPaise)
  }
  // Cap the TOTAL allocated to each invoice (folding duplicate allocations in one payment)
  // at its outstanding — a per-allocation check alone lets two lines overpay one bill.
  for (const [invId, sum] of perInvoice) {
    const inv = getById(s.billing.invoices, invId)
    if (!inv) continue
    const out = outstandingForInvoice(s, inv)
    if (sum > out) errors.push(`Allocation to ${inv.billNo} exceeds its ${out} outstanding`)
  }
  if (allocated > input.amountPaise) errors.push('Allocated more than the payment amount')
  return errors.length ? { ok: false, errors } : { ok: true }
}

function applyPayment(draft: RootState, input: PaymentInput, ctx: CommandContext): ApplyOut<{ id: Id }> {
  const id = ctx.newId('pay')
  const payment: Payment = {
    id,
    mode: input.mode,
    ref: input.ref,
    date: input.date,
    amountPaise: input.amountPaise,
    allocations: input.allocations,
  }
  putEntity(draft.payments.payments, payment)

  const bills = input.allocations
    .map((a) => getById(draft.billing.invoices, a.invoiceId)?.billNo)
    .filter(Boolean)
  const unitId = getById(draft.billing.invoices, input.allocations[0]?.invoiceId ?? '')?.unitId
  return {
    result: { id },
    cascade: [
      `${formatINRSymbol(input.amountPaise)} received (${input.mode.toUpperCase()})`,
      `allocated to ${bills.length} bill${bills.length === 1 ? '' : 's'}: ${bills.join(', ')}`,
    ],
    summary: `Payment ${formatINRSymbol(input.amountPaise)} via ${input.mode} → ${bills.join(', ')}`,
    refs: [{ type: 'payment', id }],
    unitId,
  }
}

const paymentCmd: Command<PaymentInput, { id: Id }> = {
  name: 'recordPayment', module: 'payments', action: 'create', validate: validatePayment, apply: applyPayment,
}
export function runRecordPayment(input: PaymentInput): CommandResult<{ id: Id }> {
  return runCommand(paymentCmd, input)
}

/** Reverse (delete) a recorded receipt — a wrong amount / wrong bill / bounced cheque must
 *  be correctable. Removing the payment restores the allocated invoices' outstanding (so a
 *  mistakenly-"paid" invoice can then be voided/edited). Atomic + undoable like any command. */
const reversePaymentCmd: Command<{ id: Id }, { id: Id }> = {
  name: 'reversePayment',
  module: 'payments',
  action: 'delete',
  validate(s, input) {
    const p = getById(s.payments.payments, input.id)
    if (!p) return { ok: false, errors: ['Payment not found'] }
    const unitId = getById(s.billing.invoices, p.allocations[0]?.invoiceId ?? '')?.unitId
    if (unitId && !writableUnitIds(s).has(unitId)) return { ok: false, errors: ["You don't have access to that unit"] }
    return { ok: true }
  },
  apply(draft, input) {
    const p = getById(draft.payments.payments, input.id) as Payment
    const bills = p.allocations.map((a) => getById(draft.billing.invoices, a.invoiceId)?.billNo).filter(Boolean)
    const unitId = getById(draft.billing.invoices, p.allocations[0]?.invoiceId ?? '')?.unitId
    removeEntity(draft.payments.payments, input.id)
    return {
      result: { id: input.id },
      cascade: [
        `Payment ${formatINRSymbol(p.amountPaise)} (${p.mode.toUpperCase()}) reversed`,
        bills.length ? `outstanding restored on ${bills.join(', ')}` : 'outstanding restored',
      ],
      summary: `Reversed payment ${formatINRSymbol(p.amountPaise)} via ${p.mode}`,
      refs: [{ type: 'payment', id: input.id }],
      unitId,
    }
  },
}
export function runReversePayment(id: Id): CommandResult<{ id: Id }> {
  return runCommand(reversePaymentCmd, { id })
}
