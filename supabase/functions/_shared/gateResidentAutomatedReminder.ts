/**
 * Gate resident-facing automated SMS (reminders) through quiet hours + property TZ.
 * Call immediately before send; on hold_quiet_hours do not mark the reminder as sent.
 */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import {
  loadResidentSendTiming,
  type ResolvedResidentSendTiming,
} from "./residentSendTiming.ts"
import {
  shouldSendAutomatedMessage,
  type AutomatedMessageType,
  type ShouldSendDecision,
} from "./shouldSendAutomatedMessage.ts"

export type GateResidentReminderResult = {
  decision: ShouldSendDecision
  timing: ResolvedResidentSendTiming & { propertyId: string | null }
}

export async function gateResidentAutomatedReminder(
  supabase: SupabaseClient,
  params: {
    landlordId: string
    residentId: string
    building?: string | null
    propertyId?: string | null
    messageType: AutomatedMessageType
    recipientPhone?: string | null
    ticketId?: string | null
    nowMs?: number
  },
): Promise<GateResidentReminderResult> {
  const timing = await loadResidentSendTiming(supabase, {
    landlordId: params.landlordId,
    residentId: params.residentId,
    building: params.building,
    propertyId: params.propertyId,
    nowMs: params.nowMs,
  })

  const decision = await shouldSendAutomatedMessage(supabase, {
    landlordId: params.landlordId,
    ticketId: params.ticketId ?? null,
    messageType: params.messageType,
    audience: "resident",
    recipientPhone: params.recipientPhone ?? null,
    timeZone: timing.timeZone,
    quietHours: timing.quietHours,
    nowMs: params.nowMs,
    // Reminders: skip ticket cooldown unless a ticketId is provided.
    recentAutomatedToRecipient: params.ticketId ? undefined : 0,
  })

  return { decision, timing }
}
