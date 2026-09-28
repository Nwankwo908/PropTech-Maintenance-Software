/**
 * Admin Edge Functions for maintenance invoice approval.
 */
import {
  adminEdgeInvokeHeaders,
  fetchAdminEdgeFunction,
} from '@/api/adminReassignVendor'
import { getAdminEdgeSecret } from '@/lib/adminEdgeAuth'
import { getActiveLandlordId } from '@/lib/activeLandlord'
import { landlordHasPayments } from '@shared/landlordCapabilities'

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

  const landlordId = getActiveLandlordId()
  // Invoice rows only — nested maintenance_requests embeds can empty the parent
  // result under client RLS.
  const { data, error } = await supabase
    .from('maintenance_invoices')
    .select(
      `id, maintenance_request_id, total_cost, labor_cost, material_cost, tax_amount,
       invoice_number, submitted_at, vendor_id`,
    )
    .eq('landlord_id', landlordId)
    .eq('status', 'submitted')
    .order('submitted_at', { ascending: false })
    .limit(50)

  if (error) {
    console.error('[maintenance-invoice] pending fetch', error.message)
    return []
  }

  const invoices = (data ?? []) as Array<Record<string, unknown>>
  const ticketIds = invoices
    .map((row) =>
      typeof row.maintenance_request_id === 'string' ? row.maintenance_request_id : '',
    )
    .filter(Boolean)

  const ticketById = new Map<
    string,
    {
      unit: string
      issue_category: string | null
      urgency: string | null
      resident_name: string
    }
  >()
  if (ticketIds.length > 0) {
    const { data: tickets } = await supabase
      .from('maintenance_requests')
      .select('id, unit, issue_category, urgency, resident_name')
      .in('id', ticketIds)
    for (const raw of (tickets ?? []) as Array<Record<string, unknown>>) {
      const id = typeof raw.id === 'string' ? raw.id : ''
      if (!id) continue
      ticketById.set(id, {
        unit: typeof raw.unit === 'string' ? raw.unit : '',
        issue_category:
          typeof raw.issue_category === 'string' ? raw.issue_category : null,
        urgency: typeof raw.urgency === 'string' ? raw.urgency : null,
        resident_name:
          typeof raw.resident_name === 'string' ? raw.resident_name : 'Resident',
      })
    }
  }

  return invoices.map((row) => {
    const ticketId =
      typeof row.maintenance_request_id === 'string' ? row.maintenance_request_id : ''
    return {
      id: String(row.id ?? ''),
      maintenance_request_id: ticketId,
      total_cost: Number(row.total_cost ?? 0),
      labor_cost: Number(row.labor_cost ?? 0),
      material_cost: Number(row.material_cost ?? 0),
      tax_amount: Number(row.tax_amount ?? 0),
      invoice_number:
        typeof row.invoice_number === 'string' ? row.invoice_number : null,
      submitted_at:
        typeof row.submitted_at === 'string'
          ? row.submitted_at
          : new Date(0).toISOString(),
      vendor_id: typeof row.vendor_id === 'string' ? row.vendor_id : null,
      maintenance_requests: ticketById.get(ticketId) ?? null,
    } satisfies PendingMaintenanceInvoice
  })
}

export async function fetchRecognizedMaintenanceSpend(): Promise<
  RecognizedMaintenanceSpend[]
