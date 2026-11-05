/**
 * Ask one short summary-clarification question on a repair thread, then apply
 * the answer to that ticket and regenerate the summary.
 *
 * Never used by historical migration. Skips emergencies, staff takeover,
 * opt-outs, and duplicate asks.
 */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import {
  AWAITING_SUMMARY_CLARIFICATION_KEY,
  alreadyAskedSameClarification,
  appendClarificationToDescription,
  buildSummaryClarificationSms,
  buildWhichRepairQuestion,
  canHandleSummaryClarification,
  clarificationFieldFromNeeds,
  parseClarificationAnswer,
  readAwaitingSummaryClarification,
  type SummaryClarificationField,
  type SummaryClarificationPending,
} from "../../../../shared/maintenance/summaryClarification.ts"
import { extractMaintenanceRequestFacts } from "../../../../shared/maintenance/maintenanceRequestFacts.ts"
import { matchEmergencyNet } from "../../../../shared/maintenance/deterministicRules.ts"
import { recordActivityLog } from "../graph/recordActivityLog.ts"
import {
  formatPersistedDescription,
  summarizeMaintenanceRequest,
} from "../maintenanceRequestSummary.ts"
import { isStaffReplyPendingOpen, readAwaitingStaffReply } from "./staffReplyPending.ts"
import { sendOutboundSms } from "./adapters.ts"

export { canHandleSummaryClarification }

type Sb = SupabaseClient

async function loadIntakeState(
  supabase: Sb,
  conversationId: string,
): Promise<Record<string, unknown>> {
  const { data } = await supabase
    .from("sms_conversations")
    .select("intake_state")
    .eq("id", conversationId)
    .maybeSingle()
  const raw = data?.intake_state
  return raw && typeof raw === "object" && !Array.isArray(raw)
    ? { ...(raw as Record<string, unknown>) }
    : {}
}

async function saveIntakeState(
  supabase: Sb,
  conversationId: string,
  next: Record<string, unknown>,
): Promise<void> {
  await supabase
    .from("sms_conversations")
    .update({ intake_state: next, updated_at: new Date().toISOString() })
    .eq("id", conversationId)
}

async function mirrorOutbound(
  supabase: Sb,
  conversationId: string,
  body: string,
): Promise<void> {
  try {
    await supabase.from("sms_messages").insert({
      conversation_id: conversationId,
      direction: "outbound",
      body,
      provider: "ulo",
      provider_status: "sent",
    })
  } catch {
    /* best-effort inbox mirror */
  }
}

function isOptedOutStatus(status: string | null | undefined): boolean {
  const s = (status ?? "").toLowerCase()
  return s === "opted_out" || s === "stopped" || s === "do_not_contact"
}

/**
 * After a new (non-migration) ticket is summarized, ask one clarification if
 * needed. Returns whether an SMS was sent.
 */
