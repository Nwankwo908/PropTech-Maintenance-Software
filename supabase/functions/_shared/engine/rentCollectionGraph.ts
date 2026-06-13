import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import {
  logGraphEvent,
  type GraphEventActorType,
  type GraphEventSource,
} from "../graph/logGraphEvent.ts"
import { logLedgerEvent, type LedgerEventDirection } from "./ledgerEvents.ts"

/** Canonical rent collection operations graph event types. */
export const RENT_GRAPH_EVENTS = {
  dueDetected: "rent.due_detected",
  reminderSent: "rent.reminder_sent",
  paymentRequested: "rent.payment_requested",
  paymentReceived: "rent.payment_received",
  lateEscalated: "rent.late_escalated",
  ledgerUpdated: "rent.ledger_updated",
} as const

export type RentCollectionGraphScope = {
  landlordId: string
  workflowRunId: string
  residentId?: string | null
  unitId?: string | null
  propertyId?: string | null
  unitLabel?: string | null
  building?: string | null
}

export type ResolvedRentCollectionGraphScope = {
  landlordId: string
  workflowRunId: string
  residentId: string | null
  unitId: string | null
  propertyId: string | null
}

/** Resolve unit_id and property_id for graph linkage when not on the workflow run. */
export async function resolveRentCollectionGraphScope(
  supabase: SupabaseClient,
  scope: RentCollectionGraphScope,
): Promise<ResolvedRentCollectionGraphScope> {
  let unitId = scope.unitId ?? null
  let propertyId = scope.propertyId ?? null
  let building = scope.building?.trim() || null

  if (!unitId && scope.residentId) {
    const { data: occupancy } = await supabase
      .from("occupancy")
      .select("unit_id")
      .eq("resident_id", scope.residentId)
      .eq("status", "active")
      .limit(1)
      .maybeSingle()

    unitId = occupancy?.unit_id == null ? null : String(occupancy.unit_id)
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
    workflowRunId: scope.workflowRunId,
    residentId: scope.residentId ?? null,
    unitId,
    propertyId,
  }
}

export async function logRentCollectionGraphEvent(
  supabase: SupabaseClient,
  scope: RentCollectionGraphScope,
  params: {
    eventType: string
    metadata?: Record<string, unknown>
    source?: GraphEventSource
    actorType?: GraphEventActorType | null
  },
): Promise<string | null> {
  const resolved = await resolveRentCollectionGraphScope(supabase, scope)

  return logGraphEvent(supabase, {
    landlord_id: resolved.landlordId,
    event_type: params.eventType,
    source: params.source ?? "automation",
    actor_type: params.actorType ?? "system",
    resident_id: resolved.residentId,
    unit_id: resolved.unitId,
    property_id: resolved.propertyId,
    workflow_run_id: resolved.workflowRunId,
    workflow_template_id: "rent_collection",
    metadata: params.metadata ?? {},
  })
}

/** Append ledger_events and log rent.ledger_updated on the operations graph. */
export async function logRentCollectionLedgerWithGraph(
  supabase: SupabaseClient,
  scope: RentCollectionGraphScope,
  params: {
    ledgerEventType: string
    direction?: LedgerEventDirection
    amount?: number | null
    billingPeriod?: string | null
    description?: string | null
    metadata?: Record<string, unknown>
  },
): Promise<string | null> {
  const resolved = await resolveRentCollectionGraphScope(supabase, scope)

  const ledgerId = await logLedgerEvent(supabase, {
    landlordId: resolved.landlordId,
    workflowRunId: resolved.workflowRunId,
    workflowType: "rent_collection",
    residentId: resolved.residentId,
    unitId: resolved.unitId,
    propertyId: resolved.propertyId,
    eventType: params.ledgerEventType,
    direction: params.direction ?? "debit",
    amount: params.amount ?? null,
    billingPeriod: params.billingPeriod ?? null,
    description: params.description ?? null,
    metadata: params.metadata ?? {},
  })

  await logRentCollectionGraphEvent(supabase, scope, {
    eventType: RENT_GRAPH_EVENTS.ledgerUpdated,
    metadata: {
      ledger_event_id: ledgerId,
      ledger_event_type: params.ledgerEventType,
      direction: params.direction ?? "debit",
      amount: params.amount ?? null,
      billing_period: params.billingPeriod ?? null,
      description: params.description ?? null,
      ...params.metadata,
    },
  })

  return ledgerId
}

export function rentCollectionGraphScopeFromRun(
  run: {
    id: string
    landlord_id?: string | null
    resident_id?: string | null
    unit_id?: string | null
    property_id?: string | null
    metadata?: Record<string, unknown> | null
  },
  landlordId: string,
): RentCollectionGraphScope {
  return {
    landlordId,
    workflowRunId: run.id,
    residentId: run.resident_id ?? null,
    unitId: run.unit_id ?? null,
    propertyId: run.property_id ?? null,
    unitLabel: typeof run.metadata?.unit_label === "string"
      ? run.metadata.unit_label
      : null,
    building: typeof run.metadata?.building === "string"
      ? run.metadata.building
      : null,
  }
}

export function rentCollectionGraphScopeFromResident(
  params: {
    landlordId: string
    workflowRunId: string
    resident: {
      id: string
      unit?: string | null
      building?: string | null
    }
  },
): RentCollectionGraphScope {
  return {
    landlordId: params.landlordId,
    workflowRunId: params.workflowRunId,
    residentId: params.resident.id,
    unitLabel: params.resident.unit ?? null,
    building: params.resident.building ?? null,
  }
}
