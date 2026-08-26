/**
 * Property-detail emergency Review: stop a job when there is no pending estimate.
 * Mirrors resident cancel — ticket cancelled + linked maintenance workflow runs closed.
 */
import { getActiveLandlordId } from '@/lib/activeLandlord'
import { recordActivityLog } from '@/lib/recordActivityLog'
import { supabase } from '@/lib/supabase'

const OPEN_RUN_STATUSES = ['active', 'escalated'] as const
const MAINTENANCE_TEMPLATES = ['maintenance_intake', 'maintenance_request'] as const

export async function cancelEmergencyWorkOrder(input: {
  ticketId: string
  workflowRunId?: string | null
  propertyId?: string | null
  vendorId?: string | null
}): Promise<void> {
  if (!supabase) {
    throw new Error("We can't reach the server right now. Please try again in a moment.")
  }

  const ticketId = input.ticketId.trim()
  if (!ticketId) throw new Error('Missing work order id.')

  const landlordId = getActiveLandlordId()
  const nowIso = new Date().toISOString()

  const { error: ticketError } = await supabase
    .from('maintenance_requests')
    .update({
      vendor_work_status: 'cancelled',
      assigned_vendor_id: null,
      updated_at: nowIso,
    })
    .eq('id', ticketId)
    .eq('landlord_id', landlordId)

  if (ticketError) {
    throw new Error(ticketError.message || 'Could not cancel this work order.')
  }

  const runIds = new Set<string>()
  if (input.workflowRunId?.trim()) {
    runIds.add(input.workflowRunId.trim())
  }

  const base = () =>
    supabase!
      .from('workflow_runs')
      .select('id, entity_id, metadata')
      .eq('landlord_id', landlordId)
      .in('status', [...OPEN_RUN_STATUSES])
      .in('template_id', [...MAINTENANCE_TEMPLATES])

  const [byEntity, byDraft, byMeta] = await Promise.all([
    base().eq('entity_id', ticketId),
    base().eq('metadata->>draft_ticket_id', ticketId),
    base().eq('metadata->>maintenance_request_id', ticketId),
  ])

  for (const result of [byEntity, byDraft, byMeta]) {
    for (const row of result.data ?? []) {
      const id = typeof row.id === 'string' ? row.id : ''
      if (id) runIds.add(id)
    }
  }

  if (runIds.size > 0) {
    const { error: runError } = await supabase
      .from('workflow_runs')
      .update({ status: 'cancelled', updated_at: nowIso })
      .in('id', [...runIds])
      .eq('landlord_id', landlordId)

    if (runError) {
      console.warn('[cancelEmergencyWorkOrder] workflow cancel', runError.message)
    }
  }

  void recordActivityLog({
    landlordId,
    eventType: 'maintenance.emergency_declined',
    source: 'dashboard',
    actorType: 'landlord',
    maintenanceRequestId: ticketId,
    propertyId: input.propertyId ?? null,
    vendorId: input.vendorId ?? null,
    workflowRunId: input.workflowRunId ?? null,
    metadata: {
      message: 'Property team declined emergency work and closed the work order.',
    },
  })
}

export async function acknowledgeEmergencyWorkProceed(input: {
  ticketId: string
  workflowRunId?: string | null
  propertyId?: string | null
  vendorId?: string | null
}): Promise<void> {
  const landlordId = getActiveLandlordId()
  await recordActivityLog({
    landlordId,
    eventType: 'maintenance.emergency_approved',
    source: 'dashboard',
    actorType: 'landlord',
    maintenanceRequestId: input.ticketId,
    propertyId: input.propertyId ?? null,
    vendorId: input.vendorId ?? null,
    workflowRunId: input.workflowRunId ?? null,
    metadata: {
      message: 'Property team approved continuing emergency work.',
    },
  })
}