> {
  const { supabase } = await import('@/lib/supabase')
  if (!supabase) return []

  const landlordId = getActiveLandlordId()
  // Local calendar year — matches Overview / Properties YTD window.
  const yearStart = new Date(new Date().getFullYear(), 0, 1).toISOString()
  // Limited Alpha has no Stripe pay rail — vendor-submitted invoices are the
  // real cost. Full accounts still require landlord approval before YTD.
  const paymentsEnabled = landlordHasPayments(landlordId)
  const statuses = paymentsEnabled ? (['approved'] as const) : (['approved', 'submitted'] as const)

  // Invoice rows only — no nested joins. Joining maintenance_requests under
  // client RLS can fail the whole query and leave YTD at $0 even when approved
  // invoices exist (vendor YTD paid total works for the same reason).
  const { data, error } = await supabase
    .from('maintenance_invoices')
    .select('id, maintenance_request_id, total_cost, status, approved_at, submitted_at')
    .eq('landlord_id', landlordId)
    .in('status', [...statuses])
    .gte('submitted_at', yearStart)
    .order('submitted_at', { ascending: true })

  // #region agent log
  const { data: diagRows, error: diagErr } = await supabase
    .from('maintenance_invoices')
    .select('id, status, total_cost, landlord_id, approved_at, submitted_at')
    .eq('landlord_id', landlordId)
    .order('submitted_at', { ascending: false })
    .limit(20)
  fetch('http://127.0.0.1:7898/ingest/3050e2ef-64dd-49e5-a718-1f5719c45963',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'5d0562'},body:JSON.stringify({sessionId:'5d0562',location:'maintenanceInvoice.ts:fetchRecognized:diag',message:'all invoices for landlord',data:{landlordId,paymentsEnabled,statuses:[...statuses],diagError:diagErr?.message??null,diagCount:(diagRows??[]).length,diag:(diagRows??[]).slice(0,10).map((r)=>({status:r.status,total:r.total_cost,approved:r.approved_at,submitted:r.submitted_at}))},timestamp:Date.now(),hypothesisId:'E'})}).catch(()=>{})
  // #endregion

  if (error) {
    console.error('[maintenance-invoice] recognized spend fetch', error.message)
    // #region agent log
    fetch('http://127.0.0.1:7898/ingest/3050e2ef-64dd-49e5-a718-1f5719c45963',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'5d0562'},body:JSON.stringify({sessionId:'5d0562',location:'maintenanceInvoice.ts:fetchRecognized',message:'invoice spend query failed',data:{landlordId,error:error.message,yearStart,paymentsEnabled},timestamp:Date.now(),hypothesisId:'A'})}).catch(()=>{})
    // #endregion
    return []
  }

  const rows = (data ?? []).flatMap((row) => {
    const invoiceId = typeof row.id === 'string' ? row.id : ''
    const ticketId =
      typeof row.maintenance_request_id === 'string' ? row.maintenance_request_id : ''
    const status = typeof row.status === 'string' ? row.status : ''
    const approvedAt =
      typeof row.approved_at === 'string' && row.approved_at.trim()
        ? row.approved_at
        : ''
    const submittedAt =
      typeof row.submitted_at === 'string' && row.submitted_at.trim()
        ? row.submitted_at
        : ''
    // Prefer approval date when paid; otherwise use submit date (Limited Alpha).
    const spendDate =
      status === 'approved' && approvedAt
        ? approvedAt
        : submittedAt
    const totalCost = Number(row.total_cost ?? 0)
    if (!invoiceId || !ticketId || !spendDate || !Number.isFinite(totalCost) || totalCost <= 0) {
      return []
    }
    if (paymentsEnabled && (status !== 'approved' || !approvedAt)) {
      return []
    }

    return [
      {
        invoice_id: invoiceId,
        maintenance_request_id: ticketId,
        total_cost: totalCost,
        spend_date: spendDate,
        spend_class: 'proactive' as const,
        urgency: null,
        issue_category: null,
        unit: null,
      } satisfies RecognizedMaintenanceSpend,
    ]
  })

  // #region agent log
  fetch('http://127.0.0.1:7898/ingest/3050e2ef-64dd-49e5-a718-1f5719c45963',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'5d0562'},body:JSON.stringify({sessionId:'5d0562',location:'maintenanceInvoice.ts:fetchRecognized',message:'invoice spend query ok',data:{landlordId,yearStart,paymentsEnabled,rawCount:(data??[]).length,mappedCount:rows.length,sample:rows.slice(0,3).map(r=>({total:r.total_cost,statusDate:r.spend_date,ticket:r.maintenance_request_id.slice(0,8)}))},timestamp:Date.now(),hypothesisId:'B'})}).catch(()=>{})
  // #endregion

  return rows
}

/** Sum approved invoice totals whose spend_date falls in [fromMs, toMs). */
export function sumRecognizedSpendBetween(
  rows: Array<{ total_cost: number; spend_date: string }>,
  fromMs: number,
  toMs: number,
): number {
  return rows.reduce((sum, row) => {
    const at = new Date(row.spend_date).getTime()
    if (Number.isNaN(at) || at < fromMs || at >= toMs) return sum
    const amount = Number(row.total_cost)
    if (!Number.isFinite(amount) || amount <= 0) return sum
    return sum + amount
  }, 0)
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
