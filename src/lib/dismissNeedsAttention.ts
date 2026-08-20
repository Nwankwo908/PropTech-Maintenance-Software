import { getActiveLandlordId } from '@/lib/activeLandlord'
import { recordActivityLog } from '@/lib/recordActivityLog'
import { supabase } from '@/lib/supabase'

export const ATTENTION_DISMISSED_EVENT = 'attention.dismissed'

export type DismissedAttentionIds = {
  ticketIds: Set<string>
  runIds: Set<string>
}

export const EMPTY_DISMISSED_ATTENTION_IDS: DismissedAttentionIds = {
  ticketIds: new Set(),
  runIds: new Set(),
}

export function isNeedsAttentionDismissed(
  dismissed: DismissedAttentionIds,
  ids: { ticketId?: string | null; runId?: string | null },
): boolean {
  const ticketId = ids.ticketId?.trim()
  const runId = ids.runId?.trim()
  if (ticketId && dismissed.ticketIds.has(ticketId)) return true
  if (runId && dismissed.runIds.has(runId)) return true
  return false
}

function asString(value: unknown): string {
  if (value == null) return ''
  return String(value).trim()
}

/** Ticket / workflow IDs a landlord removed from Needs Your Attention. */
export async function loadDismissedAttentionIds(
  landlordId: string = getActiveLandlordId(),
): Promise<DismissedAttentionIds> {
  const empty: DismissedAttentionIds = { ticketIds: new Set(), runIds: new Set() }
  if (!supabase || !landlordId.trim()) return empty

  const { data, error } = await supabase
    .from('operations_graph_events')
    .select('maintenance_request_id, workflow_run_id, metadata')
    .eq('landlord_id', landlordId)
    .eq('event_type', ATTENTION_DISMISSED_EVENT)
    .order('created_at', { ascending: false })
    .limit(200)

  if (error) {
    console.warn('[attention-dismissed] load', error.message)
    return empty
  }

  const ticketIds = new Set<string>()
  const runIds = new Set<string>()
  for (const row of data ?? []) {
    const ticketId = asString(row.maintenance_request_id)
    const runId = asString(row.workflow_run_id)
    const metadata =
      row.metadata && typeof row.metadata === 'object' && !Array.isArray(row.metadata)
        ? (row.metadata as Record<string, unknown>)
        : {}
    const metaTicket = asString(metadata.ticket_id)
    const metaRun = asString(metadata.workflow_run_id)
    if (ticketId) ticketIds.add(ticketId)
    if (metaTicket) ticketIds.add(metaTicket)
    if (runId) runIds.add(runId)
    if (metaRun) runIds.add(metaRun)
    const related = metadata.related_workflow_run_ids
    if (Array.isArray(related)) {
      for (const value of related) {
        const relatedId = asString(value)
        if (relatedId) runIds.add(relatedId)
      }
    }
  }
  return { ticketIds, runIds }
}

async function cancelEscalatedWorkflowRun(params: {
  landlordId: string
  runId: string
}): Promise<void> {
  if (!supabase) return
  const { data: run, error: fetchError } = await supabase
    .from('workflow_runs')
    .select('id, status, metadata')
    .eq('id', params.runId)
    .eq('landlord_id', params.landlordId)
    .maybeSingle()

  if (fetchError) {
    console.warn('[attention-dismissed] load run', fetchError.message)
    return
  }
  if (!run || run.status !== 'escalated') return

  const now = new Date().toISOString()
  const metadata =
    run.metadata && typeof run.metadata === 'object' && !Array.isArray(run.metadata)
      ? (run.metadata as Record<string, unknown>)
      : {}
  const { error: updateError } = await supabase
    .from('workflow_runs')
    .update({
      status: 'cancelled',
      current_step: 'cancelled',
      completed_at: now,
      metadata: {
        ...metadata,
        attention_dismissed_at: now,
        escalation_reason: null,
      },
    })
    .eq('id', params.runId)
    .eq('landlord_id', params.landlordId)

  if (updateError) {
    console.warn('[attention-dismissed] cancel run', updateError.message)
    return
  }

  const { error: eventError } = await supabase.from('workflow_events').insert({
    workflow_run_id: params.runId,
    event_type: 'workflow.log',
    step: 'cancelled',
    actor_type: 'landlord',
    message: 'Removed from Needs Your Attention',
    metadata: { attention_dismissed_at: now },
  })
  if (eventError) {
    console.warn('[attention-dismissed] run event', eventError.message)
  }
}

export async function dismissNeedsAttentionItem(params: {
  landlordId?: string
  ticketId?: string | null
  workflowRunId?: string | null
  relatedWorkflowRunIds?: string[]
  locationLabel?: string | null
}): Promise<{ ok: true; runIds: string[] } | { ok: false; error: string }> {
  if (!supabase) return { ok: false, error: 'Supabase is not configured.' }
  const landlordId = (params.landlordId ?? getActiveLandlordId()).trim()
  if (!landlordId) return { ok: false, error: 'Missing landlord.' }

  const ticketId = params.ticketId?.trim() || null
  const workflowRunId = params.workflowRunId?.trim() || null
  if (!ticketId && !workflowRunId) {
    return { ok: false, error: 'Nothing to remove.' }
  }

  const runIds = new Set<string>()
  if (workflowRunId) runIds.add(workflowRunId)
  for (const id of params.relatedWorkflowRunIds ?? []) {
    const trimmed = id.trim()
    if (trimmed) runIds.add(trimmed)
  }

  if (ticketId) {
    const { data: related, error: relatedError } = await supabase
      .from('workflow_runs')
      .select('id')
      .eq('landlord_id', landlordId)
      .eq('status', 'escalated')
      .eq('entity_type', 'maintenance_request')
      .eq('entity_id', ticketId)

    if (relatedError) {
      console.warn('[attention-dismissed] related runs', relatedError.message)
    } else {
      for (const row of related ?? []) {
        const id = asString(row.id)
        if (id) runIds.add(id)
      }
    }
  }

  const eventId = await recordActivityLog({
    landlordId,
    eventType: ATTENTION_DISMISSED_EVENT,
    source: 'dashboard',
    actorType: 'landlord',
    maintenanceRequestId: ticketId,
    workflowRunId: workflowRunId ?? [...runIds][0] ?? null,
    metadata: {
      ticket_id: ticketId,
      workflow_run_id: workflowRunId,
      related_workflow_run_ids: [...runIds],
      message: params.locationLabel
        ? `Removed from Needs Your Attention (${params.locationLabel}).`
        : 'Removed from Needs Your Attention.',
    },
  })

  if (!eventId) return { ok: false, error: 'Something went wrong. Please try again.' }

  for (const runId of runIds) {
    await cancelEscalatedWorkflowRun({ landlordId, runId })
  }

  return { ok: true, runIds: [...runIds] }
}
