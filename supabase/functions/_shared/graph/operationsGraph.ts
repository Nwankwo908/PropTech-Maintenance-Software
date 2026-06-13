import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import {
  logGraphEvent,
  type GraphEventActorType,
  type GraphEventSource,
  type LogGraphEventInput,
} from "./logGraphEvent.ts"

/** Canonical graph event namespaces by workflow domain. */
export const GRAPH_EVENT_NAMESPACES = {
  workflow: "workflow",
  rent: "rent",
  lease: "lease",
  maintenance: "maintenance",
  moveIn: "move_in",
  moveOut: "move_out",
  inspection: "inspection",
  unit: "unit",
} as const

export type OperationsGraphScope = {
  landlordId: string
  workflowRunId?: string | null
  workflowTemplateId?: string | null
  propertyId?: string | null
  unitId?: string | null
  residentId?: string | null
  vendorId?: string | null
  maintenanceRequestId?: string | null
  occupancyId?: string | null
  inspectionId?: string | null
  taskId?: string | null
  conversationId?: string | null
  messageId?: string | null
  unitLabel?: string | null
  building?: string | null
}

export type ResolvedOperationsGraphScope = {
  landlordId: string
  propertyId: string | null
  unitId: string | null
  residentId: string | null
}

/**
 * Resolve property_id and unit_id from resident occupancy or unit label.
 * Shared by rent, move-in, move-out, and inspection workflows.
 */
export async function resolveOperationsGraphScope(
  supabase: SupabaseClient,
  scope: OperationsGraphScope,
): Promise<ResolvedOperationsGraphScope> {
  let unitId = scope.unitId ?? null
  let propertyId = scope.propertyId ?? null
  let building = scope.building?.trim() || null
  const residentId = scope.residentId ?? null

  if (!unitId && scope.occupancyId) {
    const { data: occupancy } = await supabase
      .from("occupancy")
      .select("unit_id, resident_id")
      .eq("id", scope.occupancyId)
      .maybeSingle()

    if (occupancy?.unit_id) {
      unitId = String(occupancy.unit_id)
    }
  }

  if (!unitId && residentId) {
    const { data: occupancy } = await supabase
      .from("occupancy")
      .select("unit_id")
      .eq("resident_id", residentId)
      .eq("status", "active")
      .limit(1)
      .maybeSingle()

    if (occupancy?.unit_id) {
      unitId = String(occupancy.unit_id)
    }
  }

  if (!unitId && scope.unitLabel?.trim() && scope.landlordId) {
    let query = supabase
      .from("units")
      .select("id, building")
      .eq("landlord_id", scope.landlordId)
      .eq("unit_label", scope.unitLabel.trim())

    if (building) {
      query = query.eq("building", building)
    }

    const { data: unit } = await query.limit(1).maybeSingle()
    if (unit?.id) {
      unitId = String(unit.id)
      if (!building && unit.building != null) {
        building = String(unit.building)
      }
    }
  }

  if (!building && unitId) {
    const { data: unit } = await supabase
      .from("units")
      .select("building")
      .eq("id", unitId)
      .maybeSingle()

    if (unit?.building != null) {
      building = String(unit.building)
    }
  }

  if (!propertyId && scope.landlordId) {
    const { data, error } = await supabase.rpc("derive_property_id", {
      p_landlord_id: scope.landlordId,
      p_building: building ?? "",
    })

    if (!error && data != null) {
      propertyId = String(data)
    }
  }

  return {
    landlordId: scope.landlordId,
    propertyId,
    unitId,
    residentId,
  }
}

export type LogOperationsGraphEventParams = {
  scope: OperationsGraphScope
  eventType: string
  source?: GraphEventSource
  actorType?: GraphEventActorType | null
  actorId?: string | null
  metadata?: Record<string, unknown>
}

/** Append a domain event to the shared property operations graph. */
export async function logOperationsGraphEvent(
  supabase: SupabaseClient,
  params: LogOperationsGraphEventParams,
): Promise<string | null> {
  const resolved = await resolveOperationsGraphScope(supabase, params.scope)

  const input: LogGraphEventInput = {
    landlord_id: resolved.landlordId,
    event_type: params.eventType,
    source: params.source ?? "automation",
    actor_type: params.actorType ?? "system",
    actor_id: params.actorId ?? null,
    property_id: resolved.propertyId,
    unit_id: resolved.unitId,
    resident_id: resolved.residentId,
    vendor_id: params.scope.vendorId ?? null,
    maintenance_request_id: params.scope.maintenanceRequestId ?? null,
    conversation_id: params.scope.conversationId ?? null,
    message_id: params.scope.messageId ?? null,
    workflow_run_id: params.scope.workflowRunId ?? null,
    workflow_template_id: params.scope.workflowTemplateId ?? null,
    occupancy_id: params.scope.occupancyId ?? null,
    inspection_id: params.scope.inspectionId ?? null,
    task_id: params.scope.taskId ?? null,
    metadata: params.metadata ?? {},
  }

  return logGraphEvent(supabase, input)
}

export function graphScopeFromWorkflowRun(
  run: {
    id: string
    template_id?: string | null
    workflow_type?: string | null
    landlord_id?: string | null
    resident_id?: string | null
    unit_id?: string | null
    property_id?: string | null
    metadata?: Record<string, unknown> | null
  },
  landlordId: string,
): OperationsGraphScope {
  return {
    landlordId,
    workflowRunId: run.id,
    workflowTemplateId: run.workflow_type ?? run.template_id ?? null,
    residentId: run.resident_id ?? null,
    unitId: run.unit_id ?? null,
    propertyId: run.property_id ?? null,
    unitLabel: typeof run.metadata?.unit_label === "string"
      ? run.metadata.unit_label
      : null,
    building: typeof run.metadata?.building === "string"
      ? run.metadata.building
      : null,
    occupancyId: typeof run.metadata?.occupancy_id === "string"
      ? run.metadata.occupancy_id
      : null,
    inspectionId: typeof run.metadata?.inspection_id === "string"
      ? run.metadata.inspection_id
      : null,
    taskId: typeof run.metadata?.task_id === "string"
      ? run.metadata.task_id
      : null,
  }
}
