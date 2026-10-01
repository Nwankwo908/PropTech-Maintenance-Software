/**
 * Resident SMS: QUIET 10PM-7AM / QUIET OFF — set per-resident quiet hours.
 * Command-style registry handler (like vendor PAUSE/RESUME); no pending ask.
 */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { recordActivityLog } from "../graph/recordActivityLog.ts"
import {
  formatQuietHoursClearedSms,
  formatQuietHoursConfirmSms,
  formatQuietHoursInvalidSms,
  parseQuietHoursSmsCommand,
} from "../residentSendTiming.ts"

export function canHandleResidentQuietHoursCommand(input: {
  identityType: string | null | undefined
  body: string
}): boolean {
  if ((input.identityType ?? "").toLowerCase() !== "resident") return false
  return parseQuietHoursSmsCommand(input.body) != null
}

export async function tryHandleResidentQuietHoursInbound(
  supabase: SupabaseClient,
  params: {
    landlordId: string
    residentId: string | null | undefined
    identityType: string | null | undefined
    body: string
    conversationId?: string | null
  },
): Promise<
  | { handled: false }
  | { handled: true; replyBody: string }
> {
  if (!canHandleResidentQuietHoursCommand(params)) {
    return { handled: false }
  }

  const parsed = parseQuietHoursSmsCommand(params.body)
  if (!parsed) return { handled: false }

  const residentId = params.residentId?.trim() || ""
  if (!residentId) {
    return {
      handled: true,
      replyBody: formatQuietHoursInvalidSms(
        "We couldn't find your resident profile to save quiet hours.",
      ),
    }
  }

  if (parsed.kind === "invalid") {
    return {
      handled: true,
      replyBody: formatQuietHoursInvalidSms(parsed.reason),
    }
  }

  if (parsed.kind === "clear") {
    const { error } = await supabase
      .from("users")
      .update({
        quiet_hours_start: null,
        quiet_hours_end: null,
      })
      .eq("id", residentId)
      .eq("landlord_id", params.landlordId)

    if (error) {
      console.error("[resident-quiet-hours] clear failed", error.message)
      return {
        handled: true,
        replyBody: formatQuietHoursInvalidSms(
          "We couldn't update quiet hours right now. Please try again in a moment.",
        ),
      }
    }

    await recordActivityLog(supabase, {
      landlordId: params.landlordId,
      eventType: "resident.quiet_hours_cleared",
      source: "sms",
      actorType: "resident",
      residentId,
      conversationId: params.conversationId ?? null,
      metadata: {
        message: "Resident reset quiet hours to the default (9 PM–8 AM).",
      },
    }).catch(() => {})

    return { handled: true, replyBody: formatQuietHoursClearedSms() }
  }

  const { error } = await supabase
    .from("users")
    .update({
      quiet_hours_start: parsed.startHour,
      quiet_hours_end: parsed.endHour,
    })
    .eq("id", residentId)
    .eq("landlord_id", params.landlordId)

  if (error) {
    console.error("[resident-quiet-hours] set failed", error.message)
    return {
      handled: true,
      replyBody: formatQuietHoursInvalidSms(
        "We couldn't update quiet hours right now. Please try again in a moment.",
      ),
    }
  }

  await recordActivityLog(supabase, {
    landlordId: params.landlordId,
    eventType: "resident.quiet_hours_set",
    source: "sms",
    actorType: "resident",
    residentId,
    conversationId: params.conversationId ?? null,
    metadata: {
      message: `Resident set quiet hours to ${parsed.startHour}:00–${parsed.endHour}:00 local.`,
      quiet_hours_start: parsed.startHour,
      quiet_hours_end: parsed.endHour,
    },
  }).catch(() => {})

  return {
    handled: true,
    replyBody: formatQuietHoursConfirmSms({
      startHour: parsed.startHour,
      endHour: parsed.endHour,
    }),
  }
}
