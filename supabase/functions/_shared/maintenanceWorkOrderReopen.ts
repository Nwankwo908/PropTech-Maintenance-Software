/**
 * Durable same-ticket reopen audit (completed/cancelled → open).
 * Uses public.record_maintenance_work_order_reopen (dedupes with the DB trigger).
 */
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1'

export type WorkOrderReopenTriggeredBy = 'tenant_sms' | 'landlord' | 'admin' | 'system'

const CLOSED = new Set(['completed', 'cancelled'])

export function isWorkOrderReopenTransition(
  previousStatus: string | null | undefined,
  newStatus: string | null | undefined,
): boolean {
  const prev = (previousStatus ?? '').trim().toLowerCase()
  const next = (newStatus ?? '').trim().toLowerCase()
  if (!CLOSED.has(prev)) return false
  if (!next || CLOSED.has(next)) return false
  return true
}

/** Vendor Needs your attention: completed → open only (not cancelled → open). */
export function isCompletedToOpenReopen(
  previousStatus: string | null | undefined,
  newStatus: string | null | undefined,
): boolean {
  const prev = (previousStatus ?? '').trim().toLowerCase()
  const next = (newStatus ?? '').trim().toLowerCase()
  if (prev !== 'completed') return false
  if (!next || CLOSED.has(next)) return false
  return true
}

export async function recordWorkOrderReopen(
  db: SupabaseClient,
  input: {
    landlordId: string
    maintenanceRequestId: string
    vendorId?: string | null
    previousStatus: string
    newStatus: string
    triggeredBy: WorkOrderReopenTriggeredBy
    triggerRef?: string | null
  },
): Promise<string | null> {
  if (!isWorkOrderReopenTransition(input.previousStatus, input.newStatus)) return null
  const { data, error } = await db.rpc('record_maintenance_work_order_reopen', {
    p_landlord_id: input.landlordId,
    p_maintenance_request_id: input.maintenanceRequestId,
    p_vendor_id: input.vendorId?.trim() || null,
    p_previous_status: input.previousStatus,
    p_new_status: input.newStatus,
    p_triggered_by: input.triggeredBy,
    p_trigger_ref: input.triggerRef ?? null,
  })
  if (error) {
    console.warn(
      JSON.stringify({
        event: 'maintenance.work_order_reopen_record_failed',
        ticketId: input.maintenanceRequestId,
        message: error.message,
      }),
    )
    return null
  }
  return typeof data === 'string' ? data : data != null ? String(data) : null
}
