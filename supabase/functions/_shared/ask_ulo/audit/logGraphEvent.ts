/**
 * Audit: graph event wrapper for Ask Ulo turns.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { logGraphEvent as logSharedGraphEvent } from "../../graph/logGraphEvent.ts"

export { logGraphEvent } from "../../graph/logGraphEvent.ts"

/** Canonical Ask Ulo answered / refused graph event. */
export async function logAskUloGraphEvent(
  supabase: SupabaseClient,
  input: {
    landlordId: string
    eventType?: "ask_ulo.answered" | "ask_ulo.refused" | "ask_ulo.clarified"
    metadata: Record<string, unknown>
  },
): Promise<void> {
  await logSharedGraphEvent(supabase, {
    landlord_id: input.landlordId,
    event_type: input.eventType ?? "ask_ulo.answered",
    source: "edge_function",
    actor_type: "landlord",
    metadata: input.metadata,
  })
}
