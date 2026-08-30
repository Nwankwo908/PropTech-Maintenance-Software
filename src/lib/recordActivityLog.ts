/**
 * Official client-side activity log writer.
 *
 * Every dashboard / onboarding feature must record activity through this helper.
 * Do not insert into `operations_graph_events` directly.
 */
import { shouldRecordGraphEvent } from '@shared/landlordCapabilities'
import { supabase } from '@/lib/supabase'

export type ActivityLogSource =
  | 'sms'
  | 'dashboard'
  | 'vendor_portal'
  | 'edge_function'
  | 'automation'

export type ActivityLogActorType = 'resident' | 'vendor' | 'landlord' | 'system'

export type RecordActivityLogInput = {
  landlordId: string
  eventType: string
  /** Invalid aliases (admin_ui, onboarding) are normalized to dashboard. */
  source: ActivityLogSource | string
  actorType?: ActivityLogActorType | null
  actorId?: string | null
  propertyId?: string | null
  unitId?: string | null
  residentId?: string | null
  vendorId?: string | null
  maintenanceRequestId?: string | null
  conversationId?: string | null
  messageId?: string | null
  workflowRunId?: string | null
  workflowTemplateId?: string | null
  occupancyId?: string | null
  inspectionId?: string | null
  taskId?: string | null
  /** Prefer a user-facing `message` string for the Overview activity feed. */
  metadata?: Record<string, unknown>
  dualWritePropertyGraph?: boolean
}

export function normalizeActivityLogSource(
  source: string | null | undefined,
): ActivityLogSource {
  const value = (source ?? '').trim().toLowerCase()
  switch (value) {
    case 'sms':
      return 'sms'
    case 'dashboard':
    case 'admin_ui':
    case 'onboarding':
    case 'admin':
      return 'dashboard'
    case 'vendor_portal':
      return 'vendor_portal'
    case 'edge_function':
      return 'edge_function'
    case 'automation':
    case 'system':
    case 'cron':
      return 'automation'
    default:
      return 'automation'
  }
}

/**
 * Official activity log append (non-throwing). Returns event id or null.
 */
export async function recordActivityLog(
  params: RecordActivityLogInput,
): Promise<string | null> {
  if (!supabase) return null
  if (!shouldRecordGraphEvent({ landlordId: params.landlordId, eventType: params.eventType })) {
    return null
  }

  const source = normalizeActivityLogSource(params.source)
  const metadata = params.metadata ?? {}

  const { data, error } = await supabase
    .from('operations_graph_events')
    .insert({
      landlord_id: params.landlordId,
      event_type: params.eventType,
      source,
      actor_type: params.actorType ?? null,
      actor_id: params.actorId ?? null,
      property_id: params.propertyId ?? null,
      unit_id: params.unitId ?? null,
      resident_id: params.residentId ?? null,
      vendor_id: params.vendorId ?? null,
      maintenance_request_id: params.maintenanceRequestId ?? null,
      conversation_id: params.conversationId ?? null,
      message_id: params.messageId ?? null,
      workflow_run_id: params.workflowRunId ?? null,
      workflow_template_id: params.workflowTemplateId ?? null,
      occupancy_id: params.occupancyId ?? null,
      inspection_id: params.inspectionId ?? null,
      task_id: params.taskId ?? null,
      metadata,
    })
    .select('id')
    .single()

  if (error) {
    console.warn('[recordActivityLog]', params.eventType, source, error.message)
    return null
  }

  const eventId = data?.id ? String(data.id) : null

  if (params.dualWritePropertyGraph !== false) {
    const { error: pogError } = await supabase.from('property_operations_graph').insert({
      landlord_id: params.landlordId,
      property_id: params.propertyId ?? null,
      unit_id: params.unitId ?? null,
      resident_id: params.residentId ?? null,
      vendor_id: params.vendorId ?? null,
      workflow_run_id: params.workflowRunId ?? null,
      event_type: params.eventType,
      event_source: source,
      event_payload: metadata,
    })
    if (pogError) {
      console.warn(
        '[recordActivityLog] property_operations_graph',
        params.eventType,
        pogError.message,
      )
    }
  }

  return eventId
}
