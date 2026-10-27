/**
 * Confirmed intake answers for a vendor offer. Read from the resident thread
 * linked to the ticket. A missing thread leaves the offer to the stored request.
 */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"

export type ConfirmedVendorOfferFacts = {
  locationQuestion: string | null
  locationAnswer: string | null
  facts: Record<string, string>
  safetyConcern: string | null
}

const EMPTY: ConfirmedVendorOfferFacts = {
  locationQuestion: null,
  locationAnswer: null,
  facts: {},
  safetyConcern: null,
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function stringField(row: Record<string, unknown>, key: string): string | null {
  const value = row[key]
  return typeof value === "string" && value.trim() ? value.trim() : null
}

export async function loadConfirmedVendorOfferFacts(
  supabase: SupabaseClient,
  ticketId: string,
): Promise<ConfirmedVendorOfferFacts> {
  const id = ticketId.trim()
  if (!id) return EMPTY
  const { data, error } = await supabase
    .from("sms_conversations")
    .select("intake_state, conversation_type")
    .eq("maintenance_request_id", id)
    .limit(8)
  if (error || !Array.isArray(data)) {
    if (error) console.warn("[vendor-offer] conversation lookup failed", error.message)
    return EMPTY
  }

  let fallback: ConfirmedVendorOfferFacts | null = null
  for (const row of data) {
    const type = typeof row.conversation_type === "string" ? row.conversation_type : ""
    if (type === "vendor" || type === "vendor_tenant_proxy") continue
    const intake = asRecord(row.intake_state)
    if (!intake) continue
    const factsRaw = asRecord(intake.diagnostic_facts)
    const facts: Record<string, string> = {}
    if (factsRaw) {
      for (const [key, value] of Object.entries(factsRaw)) {
        if (typeof value === "string" && value.trim()) facts[key] = value.trim()
      }
    }
    const parsed: ConfirmedVendorOfferFacts = {
      locationQuestion: stringField(intake, "location_question"),
      locationAnswer: stringField(intake, "room_or_area"),
      facts,
      safetyConcern: stringField(intake, "safety_concerns"),
    }
    const hasDetail = Boolean(
      parsed.locationQuestion ||
        parsed.locationAnswer ||
        parsed.safetyConcern ||
        Object.keys(facts).length,
    )
    if (!hasDetail) continue
    if (parsed.locationQuestion) return parsed
    fallback = fallback ?? parsed
  }
  return fallback ?? EMPTY
}
