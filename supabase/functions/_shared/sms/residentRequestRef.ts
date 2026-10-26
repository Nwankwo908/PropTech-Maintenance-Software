import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import {
  pickUniqueResidentRequestRef,
  residentRequestRef,
  ticketIdHex,
} from "../../../../shared/maintenance/residentRequestRef.ts"

export { residentRequestRef } from "../../../../shared/maintenance/residentRequestRef.ts"

/**
 * Read the stored tenant ref, or assign one when this ticket does not have one yet.
 * A missing column falls back to the 8-character prefix so ticket creation still succeeds.
 */
export async function ensureResidentRequestRef(
  supabase: SupabaseClient,
  ticketId: string,
): Promise<string> {
  const fallback = residentRequestRef(ticketId)
  const { data, error } = await supabase
    .from("maintenance_requests")
    .select("resident_request_ref")
    .eq("id", ticketId)
    .maybeSingle()
  if (error) return fallback
  const stored = typeof data?.resident_request_ref === "string"
    ? data.resident_request_ref.trim()
    : ""
  if (stored) return residentRequestRef(ticketId, stored)

  const prefix = ticketIdHex(ticketId).slice(0, 8)
  const { data: rows, error: listError } = await supabase
    .from("maintenance_requests")
    .select("id, resident_request_ref")
    .ilike("resident_request_ref", `${prefix}%`)
  const taken = listError
    ? []
    : (rows ?? [])
      .filter((row) => row.id !== ticketId)
      .map((row) => (typeof row.resident_request_ref === "string" ? row.resident_request_ref : ""))
  const ref = pickUniqueResidentRequestRef(ticketId, taken)
  const { error: updateError } = await supabase
    .from("maintenance_requests")
    .update({ resident_request_ref: ref })
    .eq("id", ticketId)
    .is("resident_request_ref", null)
  if (updateError) return ref
  const { data: saved } = await supabase
    .from("maintenance_requests")
    .select("resident_request_ref")
    .eq("id", ticketId)
    .maybeSingle()
  const finalRef = typeof saved?.resident_request_ref === "string"
    ? saved.resident_request_ref.trim()
    : ""
  return finalRef ? residentRequestRef(ticketId, finalRef) : ref
}
