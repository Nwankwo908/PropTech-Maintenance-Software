/**
 * When a maintenance ticket is permanently deleted, detach it from SMS threads
 * so intake / vendor schedule / estimate-decision FSMs stop acting on it.
 *
 * Message history is preserved; only linkage + wait-state JSON is cleared.
 */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"

type ConvoRow = {
  id: string
  maintenance_request_id: string | null
  intake_state: unknown
}

function asObject(raw: unknown): Record<string, unknown> {
  return raw && typeof raw === "object"
    ? { ...(raw as Record<string, unknown>) }
    : {}
}

function scheduleTicketId(intake: Record<string, unknown>): string {
  const schedule = intake.vendor_schedule
  if (!schedule || typeof schedule !== "object") return ""
  const id = (schedule as { ticketId?: unknown }).ticketId
  return typeof id === "string" ? id.trim() : ""
}

function estimateTicketId(intake: Record<string, unknown>): string {
  const wait = intake.awaiting_estimate_decision
  if (!wait || typeof wait !== "object") return ""
  const id = (wait as { ticket_id?: unknown }).ticket_id
  return typeof id === "string" ? id.trim() : ""
}

function draftTicketId(intake: Record<string, unknown>): string {
  return typeof intake.draft_ticket_id === "string"
    ? intake.draft_ticket_id.trim()
    : ""
}

function conversationTouchesTicket(row: ConvoRow, ticketId: string): boolean {
  if (row.maintenance_request_id === ticketId) return true
  const intake = asObject(row.intake_state)
  return (
    scheduleTicketId(intake) === ticketId ||
    estimateTicketId(intake) === ticketId ||
    draftTicketId(intake) === ticketId
  )
}

async function loadCandidateConversations(
  supabase: SupabaseClient,
  ticketId: string,
  landlordId: string | null,
): Promise<ConvoRow[]> {
  const byId = new Map<string, ConvoRow>()

  let linked = supabase
    .from("sms_conversations")
    .select("id, maintenance_request_id, intake_state")
    .eq("maintenance_request_id", ticketId)
  if (landlordId) linked = linked.eq("landlord_id", landlordId)
  const { data: linkedRows, error: linkedErr } = await linked
  if (linkedErr) {
    console.error("[sms-detach] load linked", linkedErr.message)
  } else {
    for (const row of linkedRows ?? []) {
      if (row?.id) byId.set(row.id as string, row as ConvoRow)
    }
  }

  // jsonb contains for schedule / estimate wait keyed to this ticket
  const containsQueries: Record<string, unknown>[] = [
    { vendor_schedule: { ticketId } },
    { awaiting_estimate_decision: { ticket_id: ticketId } },
    { draft_ticket_id: ticketId },
  ]

  for (const contains of containsQueries) {
    let q = supabase
      .from("sms_conversations")
      .select("id, maintenance_request_id, intake_state")
      .contains("intake_state", contains)
      .limit(100)
    if (landlordId) q = q.eq("landlord_id", landlordId)
    const { data, error } = await q
    if (error) {
      console.warn("[sms-detach] contains scan", error.message, contains)
      continue
    }
    for (const row of data ?? []) {
      if (row?.id) byId.set(row.id as string, row as ConvoRow)
    }
  }

  return [...byId.values()].filter((row) =>
    conversationTouchesTicket(row, ticketId)
  )
}

export async function detachDeletedTicketFromSmsConversations(
  supabase: SupabaseClient,
  params: { ticketId: string; landlordId?: string | null },
): Promise<{ conversationsUpdated: number }> {
  const ticketId = params.ticketId.trim()
  if (!ticketId) return { conversationsUpdated: 0 }
  const landlordId = params.landlordId?.trim() || null

  const candidates = await loadCandidateConversations(
    supabase,
    ticketId,
    landlordId,
  )

  let conversationsUpdated = 0
  for (const row of candidates) {
    const intake = asObject(row.intake_state)
    let intakeChanged = false

    if (scheduleTicketId(intake) === ticketId) {
      delete intake.vendor_schedule
      intakeChanged = true
    }
    if (estimateTicketId(intake) === ticketId) {
      delete intake.awaiting_estimate_decision
      intakeChanged = true
    }
    if (draftTicketId(intake) === ticketId) {
      delete intake.draft_ticket_id
      intakeChanged = true
    }

    const clearLink = row.maintenance_request_id === ticketId
    if (!clearLink && !intakeChanged) continue

    const patch: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    }
    if (clearLink) patch.maintenance_request_id = null
    if (intakeChanged) patch.intake_state = intake

    const { error } = await supabase
      .from("sms_conversations")
      .update(patch)
      .eq("id", row.id)
    if (error) {
      console.error("[sms-detach] update conversation", row.id, error.message)
      continue
    }
    conversationsUpdated += 1
  }

  console.info("[sms-detach] detached deleted ticket from SMS threads", {
    ticketId,
    conversationsUpdated,
    candidates: candidates.length,
  })

  return { conversationsUpdated }
}
