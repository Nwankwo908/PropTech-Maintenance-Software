/**
 * Official activity log writer for all Ulo features.
 *
 * Every meaningful interaction must go through `recordActivityLog`.
 * Legacy helpers (`logGraphEvent`, `logOperationsGraphEvent`,
 * `logPropertyOperationsGraph`) delegate here so call sites stay valid.
 *
 * Writes:
 * 1. operations_graph_events (primary activity feed / graph)
 * 2. property_operations_graph (best-effort dual-write for Overview)
 */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"

export type ActivityLogSource =
  | "sms"
  | "dashboard"
  | "vendor_portal"
  | "edge_function"
  | "automation"

export type ActivityLogActorType =
  | "resident"
  | "vendor"
  | "landlord"
  | "system"

export type RecordActivityLogInput = {
  landlordId: string
  eventType: string
  source: ActivityLogSource
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
  /**
   * Also write property_operations_graph (default true).
   * Set false only for internal dual-write loops.
   */
  dualWritePropertyGraph?: boolean
}

/** Normalize legacy / invalid source labels to the DB CHECK enum. */
export function normalizeActivityLogSource(
  source: string | null | undefined,
): ActivityLogSource {
  const value = (source ?? "").trim().toLowerCase()
  switch (value) {
    case "sms":
      return "sms"
    case "dashboard":
    case "admin_ui":
    case "onboarding":
    case "admin":
      return "dashboard"
    case "vendor_portal":
      return "vendor_portal"
    case "edge_function":
      return "edge_function"
    case "automation":
    case "system":
    case "cron":
      return "automation"
    default:
      return "automation"
  }
}

/**
 * Official activity log append. Non-throwing; returns event id or null.
 * This is the only method features should call for activity history.
 */
export async function recordActivityLog(
  supabase: SupabaseClient,
  params: RecordActivityLogInput,
): Promise<string | null> {
  const source = normalizeActivityLogSource(params.source)
  const metadata = params.metadata ?? {}

  const { data, error } = await supabase
    .from("operations_graph_events")
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
    .select("id")
    .single()

  if (error) {
    console.error(
      "[recordActivityLog]",
      params.eventType,
      source,
      error.message,
    )
    return null
  }

  const eventId = (data?.id as string | undefined) ?? null

  if (params.dualWritePropertyGraph !== false) {
    const { error: pogError } = await supabase
      .from("property_operations_graph")
      .insert({
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
      console.error(
        "[recordActivityLog] property_operations_graph",
        params.eventType,
        pogError.message,
      )
    }
  }

  return eventId
}
