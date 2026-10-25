import { getActiveLandlordId } from '@/lib/activeLandlord'
import { workflowOperationsPath } from '@/lib/adminWorkflowKanban'
import { maintenanceTicketIdFromWorkflowRun } from '@/lib/adminWorkflows'
import { supabase } from '@/lib/supabase'

const TICKET_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type TicketRun = {
  id: string
  templateId?: string | null
  entityType?: string | null
  entityId?: string | null
  metadata?: Record<string, unknown> | null
  inspectionGroupItems?: Array<{ ticketId: string }> | null
}

/** Active Tasks work order when a run exists; otherwise the request row. */
export function insightWorkOrderHref(input: { runId?: string | null; ticketId: string }): string {
  const runId = input.runId?.trim()
  if (runId) return workflowOperationsPath(runId)
  const ticketId = input.ticketId.trim()
  return `/admin/requests?request=${encodeURIComponent(ticketId)}`
}

export function pickWorkflowRunIdForTicket(
  runs: TicketRun[],
  ticketId: string,
  runMetadata: Record<string, Record<string, unknown> | undefined> = {},
): string | null {
  const id = ticketId.trim()
  if (!id) return null
  const matches = runs.filter((row) => {
    const linked = maintenanceTicketIdFromWorkflowRun({
      templateId: row.templateId,
      entityType: row.entityType,
      entityId: row.entityId,
      metadata: row.metadata ?? runMetadata[row.id] ?? null,
    })
    if (linked === id) return true
    return row.inspectionGroupItems?.some((item) => item.ticketId === id) ?? false
  })
  if (matches.length === 0) return null
  const requestRun = matches.find(
    (row) => row.templateId === 'maintenance_request' || row.entityType === 'maintenance_request',
  )
  return (requestRun ?? matches[0]!).id
}

export async function lookupWorkflowRunIdForTicket(ticketId: string): Promise<string | null> {
  const id = ticketId.trim()
  if (!TICKET_ID.test(id) || !supabase) return null
  const landlordId = getActiveLandlordId()
  const { data, error } = await supabase
    .from('workflow_runs')
    .select('id, template_id, entity_type, entity_id, metadata, started_at')
    .eq('landlord_id', landlordId)
    .or(
      `entity_id.eq.${id},metadata->>maintenance_request_id.eq.${id},metadata->>draft_ticket_id.eq.${id}`,
    )
    .order('started_at', { ascending: false })
    .limit(8)
  if (error || !data?.length) return null
  return pickWorkflowRunIdForTicket(
    data.map((row) => ({
      id: String(row.id),
      templateId: typeof row.template_id === 'string' ? row.template_id : null,
      entityType: typeof row.entity_type === 'string' ? row.entity_type : null,
      entityId: typeof row.entity_id === 'string' ? row.entity_id : null,
      metadata:
        row.metadata && typeof row.metadata === 'object'
          ? (row.metadata as Record<string, unknown>)
          : null,
    })),
    id,
  )
}