export async function maybeAskSummaryClarification(
  supabase: Sb,
  input: {
    ticketId: string
    conversationId: string | null
    landlordId: string
    toPhone: string | null
    description: string
    issueCategory?: string | null
    urgency?: string | null
    residentActivationStatus?: string | null
    /** When true, never send (migration / heal / dry-run). */
    suppressSms?: boolean
  },
): Promise<{ asked: boolean; reason: string }> {
  if (input.suppressSms) return { asked: false, reason: "suppressed" }
  if (!input.conversationId || !input.toPhone?.trim()) {
    return { asked: false, reason: "no_conversation_or_phone" }
  }
  if (isOptedOutStatus(input.residentActivationStatus)) {
    return { asked: false, reason: "opted_out" }
  }
  const urgency = (input.urgency ?? "").toLowerCase()
  if (urgency === "emergency" || urgency === "urgent") {
    return { asked: false, reason: "emergency_skip" }
  }
  if (matchEmergencyNet(input.description ?? "")) {
    return { asked: false, reason: "emergency_skip" }
  }

  const facts = extractMaintenanceRequestFacts(input.description, {
    category: input.issueCategory,
  })
  if (!facts.needsClarification) return { asked: false, reason: "no_clarification_needed" }

  const field = clarificationFieldFromNeeds(facts.needsClarification)
  if (!field || field === "which_repair") {
    // which_repair is only used when the inbound path detects ambiguity.
    if (field !== "which_repair") return { asked: false, reason: "no_field" }
  }

  const intake = await loadIntakeState(supabase, input.conversationId)
  if (isStaffReplyPendingOpen(readAwaitingStaffReply(intake))) {
    return { asked: false, reason: "staff_takeover" }
  }
  if (alreadyAskedSameClarification(intake, input.ticketId, field!)) {
    return { asked: false, reason: "already_asked" }
  }
  // Another clarification already pending on this thread.
  if (readAwaitingSummaryClarification(intake)) {
    return { asked: false, reason: "other_clarification_pending" }
  }

  const askField: SummaryClarificationField = field!
  const question = buildSummaryClarificationSms(facts.needsClarification)
  const pending: SummaryClarificationPending = {
    ticketId: input.ticketId,
    field: askField,
    question,
    askedAt: new Date().toISOString(),
  }

  const send = await sendOutboundSms(input.toPhone, question, {
    landlordId: input.landlordId,
  })
  if (send.error) {
    console.warn("[summaryClarification] send failed", send.error)
    return { asked: false, reason: "send_failed" }
  }

  await saveIntakeState(supabase, input.conversationId, {
    ...intake,
    [AWAITING_SUMMARY_CLARIFICATION_KEY]: pending,
  })
  await mirrorOutbound(supabase, input.conversationId, question)

  try {
    await recordActivityLog(supabase, {
      landlordId: input.landlordId,
      eventType: "maintenance.summary_clarification_asked",
      source: "sms",
      actorType: "system",
      maintenanceRequestId: input.ticketId,
      conversationId: input.conversationId,
      metadata: {
        message: `Asked a clarification: ${question}`,
        field: askField,
      },
    })
  } catch {
    /* best-effort */
  }

  return { asked: true, reason: "sent" }
}

async function regenerateTicketSummary(
  supabase: Sb,
  ticketId: string,
  description: string,
  issueCategory: string | null,
): Promise<void> {
  const polished = await summarizeMaintenanceRequest(description, {
    category: issueCategory,
  })
  const persisted = formatPersistedDescription(polished, description)
  await supabase
    .from("maintenance_requests")
    .update({
      description: persisted,
      issue_headline: polished.title,
      location_detail: polished.location,
      room: polished.location,
      summary: polished.location
        ? `${polished.title} · ${polished.location}`
        : polished.title,
      summarized_at: new Date().toISOString(),
    })
    .eq("id", ticketId)
}

/**
 * Apply inbound answer when awaiting_summary_clarification is set.
 */
