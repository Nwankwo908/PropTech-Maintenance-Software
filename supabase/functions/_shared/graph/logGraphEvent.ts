/**
 * Legacy flat activity-log helper.
 * Delegates to the official `recordActivityLog` — prefer calling that directly.
 */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import {
  recordActivityLog,
  type ActivityLogActorType,
  type ActivityLogSource,
} from "./recordActivityLog.ts"

export type GraphEventSource = ActivityLogSource
export type GraphEventActorType = ActivityLogActorType

export type LogGraphEventInput = {
  landlord_id: string
  event_type: string
  source: GraphEventSource
  actor_type?: GraphEventActorType | null
  actor_id?: string | null
  property_id?: string | null
  unit_id?: string | null
  resident_id?: string | null
  vendor_id?: string | null
  maintenance_request_id?: string | null
  conversation_id?: string | null
  message_id?: string | null
  workflow_run_id?: string | null
  workflow_template_id?: string | null
  occupancy_id?: string | null
  inspection_id?: string | null
  task_id?: string | null
  metadata?: Record<string, unknown>
}

/** @deprecated Prefer `recordActivityLog`. Delegates to the official activity log. */
export async function logGraphEvent(
  supabase: SupabaseClient,
  params: LogGraphEventInput,
): Promise<string | null> {
  return recordActivityLog(supabase, {
    landlordId: params.landlord_id,
    eventType: params.event_type,
    source: params.source,
    actorType: params.actor_type ?? null,
    actorId: params.actor_id ?? null,
    propertyId: params.property_id ?? null,
    unitId: params.unit_id ?? null,
    residentId: params.resident_id ?? null,
    vendorId: params.vendor_id ?? null,
    maintenanceRequestId: params.maintenance_request_id ?? null,
    conversationId: params.conversation_id ?? null,
    messageId: params.message_id ?? null,
    workflowRunId: params.workflow_run_id ?? null,
    workflowTemplateId: params.workflow_template_id ?? null,
    occupancyId: params.occupancy_id ?? null,
    inspectionId: params.inspection_id ?? null,
    taskId: params.task_id ?? null,
    metadata: params.metadata ?? {},
  })
}

export {
  recordActivityLog,
  normalizeActivityLogSource,
  type RecordActivityLogInput,
  type ActivityLogSource,
  type ActivityLogActorType,
} from "./recordActivityLog.ts"
