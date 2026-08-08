/**
 * User-facing payment activity copy (client runtime).
 *
 * Helpers in paymentReadiness / paymentSettlement never log — callers use these
 * strings when recording a real business outcome via recordActivityLog.
 */

function readString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed || null
}

export function formatRentBillingPeriodLabel(
  billingPeriod: string | null | undefined,
): string | null {
  const raw = readString(billingPeriod)
  if (!raw) return null
  const match = /^(\d{4})-(\d{2})$/.exec(raw)
  if (match) {
    const date = new Date(`${match[1]}-${match[2]}-01T12:00:00`)
    if (!Number.isFinite(date.getTime())) return raw
    return new Intl.DateTimeFormat(undefined, { month: 'long' }).format(date)
  }
  return raw
}

export function buildRentPaymentReceivedMessage(params: {
  billingPeriod?: string | null
  residentName?: string | null
}): string {
  const period = formatRentBillingPeriodLabel(params.billingPeriod)
  const name = readString(params.residentName) ?? 'Resident'
  if (period) return `${period} rent payment received from ${name}.`
  return `Rent payment received from ${name}.`
}

export function buildMaintenanceInvoicePaidMessage(params: {
  invoiceNumber?: string | null
  invoiceId?: string | null
}): string {
  const number = readString(params.invoiceNumber)
  if (number) return `Invoice #${number} was paid.`
  const id = readString(params.invoiceId)
  if (id) return `Invoice #${id.slice(0, 8)} was paid.`
  return 'Maintenance invoice was paid.'
}