export async function tryHandleSummaryClarificationInbound(ctx: {
  supabase: Sb
  conversationId: string
  landlordId: string
  identityType: string
  body: string
  intakeState: unknown
}): Promise<{ handled: boolean; workflowRoute?: string }> {
  if (
    !canHandleSummaryClarification({
      identityType: ctx.identityType,
      intakeState: ctx.intakeState,
    })
  ) {
    return { handled: false }
  }

  // Emergencies must not wait on clarification — fall through.
  if (matchEmergencyNet(ctx.body)) return { handled: false }

  const pending = readAwaitingSummaryClarification(ctx.intakeState)
  if (!pending) return { handled: false }

  const parsed = parseClarificationAnswer(pending.field, ctx.body, pending)
  const intake = await loadIntakeState(ctx.supabase, ctx.conversationId)

  if (!parsed) {
    const retry =
      pending.field === "which_repair" && pending.candidates?.length
        ? buildWhichRepairQuestion(pending.candidates)
        : buildSummaryClarificationSms(pending.question)
    await sendOutboundSms(
      (
        await ctx.supabase
          .from("sms_conversations")
          .select("external_phone_number")
          .eq("id", ctx.conversationId)
          .maybeSingle()
      ).data?.external_phone_number ?? "",
      retry,
      { landlordId: ctx.landlordId },
    )
    return { handled: true, workflowRoute: "summary_clarification_retry" }
  }

  // Clear pending before writes so a second inbound cannot double-apply.
  const { [AWAITING_SUMMARY_CLARIFICATION_KEY]: _drop, ...rest } = intake
  await saveIntakeState(ctx.supabase, ctx.conversationId, rest)

  let ticketId = pending.ticketId
  if (pending.field === "which_repair") {
    ticketId = parsed
    // After choosing the repair, if that ticket still needs a location, ask next.
    const { data: chosen } = await ctx.supabase
      .from("maintenance_requests")
      .select("id, description, issue_category, urgency, resident_phone")
      .eq("id", ticketId)
      .maybeSingle()
    if (chosen) {
      const needs = extractMaintenanceRequestFacts(
        String(chosen.description ?? ""),
        { category: chosen.issue_category as string | null },
      ).needsClarification
      const field = clarificationFieldFromNeeds(needs)
      if (field && field !== "which_repair" && needs) {
        const question = buildSummaryClarificationSms(needs)
        const nextPending: SummaryClarificationPending = {
          ticketId,
          field,
          question,
          askedAt: new Date().toISOString(),
        }
        await saveIntakeState(ctx.supabase, ctx.conversationId, {
          ...rest,
          [AWAITING_SUMMARY_CLARIFICATION_KEY]: nextPending,
        })
        if (chosen.resident_phone) {
          await sendOutboundSms(String(chosen.resident_phone), question, {
            landlordId: ctx.landlordId,
          })
          await mirrorOutbound(ctx.supabase, ctx.conversationId, question)
        }
        return { handled: true, workflowRoute: "summary_clarification_which_then_ask" }
      }
    }
    return { handled: true, workflowRoute: "summary_clarification_which_repair" }
  }

  const { data: ticket } = await ctx.supabase
    .from("maintenance_requests")
    .select(
      "id, description, issue_category, entry_ok_if_absent, photo_paths, access_instructions, vendor_work_status, assigned_vendor_id",
    )
    .eq("id", ticketId)
    .maybeSingle()
  if (!ticket) return { handled: true, workflowRoute: "summary_clarification_missing_ticket" }

  const nextDescription = appendClarificationToDescription(
    String(ticket.description ?? ""),
    pending.field,
    parsed,
  )
  // Preserve status / assignment / photos / access — only rewrite description fields.
  await regenerateTicketSummary(
    ctx.supabase,
    ticketId,
    nextDescription,
    typeof ticket.issue_category === "string" ? ticket.issue_category : null,
  )

  try {
    await recordActivityLog(ctx.supabase, {
      landlordId: ctx.landlordId,
      eventType: "maintenance.summary_clarification_answered",
      source: "sms",
      actorType: "resident",
      maintenanceRequestId: ticketId,
      conversationId: ctx.conversationId,
      metadata: {
        message: `Resident clarified ${pending.field.replace(/_/g, " ")}: ${parsed}.`,
        field: pending.field,
        value: parsed,
      },
    })
  } catch {
    /* best-effort */
  }

  const ack = "Thanks — we updated that repair with your answer."
  const phoneRow = await ctx.supabase
    .from("sms_conversations")
    .select("external_phone_number")
    .eq("id", ctx.conversationId)
    .maybeSingle()
  const to = phoneRow.data?.external_phone_number
  if (to) {
    await sendOutboundSms(String(to), ack, { landlordId: ctx.landlordId })
    await mirrorOutbound(ctx.supabase, ctx.conversationId, ack)
  }

  return { handled: true, workflowRoute: "summary_clarification" }
}

/** When several open repairs share a thread, ask which one first. */
export async function maybeAskWhichRepairClarification(
  supabase: Sb,
  input: {
    conversationId: string
    landlordId: string
    toPhone: string
    candidates: Array<{ ticketId: string; label: string }>
    suppressSms?: boolean
  },
): Promise<{ asked: boolean }> {
  if (input.suppressSms || input.candidates.length < 2) return { asked: false }
  const intake = await loadIntakeState(supabase, input.conversationId)
  if (readAwaitingSummaryClarification(intake)) return { asked: false }
  if (isStaffReplyPendingOpen(readAwaitingStaffReply(intake))) return { asked: false }

  const question = buildWhichRepairQuestion(input.candidates)
  const pending: SummaryClarificationPending = {
    ticketId: input.candidates[0]!.ticketId,
    field: "which_repair",
    question,
    askedAt: new Date().toISOString(),
    candidates: input.candidates,
  }
  const send = await sendOutboundSms(input.toPhone, question, {
    landlordId: input.landlordId,
  })
  if (send.error) return { asked: false }
  await saveIntakeState(supabase, input.conversationId, {
    ...intake,
    [AWAITING_SUMMARY_CLARIFICATION_KEY]: pending,
  })
  await mirrorOutbound(supabase, input.conversationId, question)
  return { asked: true }
}
