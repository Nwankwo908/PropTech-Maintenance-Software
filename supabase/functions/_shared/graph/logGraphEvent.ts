import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"

export type GraphEventSource =
  | "sms"
  | "dashboard"
  | "vendor_portal"
  | "edge_function"
  | "automation"

export type GraphEventActorType =
  | "resident"
  | "vendor"
  | "landlord"
  | "system"

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
  metadata?: Record<string, unknown>
}

/** Append an operations graph event (non-throwing on insert failure). */
export async function logGraphEvent(
  supabase: SupabaseClient,
  params: LogGraphEventInput,
): Promise<string | null> {
  const { data, error } = await supabase
    .from("operations_graph_events")
    .insert({
      landlord_id: params.landlord_id,
      event_type: params.event_type,
      source: params.source,
      actor_type: params.actor_type ?? null,
      actor_id: params.actor_id ?? null,
      property_id: params.property_id ?? null,
      unit_id: params.unit_id ?? null,
      resident_id: params.resident_id ?? null,
      vendor_id: params.vendor_id ?? null,
      maintenance_request_id: params.maintenance_request_id ?? null,
      conversation_id: params.conversation_id ?? null,
      message_id: params.message_id ?? null,
      metadata: params.metadata ?? {},
    })
    .select("id")
    .single()

  if (error) {
    console.error(
      "[logGraphEvent]",
      params.event_type,
      params.source,
      error.message,
    )
    return null
  }

  return (data?.id as string | undefined) ?? null
}
