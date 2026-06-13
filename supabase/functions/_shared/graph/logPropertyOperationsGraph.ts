import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import type { GraphEventSource } from "./logGraphEvent.ts"

export type LogPropertyOperationsGraphInput = {
  landlord_id: string
  property_id?: string | null
  unit_id?: string | null
  resident_id?: string | null
  vendor_id?: string | null
  workflow_run_id?: string | null
  event_type: string
  event_source: GraphEventSource
  event_payload?: Record<string, unknown>
}

/** Append to canonical property_operations_graph (non-throwing on failure). */
export async function logPropertyOperationsGraph(
  supabase: SupabaseClient,
  params: LogPropertyOperationsGraphInput,
): Promise<string | null> {
  const { data, error } = await supabase
    .from("property_operations_graph")
    .insert({
      landlord_id: params.landlord_id,
      property_id: params.property_id ?? null,
      unit_id: params.unit_id ?? null,
      resident_id: params.resident_id ?? null,
      vendor_id: params.vendor_id ?? null,
      workflow_run_id: params.workflow_run_id ?? null,
      event_type: params.event_type,
      event_source: params.event_source,
      event_payload: params.event_payload ?? {},
    })
    .select("id")
    .single()

  if (error) {
    console.error(
      "[logPropertyOperationsGraph]",
      params.event_type,
      params.event_source,
      error.message,
    )
    return null
  }

  return (data?.id as string | undefined) ?? null
}
