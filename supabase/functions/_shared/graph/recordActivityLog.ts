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
import { shouldRecordGraphEvent } from "../../../../shared/landlordCapabilities.ts"

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

/** Automation outcomes that must not spam one row per cron pass. */
export const DEDUPED_ACTIVITY_EVENT_TYPES = new Set([
  "maintenance.sla_expired_needs_vendor",
  "maintenance.vendor_declined_needs_vendor",
  "maintenance.landlord_choice_unanswered",
  "maintenance.auto_reassign_loop_detected",
])

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

async function bumpDedupedActivityEvent(
  supabase: SupabaseClient,
  params: RecordActivityLogInput,
): Promise<string | null> {
  const ticketId = params.maintenanceRequestId?.trim()
  if (!ticketId || !DEDUPED_ACTIVITY_EVENT_TYPES.has(params.eventType)) {
    return null
  }

  // Episode-keyed: only bump an open episode. Closed episodes force a new insert.
  const { data: existing, error } = await supabase
    .from("operations_graph_events")
    .select("id, repeat_count, metadata, created_at")
    .eq("landlord_id", params.landlordId)
    .eq("event_type", params.eventType)
    .eq("maintenance_request_id", ticketId)
    .order("created_at", { ascending: false })
    .limit(5)

  if (error || !existing?.length) return null

  const open = existing.find((row) => {
    const meta =
      row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
        ? (row.metadata as Record<string, unknown>)
        : {}
    return meta.episode_closed_at == null
  })
  if (!open?.id) return null

  const prevCount =
    typeof open.repeat_count === "number" && Number.isFinite(open.repeat_count)
      ? Math.max(1, Math.floor(open.repeat_count))
      : 1
  const nextCount = prevCount + 1
  const now = new Date().toISOString()
  const priorMeta =
    open.metadata && typeof open.metadata === "object" && !Array.isArray(open.metadata)
      ? (open.metadata as Record<string, unknown>)
      : {}
  const metadata = {
    ...priorMeta,
    ...(params.metadata ?? {}),
    repeat_count: nextCount,
    last_seen_at: now,
    first_seen_at: priorMeta.first_seen_at ?? open.created_at ?? now,
    episode_open: true,
  }

  const { error: updErr } = await supabase
    .from("operations_graph_events")
    .update({
      repeat_count: nextCount,
      last_seen_at: now,
      metadata,
    })
    .eq("id", open.id)

  if (updErr) {
    console.error(
      "[recordActivityLog] dedupe update",
      params.eventType,
      updErr.message,
    )
    return null
  }
  return open.id as string
}

/**
 * Close the open needs-vendor activity episode so a later re-entry inserts a
 * new event instead of bumping the old row.
 */
export async function closeNeedsVendorActivityEpisode(
  supabase: SupabaseClient,
  params: {
    landlordId: string
    maintenanceRequestId: string
  },
): Promise<void> {
  const ticketId = params.maintenanceRequestId.trim()
  const landlordId = params.landlordId.trim()
  if (!ticketId || !landlordId) return

  const { data: rows } = await supabase
    .from("operations_graph_events")
    .select("id, metadata")
    .eq("landlord_id", landlordId)
    .eq("maintenance_request_id", ticketId)
    .in("event_type", [...DEDUPED_ACTIVITY_EVENT_TYPES])
    .order("created_at", { ascending: false })
    .limit(20)

  const now = new Date().toISOString()
  for (const row of rows ?? []) {
    const meta =
      row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
        ? (row.metadata as Record<string, unknown>)
        : {}
    if (meta.episode_closed_at != null) continue
    await supabase
      .from("operations_graph_events")
      .update({
        metadata: {
          ...meta,
          episode_closed_at: now,
          episode_open: false,
        },
      })
      .eq("id", row.id)
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
  if (!shouldRecordGraphEvent({ landlordId: params.landlordId, eventType: params.eventType })) {
    return null
  }
  const source = normalizeActivityLogSource(params.source)
  const metadata = params.metadata ?? {}

  if (
    DEDUPED_ACTIVITY_EVENT_TYPES.has(params.eventType) &&
    params.maintenanceRequestId?.trim()
  ) {
    const bumped = await bumpDedupedActivityEvent(supabase, params)
    if (bumped) return bumped
  }

  const now = new Date().toISOString()
  const isDeduped = DEDUPED_ACTIVITY_EVENT_TYPES.has(params.eventType)
  const insertRow: Record<string, unknown> = {
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
    metadata: isDeduped
      ? {
        ...metadata,
        repeat_count: 1,
        first_seen_at: now,
        last_seen_at: now,
        episode_open: true,
      }
      : metadata,
  }
  if (isDeduped) {
    insertRow.repeat_count = 1
    insertRow.last_seen_at = now
  }

  const { data, error } = await supabase
    .from("operations_graph_events")
    .insert(insertRow)
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
