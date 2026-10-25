import { formatLocationWithOptionalUnit } from '@shared/properties/unitLabelDisplay'

export const INVOICE_NEEDS_APPROVAL_TITLE = 'Invoice needs approval'
export const INVOICE_REVIEW_ACTION = 'Review invoice'

export type InvoiceApprovalPhase = 'idle' | 'submitting' | 'approved' | 'failed'

export function formatInvoiceAmount(amount: number): string {
  if (!Number.isFinite(amount)) return '$0'
  const cents = Math.round(amount * 100) / 100
  if (Math.abs(cents - Math.round(cents)) < 0.001) {
    return `$${Math.round(cents).toLocaleString('en-US')}`
  }
  return cents.toLocaleString('en-US', { style: 'currency', currency: 'USD' })
}

export function invoiceAttentionCard(input: {
  vendorName: string
  amount: number
}): { title: string; summary: string; actionLabel: string } {
  const vendor = input.vendorName.trim() || 'The vendor'
  const amountLabel = formatInvoiceAmount(input.amount)
  return {
    title: INVOICE_NEEDS_APPROVAL_TITLE,
    summary: `${vendor} submitted a ${amountLabel} invoice. Review and approve the cost.`,
    actionLabel: INVOICE_REVIEW_ACTION,
  }
}

export function invoiceReviewLocation(input: {
  building?: string | null
  unit?: string | null
  propertyType?: string | null
  residentName?: string | null
}): string {
  const place = formatLocationWithOptionalUnit({
    propertyLabel: input.building,
    unitLabel: input.unit,
    propertyType: input.propertyType,
  })
  const resident = input.residentName?.trim() || ''
  if (place && resident) return `${place} · ${resident}`
  return place || resident || '—'
}

type InvoiceProperty = {
  id: string
  name: string
  streetAddress?: string | null
  propertyType: string | null
}

function propertyRecordForInvoice(
  properties: InvoiceProperty[],
  propertyId: string | null | undefined,
  building: string | null | undefined,
): InvoiceProperty | null {
  const id = propertyId?.trim()
  if (id) {
    const byId = properties.find((property) => property.id === id)
    if (byId) return byId
  }
  const key = (building ?? '').trim().toLowerCase()
  if (!key) return null
  return (
    properties.find((property) => {
      const names = [property.name, property.streetAddress ?? '']
        .map((value) => value.trim().toLowerCase())
        .filter(Boolean)
      return names.includes(key)
    }) ?? null
  )
}

export function propertyTypeForInvoice(
  properties: InvoiceProperty[],
  propertyId: string | null | undefined,
  building: string | null | undefined,
): string | null {
  return propertyRecordForInvoice(properties, propertyId, building)?.propertyType ?? null
}

/** Street or property name for the review when the ticket has no building label. */
export function propertyLabelForInvoice(
  properties: InvoiceProperty[],
  propertyId: string | null | undefined,
  building: string | null | undefined,
): string | null {
  const property = propertyRecordForInvoice(properties, propertyId, building)
  if (!property) return null
  return property.streetAddress?.trim() || property.name.trim() || null
}

export function invoiceReviewActionPlan(input: {
  paymentsEnabled: boolean
  saving: boolean
  amount: number
}): {
  showPayNow: boolean
  showPaymentSteps: boolean
  approveLabel: string
  approveDisabled: boolean
} {
  return {
    showPayNow: input.paymentsEnabled,
    showPaymentSteps: input.paymentsEnabled,
    approveLabel: input.saving ? 'Approving…' : `Approve ${formatInvoiceAmount(input.amount)}`,
    approveDisabled: input.saving,
  }
}

/** Start one approval. A second call while submitting or after success does not submit again. */
export function startInvoiceApproval(phase: InvoiceApprovalPhase): {
  phase: InvoiceApprovalPhase
  submit: boolean
} {
  if (phase === 'submitting' || phase === 'approved') return { phase, submit: false }
  return { phase: 'submitting', submit: true }
}

export function finishInvoiceApproval(ok: boolean): InvoiceApprovalPhase {
  return ok ? 'approved' : 'failed'
}

export function invoiceApprovedCopy(vendorName: string, amountLabel: string): {
  title: string
  message: string
  button: string
} {
  const vendor = vendorName.trim() || 'the vendor'
  return {
    title: 'Invoice approved',
    message: `You approved ${vendor}'s ${amountLabel} invoice. No payment was made.`,
    button: 'Done',
  }
}
