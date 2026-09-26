/**
 * Structured failure log when outbound SMS cannot resolve a landlord from-number.
 * Prefer this over only skipping the success event — makes Alpha misses one query.
 */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { recordActivityLog } from "../graph/recordActivityLog.ts"

export type OutboundNoLandlordMainParams = {
  landlordId: string
  /** What we were trying to send (e.g. tenant_schedule_ask). */
  messageType: string
  /** Which resolver returned null (e.g. findActiveLandlordMainNumber). */
  resolver: string
  ticketId?: string | null
  vendorId?: string | null
  residentId?: string | null
  conversationId?: string | null
}

/** Best-effort graph event — never throws to callers. */
export async function logOutboundNoLandlordMain(
  supabase: SupabaseClient,
  params: OutboundNoLandlordMainParams,
): Promise<void> {
  const landlordId = params.landlordId.trim()
  if (!landlordId) return
  try {
    await recordActivityLog(supabase, {
      landlordId,
      eventType: "sms.outbound_no_landlord_main",
      source: "sms",
      actorType: "system",
      maintenanceRequestId: params.ticketId ?? null,
      vendorId: params.vendorId ?? null,
      residentId: params.residentId ?? null,
      conversationId: params.conversationId ?? null,
      metadata: {
        message_type: params.messageType,
        resolver: params.resolver,
        message:
          `Could not resolve a usable landlord SMS line for ${params.messageType} (resolver: ${params.resolver}).`,
      },
    })
  } catch (e) {
    console.error("[sms] outbound_no_landlord_main log failed", e)
  }
}
