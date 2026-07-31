/**
 * Legacy property_operations_graph helper.
 * Dual-write is now handled by `recordActivityLog`. This remains for
 * call sites that only need the Overview table; new code should use
 * `recordActivityLog` instead.
 */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import {
  recordActivityLog,
  type ActivityLogSource,
} from "./recordActivityLog.ts"
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

/**
 * @deprecated Prefer `recordActivityLog` (it dual-writes this table).
 * When called alone, writes through the official activity log path.
 */
export async function logPropertyOperationsGraph(
  supabase: SupabaseClient,
  params: LogPropertyOperationsGraphInput,
): Promise<string | null> {
  return recordActivityLog(supabase, {
    landlordId: params.landlord_id,
    eventType: params.event_type,
    source: params.event_source as ActivityLogSource,
    actorType: "system",
    propertyId: params.property_id ?? null,
    unitId: params.unit_id ?? null,
    residentId: params.resident_id ?? null,
    vendorId: params.vendor_id ?? null,
    workflowRunId: params.workflow_run_id ?? null,
    metadata: params.event_payload ?? {},
    dualWritePropertyGraph: true,
  })
}
