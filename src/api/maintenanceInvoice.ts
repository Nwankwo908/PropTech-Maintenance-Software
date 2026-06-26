/**
 * Admin Edge Functions for maintenance invoice approval.
 */
import {
  adminEdgeInvokeHeaders,
  fetchAdminEdgeFunction,
} from '@/api/adminReassignVendor'
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

export async function approveMaintenanceInvoice(invoiceId: string): Promise<void> {
  const url = approveInvoiceUrl()
  const secret = import.meta.env.VITE_ADMIN_REASSIGN_SECRET?.trim()
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
  const secret = import.meta.env.VITE_ADMIN_REASSIGN_SECRET?.trim()
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
