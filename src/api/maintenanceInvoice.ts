/**
 * Admin Edge Functions for maintenance invoice approval.
 */
import {
  adminEdgeInvokeHeaders,
  fetchAdminEdgeFunction,
} from '@/api/adminReassignVendor'
import { getAdminEdgeSecret } from '@/lib/adminEdgeAuth'
import { getActiveLandlordId } from '@/lib/activeLandlord'

export type PendingMaintenanceInvoice = {
  id: string
  maintenance_request_id: string
  total_cost: number
  labor_cost: number
  material_cost: number
  tax_amount: number
  invoice_number: string | null
  submitted_at: string
  vendor_id: string | null
  maintenance_requests: {
    unit: string
    issue_category: string | null
    urgency: string | null
    resident_name: string
  } | null
}

export type RecognizedMaintenanceSpend = {
  invoice_id: string
  maintenance_request_id: string
  total_cost: number
  spend_date: string
  spend_class: 'proactive' | 'reactive'
  urgency: string | null
  issue_category: string | null
  unit: string | null
}

export type MaintenanceBillingHistoryItem = {
  id: string
  status: 'approved' | 'rejected'
  totalCost: number
  invoiceNumber: string | null
  vendorName: string
  unit: string | null
  issueCategory: string | null
  eventAt: string
  rejectionReason: string | null
  paymentSource: string | null
  transactionId: string | null
  receiptUrl: string | null
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function metaString(meta: Record<string, unknown> | null, key: string): string | null {
  if (!meta) return null
  const value = meta[key]
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function approveInvoiceUrl(): string | undefined {
  const explicit = import.meta.env.VITE_ADMIN_APPROVE_INVOICE_URL?.trim()
  if (explicit) return explicit
  const reassign = import.meta.env.VITE_ADMIN_REASSIGN_URL?.trim()
  if (!reassign) return undefined
  return reassign.replace(/admin-reassign-vendor\/?$/, 'admin-approve-maintenance-invoice')
}

export async function fetchPendingMaintenanceInvoices(): Promise<
  PendingMaintenanceInvoice[]
> {
  const { supabase } = await import('@/lib/supabase')
  if (!supabase) return []

  const { data, error } = await supabase
    .from('maintenance_invoices')
    .select(
      `id, maintenance_request_id, total_cost, labor_cost, material_cost, tax_amount,
       invoice_number, submitted_at, vendor_id,
       maintenance_requests ( unit, issue_category, urgency, resident_name )`,
    )
    .eq('landlord_id', getActiveLandlordId())
    .eq('status', 'submitted')
    .order('submitted_at', { ascending: false })
    .limit(50)

  if (error) {
    console.error('[maintenance-invoice] pending fetch', error.message)
    return []
  }

  return (data ?? []) as PendingMaintenanceInvoice[]
}

export async function fetchRecognizedMaintenanceSpend(): Promise<
  RecognizedMaintenanceSpend[]
> {
  const { supabase } = await import('@/lib/supabase')
  if (!supabase) return []

  const landlordId = getActiveLandlordId()
  const year = new Date().getFullYear()
  const yearStart = `${year}-01-01T00:00:00.000Z`

  const { data, error } = await supabase
    .from('maintenance_recognized_spend_view')
    .select(
      'invoice_id, maintenance_request_id, total_cost, spend_date, spend_class, urgency, issue_category, unit',
    )
    .eq('landlord_id', landlordId)
    .gte('spend_date', yearStart)
    .order('spend_date', { ascending: true })

  if (error) {
    console.error('[maintenance-invoice] recognized spend fetch', error.message)
    return []
  }

  return (data ?? []) as RecognizedMaintenanceSpend[]
}

/** Paid (approved) + rejected vendor invoices for Settings → Billing history. */
export async function fetchMaintenanceBillingHistory(): Promise<
  MaintenanceBillingHistoryItem[]
> {
  const { supabase } = await import('@/lib/supabase')
  if (!supabase) return []

  const { data, error } = await supabase
    .from('maintenance_invoices')
    .select(
      `id, status, total_cost, invoice_number, submitted_at, approved_at, updated_at,
       rejection_reason, metadata, vendor_id,
       vendors ( name ),
       maintenance_requests ( unit, issue_category )`,
    )
    .eq('landlord_id', getActiveLandlordId())
    .in('status', ['approved', 'rejected'])
    .order('updated_at', { ascending: false })
    .limit(100)

  if (error) {
    console.error('[maintenance-invoice] billing history fetch', error.message)
    return []
  }

  return (data ?? []).flatMap((row) => {
    const status = String(row.status)
    if (status !== 'approved' && status !== 'rejected') return []

    const vendorJoin = Array.isArray(row.vendors) ? row.vendors[0] : row.vendors
    const requestJoin = Array.isArray(row.maintenance_requests)
      ? row.maintenance_requests[0]
      : row.maintenance_requests
    const vendorName =
      vendorJoin && typeof vendorJoin === 'object' && 'name' in vendorJoin
        ? String((vendorJoin as { name?: string | null }).name ?? '').trim() || 'Vendor'
        : 'Vendor'
    const unit =
      requestJoin && typeof requestJoin === 'object' && 'unit' in requestJoin
        ? String((requestJoin as { unit?: string | null }).unit ?? '').trim() || null
        : null
    const issueCategory =
      requestJoin && typeof requestJoin === 'object' && 'issue_category' in requestJoin
        ? String((requestJoin as { issue_category?: string | null }).issue_category ?? '')
            .trim() || null
        : null

    const meta = asRecord(row.metadata)
    const approvedAt =
      typeof row.approved_at === 'string' && row.approved_at.trim() ? row.approved_at : null
    const updatedAt =
      typeof row.updated_at === 'string' && row.updated_at.trim() ? row.updated_at : null
    const submittedAt =
      typeof row.submitted_at === 'string' && row.submitted_at.trim()
        ? row.submitted_at
        : new Date(0).toISOString()

    return [
      {
        id: String(row.id),
        status,
        totalCost: Number(row.total_cost ?? 0),
        invoiceNumber:
          typeof row.invoice_number === 'string' && row.invoice_number.trim()
            ? row.invoice_number.trim()
            : null,
        vendorName,
        unit,
        issueCategory,
        eventAt: (status === 'approved' ? approvedAt : updatedAt) || updatedAt || submittedAt,
        rejectionReason:
          typeof row.rejection_reason === 'string' && row.rejection_reason.trim()
            ? row.rejection_reason.trim()
            : metaString(meta, 'rejection_reason'),
        paymentSource: metaString(meta, 'payment_source'),
        transactionId: metaString(meta, 'transaction_id'),
        receiptUrl: metaString(meta, 'receipt_url'),
      } satisfies MaintenanceBillingHistoryItem,
    ]
  })
}

export async function approveMaintenanceInvoice(
  invoiceId: string,
  note?: string,
): Promise<void> {
  const url = approveInvoiceUrl()
  const secret = getAdminEdgeSecret()
  if (!url || !secret) {
    throw new Error('Invoice approval is not configured (admin Edge URL/secret).')
  }

  const res = await fetchAdminEdgeFunction(url, {
    method: 'POST',
    headers: adminEdgeInvokeHeaders(secret),
    body: JSON.stringify({
      invoiceId,
      landlordId: getActiveLandlordId(),
      action: 'approve',
      note: note?.trim() || undefined,
    }),
  })

  const payload = (await res.json().catch(() => ({}))) as { error?: string }
  if (!res.ok) {
    throw new Error(payload.error ?? `Approval failed (${res.status})`)
  }
}

export async function rejectMaintenanceInvoice(
  invoiceId: string,
  reason?: string,
): Promise<void> {
  const url = approveInvoiceUrl()
  const secret = getAdminEdgeSecret()
  if (!url || !secret) {
    throw new Error('Invoice approval is not configured (admin Edge URL/secret).')
  }

  const res = await fetchAdminEdgeFunction(url, {
    method: 'POST',
    headers: adminEdgeInvokeHeaders(secret),
    body: JSON.stringify({
      invoiceId,
      landlordId: getActiveLandlordId(),
      action: 'reject',
      rejectionReason: reason,
    }),
  })

  const payload = (await res.json().catch(() => ({}))) as { error?: string }
  if (!res.ok) {
    throw new Error(payload.error ?? `Rejection failed (${res.status})`)
  }
}
