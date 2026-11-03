/**
 * A property-team question on a resident thread owns the next reply.
 * Rent, intake, and other handlers must not answer it.
 */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { matchEmergencyNet } from "../../../../shared/maintenance/deterministicRules.ts"
import { recordActivityLog } from "../graph/recordActivityLog.ts"
import { notifyLandlordNeedsAttention } from "../landlordAttentionNotify.ts"
import { landlordMessageAwaitsTenantReply } from "./landlordAwait.ts"

export const AWAITING_STAFF_REPLY_KEY = "awaiting_staff_reply"
export const STAFF_REPLY_TTL_MS = 24 * 60 * 60 * 1000

export type AwaitingStaffReply = {
  messageId: string
  sentAt: string
  ticketId: string | null
}

export function staffMessageEndsWithQuestion(body: string): boolean {
  return landlordMessageAwaitsTenantReply(body)
}

export function inboundIsEmergency(body: string): boolean {
  return matchEmergencyNet(body) != null
}

export function buildAwaitingStaffReply(input: {
  messageId: string
  sentAt?: string
  ticketId?: string | null
}): AwaitingStaffReply {
  return {
    messageId: input.messageId,
    sentAt: input.sentAt ?? new Date().toISOString(),
    ticketId: input.ticketId?.trim() || null,
  }
}

export function readAwaitingStaffReply(
  intakeState: unknown,
): AwaitingStaffReply | null {
  if (!intakeState || typeof intakeState !== "object") return null
  const raw = (intakeState as Record<string, unknown>)[AWAITING_STAFF_REPLY_KEY]
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null
  const row = raw as Record<string, unknown>
  const messageId = typeof row.messageId === "string" ? row.messageId.trim() : ""
  const sentAt = typeof row.sentAt === "string" ? row.sentAt.trim() : ""
  if (!messageId || !sentAt) return null
  const ticketId =
    typeof row.ticketId === "string" && row.ticketId.trim()
      ? row.ticketId.trim()
      : null
  return { messageId, sentAt, ticketId }
}

export function isStaffReplyPendingOpen(
  pending: AwaitingStaffReply | null,
  now = new Date(),
): boolean {
  if (!pending) return false
  const sent = Date.parse(pending.sentAt)
  if (!Number.isFinite(sent)) return false
  const delta = now.getTime() - sent
  return delta >= 0 && delta <= STAFF_REPLY_TTL_MS
}

export function canHandleStaffReply(input: {
  identityType: string
  intakeState: unknown
  now?: Date
}): boolean {
  if (input.identityType !== "resident") return false
  return isStaffReplyPendingOpen(
    readAwaitingStaffReply(input.intakeState),
    input.now,
  )
}

export async function tryHandleStaffReplyInbound(
  supabase: SupabaseClient,
  params: {
    landlordId: string
    conversationId: string
    messageId: string
    body: string
    identityType: string
    residentId?: string | null
    maintenanceRequestId?: string | null
    mediaUrls?: string[]
  },
): Promise<{ handled: true } | { handled: false }> {
  if (params.identityType !== "resident") return { handled: false }
  if (inboundIsEmergency(params.body)) return { handled: false }

  const { data: conv } = await supabase
    .from("sms_conversations")
    .select("intake_state")
    .eq("id", params.conversationId)
    .maybeSingle()
  const prior =
    conv?.intake_state && typeof conv.intake_state === "object"
      ? (conv.intake_state as Record<string, unknown>)
      : {}
  const pending = readAwaitingStaffReply(prior)
  if (!isStaffReplyPendingOpen(pending)) return { handled: false }

  const next = { ...prior }
  delete next[AWAITING_STAFF_REPLY_KEY]
  await supabase
    .from("sms_conversations")
    .update({
      intake_state: next,
      updated_at: new Date().toISOString(),
    })
    .eq("id", params.conversationId)

  const ticketId = pending?.ticketId || params.maintenanceRequestId || null
  const media = (params.mediaUrls ?? []).map((url) => url.trim()).filter(Boolean)
  if (ticketId && media.length > 0) {
    await appendResidentPhotosToTicket(supabase, {
      landlordId: params.landlordId,
      ticketId,
      residentId: params.residentId ?? null,
      conversationId: params.conversationId,
      messageId: params.messageId,
      mediaUrls: media,
    })
  }
  try {
    await notifyLandlordNeedsAttention(supabase, {
      landlordId: params.landlordId,
      kind: "workflow_escalated",
      headline: "Resident replied to your question",
      detail: (media.length > 0
        ? `Photo received. ${params.body.trim()}`
        : params.body.trim()).slice(0, 240),
      idempotencyKey: `staff-reply:${params.conversationId}:${params.messageId}`,
      maintenanceRequestId: ticketId,
      residentId: params.residentId ?? null,
      whyLine: "You asked them for a reply on this thread.",
    })
  } catch (err) {
    console.error(
      "[staff-reply] attention notify failed",
      err instanceof Error ? err.message : err,
    )
  }

  return { handled: true }
}

async function appendResidentPhotosToTicket(
  supabase: SupabaseClient,
  params: {
    landlordId: string
    ticketId: string
    residentId: string | null
    conversationId: string
    messageId: string
    mediaUrls: string[]
  },
): Promise<void> {
  try {
    const { data: current } = await supabase
      .from("maintenance_requests")
      .select("photo_paths")
      .eq("id", params.ticketId)
      .maybeSingle()
    const existing = Array.isArray(current?.photo_paths)
      ? current.photo_paths.filter((item): item is string =>
        typeof item === "string" && item.trim().length > 0
      )
      : []
    const seen = new Set(existing)
    const next = [...existing]
    for (const url of params.mediaUrls) {
      if (seen.has(url)) continue
      seen.add(url)
      next.push(url)
    }
    if (next.length === existing.length) return
    const { error } = await supabase
      .from("maintenance_requests")
      .update({ photo_paths: next.slice(0, 24) })
      .eq("id", params.ticketId)
    if (error) {
      console.error("[staff-reply] photo attach failed", error.message)
      return
    }
    await recordActivityLog(supabase, {
      landlordId: params.landlordId,
      eventType: "maintenance.resident_photo_added",
      source: "sms",
      actorType: "resident",
      residentId: params.residentId,
      maintenanceRequestId: params.ticketId,
      conversationId: params.conversationId,
      messageId: params.messageId,
      metadata: {
        message: "Resident sent a photo for the open repair.",
        photo_count: next.length - existing.length,
      },
    }).catch((err) => {
      console.error(
        "[staff-reply] photo activity log failed",
        err instanceof Error ? err.message : err,
      )
    })
  } catch (err) {
    console.error(
      "[staff-reply] photo attach failed",
      err instanceof Error ? err.message : err,
    )
  }
}
