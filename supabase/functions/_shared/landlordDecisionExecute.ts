/**
 * Applies a parsed landlord decision reply. The LLM and parser only propose
 * intents; every ticket change is a conditional update here.
 */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import {
  buildDecisionConfirmation,
  executeDecisionPlan,
  type BatchCandidate,
} from "../../../shared/landlordDecisions/executeDecisions.ts"
import { filterLlmDecisionProposals } from "../../../shared/landlordDecisions/filterLlmDecisionProposals.ts"
import {
  parseDecisionReply,
  type DecisionCandidate,
  type DecisionIntent,
} from "../../../shared/landlordDecisions/parseDecisionReply.ts"
import { landlordPickReplyMayExecute } from "../../../shared/landlordDecisions/batchAccess.ts"
import { yesAllNeedsConfirm } from "../../../shared/landlordDecisions/batchMessage.ts"
import { upsertSmsIdentityForPhone } from "./sms/inbound_db.ts"
import { recordActivityLog } from "./graph/recordActivityLog.ts"
import { closeOpenAsksForTicket } from "./closeOpenAsksForTicket.ts"
import { sendOutboundSms } from "./sms/adapters.ts"
import { landlordFixedTenantSms } from "../../../shared/maintenance/selfFixTips.ts"
import {
  AWAITING_LANDLORD_VENDOR_CHOICE,
  confirmDurableLandlordChoiceTrigger,
} from "./vendorLandlordChoice.ts"
import { offerVendorStillAvailable } from "./vendor_assignment.ts"
import { residentRequestRef } from "../../../shared/maintenance/residentRequestRef.ts"
import {
  repeatedApprovalAcknowledgement,
  vendorNotificationVerified,
} from "../../../shared/sms/repeatedApprovalAck.ts"

export type PickSnapshot = {
  vendor_id?: string | null
  vendor_name?: string | null
  window?: string | null
  cost_low?: number | null
  cost_high?: number | null
  ticket_class?: "reactive" | "proactive" | null
  issue?: string | null
  unit_label?: string | null
  property_address?: string | null
}

type BatchItemRow = {
  ticket_id: string
  display_id: number
  snapshot: PickSnapshot
}

const AWAITING = AWAITING_LANDLORD_VENDOR_CHOICE

async function proposeUnclearDecisions(input: {
  unclear: string[]
  candidates: DecisionCandidate[]
}): Promise<DecisionIntent[]> {
  if (input.unclear.length === 0) return []
  const key = Deno.env.get("OPENAI_API_KEY")?.trim()
  if (!key) return []
  const prompt = [
    "Turn the unclear landlord text into JSON only.",
    "Schema: [{\"display_id\":number,\"action\":\"yes\"|\"no\"|\"options\"|\"self\"|\"snooze\"|\"skip\",\"params\":{\"snooze_until\":\"YYYY-MM-DD\"},\"confidence\":0-1}]",
    "Candidates:",
    ...input.candidates.map((row) => `#${row.displayId} ${row.ticketClass}`),
    "Unclear text:",
    input.unclear.join("\n"),
  ].join("\n")
  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o",
        temperature: 0,
        messages: [
          { role: "system", content: "Reply with a JSON array and nothing else." },
          { role: "user", content: prompt },
        ],
      }),
    })
    if (!response.ok) return []
    const payload = await response.json()
    const text = payload?.choices?.[0]?.message?.content
    if (typeof text !== "string") return []
    const parsed = JSON.parse(text.replace(/^```json\s*|\s*```$/g, ""))
    if (!Array.isArray(parsed)) return []
    return filterLlmDecisionProposals(parsed, input.candidates)
  } catch (error) {
    console.error("[landlord-pick] llm proposal failed", error)
    return []
  }
}

async function vendorStillAvailable(
  supabase: SupabaseClient,
  vendorId: string | null | undefined,
): Promise<boolean> {
  const id = vendorId?.trim()
  if (!id) return false
  const { data, error } = await supabase
    .from("vendors")
    .select("id, active, roster_status, onboarding_overridden_at")
    .eq("id", id)
    .maybeSingle()
  if (error || !data?.id) return false
  const { data: verification, error: verificationError } = await supabase
    .from("vendor_verifications")
    .select("status, availability")
    .eq("vendor_id", id)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle()
  if (verificationError) return false
  return offerVendorStillAvailable({
    vendor: {
      id: typeof data.id === "string" ? data.id : id,
      active: typeof data.active === "boolean" ? data.active : null,
      roster_status: typeof data.roster_status === "string" ? data.roster_status : null,
      onboarding_overridden_at: typeof data.onboarding_overridden_at === "string"
        ? data.onboarding_overridden_at
        : null,
    },
    verification: verification
      ? {
        status: typeof verification.status === "string" ? verification.status : null,
        availability: typeof verification.availability === "string"
          ? verification.availability
          : null,
      }
      : null,
  })
}

export async function tryHandleLandlordPickBatchInbound(
  supabase: SupabaseClient,
  params: {
    landlordId: string
    conversationId: string
    body: string
    identityType: string
    fromPhone?: string | null
    messageId?: string | null
    providerMessageSid?: string | null
  },
): Promise<{ handled: false } | { handled: true; replyBody: string | null }> {
  const phone = (params.fromPhone ?? "").replace(/\D/g, "")
  if (!phone) return { handled: false }

  const { data: batches } = await supabase
    .from("landlord_pick_batches")
    .select("id, created_at, yes_all_confirm_requested_at, superseded_at, recipient_phone")
    .eq("landlord_id", params.landlordId)
    .eq("status", "open")
    .not("outbound_message_id", "is", null)
    .order("created_at", { ascending: false })
    .limit(8)

  const batch = (batches ?? []).find((row) =>
    landlordPickReplyMayExecute({
      identityType: params.identityType,
      fromPhone: params.fromPhone,
      recipientPhone: String(row.recipient_phone ?? ""),
    })
  )
  if (!batch?.id) return { handled: false }

  if (params.identityType === "resident") {
    try {
      await upsertSmsIdentityForPhone(supabase, {
        landlordId: params.landlordId,
        phone,
        identityType: "landlord",
      })
    } catch (error) {
      console.error("[landlord-pick] repair landlord identity", error)
    }
  }

  const sid = params.providerMessageSid?.trim() || params.messageId?.trim() || ""
  if (sid) {
    const { error } = await supabase.from("landlord_decision_inbound_log").insert({
      provider_message_sid: sid,
      landlord_id: params.landlordId,
    })
    if (error && /duplicate|unique/i.test(error.message)) {
      return { handled: true, replyBody: null }
    }
  }

  const trigger = await confirmDurableLandlordChoiceTrigger(supabase, {
    messageId: params.messageId,
    conversationId: params.conversationId,
    landlordId: params.landlordId,
  })
  if (!trigger.ok) {
    return {
      handled: true,
      replyBody: "I couldn't confirm your reply just now. Please send it again.",
    }
  }

  const { data: items } = await supabase
    .from("landlord_pick_batch_items")
    .select("ticket_id, display_id, snapshot, position")
    .eq("batch_id", batch.id)
    .order("position", { ascending: true })

  const rows = (items ?? []) as BatchItemRow[]
  const ticketIds = rows.map((row) => row.ticket_id)
  const { data: tickets } = ticketIds.length
    ? await supabase
      .from("maintenance_requests")
      .select(
        "id, vendor_notify_error, snoozed_until, vendor_notified_at, resident_request_ref",
      )
      .in("id", ticketIds)
    : { data: [] }

  const ticketById = new Map((tickets ?? []).map((row) => [String(row.id), row]))
  const now = new Date()
  const candidates: BatchCandidate[] = []
  const parseCandidates: DecisionCandidate[] = []
  for (const row of rows) {
    const ticket = ticketById.get(row.ticket_id)
    const snoozedUntil = ticket?.snoozed_until ? new Date(String(ticket.snoozed_until)) : null
    const snoozed = snoozedUntil != null && snoozedUntil.getTime() > now.getTime()
    const awaiting = String(ticket?.vendor_notify_error ?? "").includes(AWAITING) && !snoozed
    const ticketClass = row.snapshot?.ticket_class === "proactive" ? "proactive" : "reactive"
    parseCandidates.push({ displayId: row.display_id, ticketClass })
    const available = awaiting
      ? await vendorStillAvailable(supabase, row.snapshot?.vendor_id)
      : false
    candidates.push({
      ticketId: row.ticket_id,
      displayId: row.display_id,
      ticketClass,
      awaitingPick: awaiting,
      vendorName: row.snapshot?.vendor_name?.trim() || "the vendor",
      windowLabel: row.snapshot?.window?.trim() || "",
      issue: row.snapshot?.issue?.trim() || "",
      unitLabel: row.snapshot?.unit_label?.trim() || "",
      propertyAddress: row.snapshot?.property_address?.trim() || "",
      vendorAvailable: available,
      windowAvailable: available && Boolean(row.snapshot?.window?.trim() || available),
    })
  }

  const { data: landlord } = await supabase
    .from("landlords")
    .select("time_zone")
    .eq("id", params.landlordId)
    .maybeSingle()
  const landlordTz =
    typeof landlord?.time_zone === "string" && landlord.time_zone.trim()
      ? landlord.time_zone.trim()
      : "America/Los_Angeles"

  const parsed = parseDecisionReply(params.body, parseCandidates, now, landlordTz)
  const llmIntents = await proposeUnclearDecisions({
    unclear: parsed.unclear,
    candidates: parseCandidates,
  })

  const { data: superseded } = await supabase
    .from("landlord_pick_batches")
    .select("superseded_at")
    .eq("landlord_id", params.landlordId)
    .eq("recipient_phone", batch.recipient_phone)
    .eq("status", "superseded")
    .order("superseded_at", { ascending: false })
    .limit(1)
    .maybeSingle()

  const hold = yesAllNeedsConfirm({
    yesAll: parsed.yesAll,
    latestBatchCreatedAt: new Date(String(batch.created_at)),
    previousSupersededAt: superseded?.superseded_at
      ? new Date(String(superseded.superseded_at))
      : null,
    confirmAlreadyRequested: Boolean(batch.yes_all_confirm_requested_at),
    now,
  })

  if (hold) {
    await supabase
      .from("landlord_pick_batches")
      .update({ yes_all_confirm_requested_at: now.toISOString() })
      .eq("id", batch.id)
  }

  const plan = executeDecisionPlan({
    candidates,
    parsed,
    llmIntents,
    yesAllNeedsConfirm: hold,
  })

  const lines = [...plan.lines]
  if (plan.executed) {
    for (const mutation of plan.mutations) {
      const applied = await applyMutation(supabase, {
        landlordId: params.landlordId,
        conversationId: params.conversationId,
        messageId: params.messageId ?? trigger.messageId,
        mutation,
        snapshot: rows.find((row) => row.ticket_id === mutation.ticketId)?.snapshot,
        now,
      })
      if (!applied) {
        const index = lines.findIndex((line) => line.displayId === mutation.displayId)
        const showId = candidates.length > 1
        const text = showId
          ? `#${mutation.displayId} already decided.`
          : "Already decided."
        if (index >= 0) lines[index] = { displayId: mutation.displayId, text, kind: "unclear" }
        else lines.push({ displayId: mutation.displayId, text, kind: "unclear" })
      }
    }
    const stillOpen = candidates.some((row) =>
      row.awaitingPick &&
      !plan.mutations.some((mutation) =>
        mutation.ticketId === row.ticketId && mutation.kind !== "options"
      )
    )
    if (!stillOpen) {
      await supabase.from("landlord_pick_batches").update({ status: "closed" }).eq("id", batch.id)
    }
  }

  const yesDisplayIds = new Set<number>()
  if (parsed.yesAll) {
    for (const candidate of candidates) yesDisplayIds.add(candidate.displayId)
  }
  for (const intent of [...parsed.intents, ...llmIntents]) {
    if (intent.action === "yes") yesDisplayIds.add(intent.displayId)
  }
  const acknowledgementLines = lines.map((line) => {
    if (
      line.displayId == null ||
      !yesDisplayIds.has(line.displayId) ||
      !/already decided/i.test(line.text)
    ) {
      return line
    }
    const candidate = candidates.find((row) => row.displayId === line.displayId)
    const ticket = candidate ? ticketById.get(candidate.ticketId) : undefined
    return {
      ...line,
      text: repeatedApprovalAcknowledgement({
        ref: residentRequestRef(
          candidate?.ticketId ?? "",
          typeof ticket?.resident_request_ref === "string"
            ? ticket.resident_request_ref
            : null,
        ),
        vendorNotified: vendorNotificationVerified({
          vendorNotifiedAt: typeof ticket?.vendor_notified_at === "string"
            ? ticket.vendor_notified_at
            : null,
          vendorNotifyError: typeof ticket?.vendor_notify_error === "string"
            ? ticket.vendor_notify_error
            : null,
        }),
      }),
    }
  })

  return {
    handled: true,
    replyBody: buildDecisionConfirmation(acknowledgementLines, plan.question),
  }
}

/** Tell the approved vendor and lock the window they already offered. */
async function notifyBookedVendor(
  supabase: SupabaseClient,
  params: { landlordId: string; ticketId: string; vendorId: string },
): Promise<void> {
  const { data: row } = await supabase
    .from("maintenance_requests")
    .select(
      "priority, unit, description, issue_headline, entry_ok_if_absent, urgency, severity, due_at, estimated_minutes, resident_availability_text, scheduled_at, scheduled_window_text",
    )
    .eq("id", params.ticketId)
    .eq("landlord_id", params.landlordId)
    .maybeSingle()
  if (!row) return

  const { assignVendorAndNotify } = await import(
    "../submit-maintenance-request/vendor_notify.ts"
  )
  await assignVendorAndNotify(supabase, {
    ticketId: params.ticketId,
    priority: typeof row.priority === "string" && row.priority.trim() ? row.priority : "normal",
    unit: typeof row.unit === "string" ? row.unit : "",
    description: typeof row.description === "string" ? row.description : "",
    issueHeadline: typeof row.issue_headline === "string" ? row.issue_headline : null,
    entryOkIfAbsent: typeof row.entry_ok_if_absent === "boolean" ? row.entry_ok_if_absent : null,
    urgency: typeof row.urgency === "string" ? row.urgency : null,
    severity: typeof row.severity === "string" ? row.severity : null,
    dueAt: typeof row.due_at === "string" ? row.due_at : null,
    estimatedMinutes: typeof row.estimated_minutes === "number" ? row.estimated_minutes : null,
    landlordId: params.landlordId,
    preferVendorId: params.vendorId,
    landlordAcknowledged: true,
    residentAvailabilityText: typeof row.resident_availability_text === "string"
      ? row.resident_availability_text
      : null,
    retryIfUnassigned: true,
  })

  const patch: Record<string, unknown> = {}
  try {
    const { findProbeOfferForVendor } = await import("./vendorAvailabilityProbe.ts")
    const offer = await findProbeOfferForVendor(supabase, params.ticketId, params.vendorId)
    if (offer?.scheduledAt) patch.scheduled_at = offer.scheduledAt
    if (offer?.windowLabel?.trim()) patch.scheduled_window_text = offer.windowLabel.trim()
  } catch (error) {
    console.warn("[landlord-decision] probe window", error)
  }
  const hasWindow = Boolean(
    patch.scheduled_at ||
      patch.scheduled_window_text ||
      row.scheduled_at ||
      (typeof row.scheduled_window_text === "string" && row.scheduled_window_text.trim()),
  )
  if (hasWindow) patch.schedule_confirmed_at = new Date().toISOString()
  if (Object.keys(patch).length > 0) {
    await supabase.from("maintenance_requests").update(patch).eq("id", params.ticketId)
  }
}

async function applyMutation(
  supabase: SupabaseClient,
  params: {
    landlordId: string
    conversationId: string
    messageId: string
    mutation: {
      kind: "book" | "snooze" | "self" | "fixed" | "skip" | "options"
      ticketId: string
      displayId: number
      until?: string
    }
    snapshot?: PickSnapshot
    now: Date
  },
): Promise<boolean> {
  let updated: { id: string }[] | null = null
  if (params.mutation.kind === "options") {
    updated = [{ id: params.mutation.ticketId }]
  } else if (params.mutation.kind === "book") {
    const vendorId = params.snapshot?.vendor_id?.trim()
    if (!vendorId) return false
    const { data } = await supabase
      .from("maintenance_requests")
      .update({
        assigned_vendor_id: vendorId,
        vendor_work_status: "pending_accept",
        vendor_notify_error: null,
        awaiting_landlord_choice_at: null,
        landlord_vendor_choice_resolved_at: params.now.toISOString(),
      })
      .eq("id", params.mutation.ticketId)
      .eq("landlord_id", params.landlordId)
      .eq("vendor_notify_error", AWAITING)
      .select("id")
    updated = data
    if (updated?.length) {
      try {
        await notifyBookedVendor(supabase, {
          landlordId: params.landlordId,
          ticketId: params.mutation.ticketId,
          vendorId,
        })
      } catch (error) {
        console.error("[landlord-decision] notify booked vendor", error)
      }
    }
  } else if (params.mutation.kind === "snooze") {
    const { data } = await supabase
      .from("maintenance_requests")
      .update({
        snoozed_until: `${params.mutation.until}T12:00:00Z`,
        vendor_notify_error: null,
        awaiting_landlord_choice_at: null,
      })
      .eq("id", params.mutation.ticketId)
      .eq("landlord_id", params.landlordId)
      .eq("vendor_notify_error", AWAITING)
      .select("id")
    updated = data
  } else if (params.mutation.kind === "fixed") {
    const { data } = await supabase
      .from("maintenance_requests")
      .update({
        vendor_work_status: "completed",
        resolution: "landlord_self_fix",
        self_fix_result: "fixed",
        completed_at: params.now.toISOString(),
        assigned_vendor_id: null,
        landlord_handled_at: params.now.toISOString(),
        vendor_notify_error: null,
        awaiting_landlord_choice_at: null,
        landlord_vendor_choice_resolved_at: params.now.toISOString(),
      })
      .eq("id", params.mutation.ticketId)
      .eq("landlord_id", params.landlordId)
      .eq("vendor_notify_error", AWAITING)
      .select("id")
    updated = data
  } else if (params.mutation.kind === "self") {
    const { data } = await supabase
      .from("maintenance_requests")
      .update({
        landlord_handled_at: params.now.toISOString(),
        vendor_notify_error: null,
        awaiting_landlord_choice_at: null,
        landlord_vendor_choice_resolved_at: params.now.toISOString(),
      })
      .eq("id", params.mutation.ticketId)
      .eq("landlord_id", params.landlordId)
      .eq("vendor_notify_error", AWAITING)
      .select("id")
    updated = data
  } else if (params.mutation.kind === "skip") {
    const { data } = await supabase
      .from("maintenance_requests")
      .update({
        skipped_at: params.now.toISOString(),
        vendor_notify_error: null,
        awaiting_landlord_choice_at: null,
        landlord_vendor_choice_resolved_at: params.now.toISOString(),
      })
      .eq("id", params.mutation.ticketId)
      .eq("landlord_id", params.landlordId)
      .eq("vendor_notify_error", AWAITING)
      .select("id")
    updated = data
  }

  if (!updated?.length) return false
  const messages: Record<string, string> = {
    book: `Booked #${params.mutation.displayId} with the vendor on the list.`,
    snooze: `Snoozed #${params.mutation.displayId}.`,
    self: `Marked #${params.mutation.displayId} for the landlord to handle.`,
    fixed: "Closed as fixed. No vendor booked.",
    skip: `Skipped proactive request #${params.mutation.displayId}.`,
    options: `Landlord asked for other options on #${params.mutation.displayId}.`,
  }
  await recordActivityLog(supabase, {
    landlordId: params.landlordId,
    eventType: `maintenance.landlord_decision_${params.mutation.kind}`,
    source: "sms",
    actorType: "landlord",
    maintenanceRequestId: params.mutation.ticketId,
    conversationId: params.conversationId,
    messageId: params.messageId,
    vendorId: params.mutation.kind === "book" ? params.snapshot?.vendor_id ?? undefined : undefined,
    metadata: { message: messages[params.mutation.kind] ?? "Recorded a landlord decision." },
  })
  if (params.mutation.kind === "fixed") {
    try {
      await closeOpenAsksForTicket(supabase, params.mutation.ticketId, "landlord_self_fix")
    } catch (error) {
      console.error("[landlord-decision] close asks after fixed", error)
    }
    try {
      await textTenantLandlordFixed(supabase, {
        landlordId: params.landlordId,
        ticketId: params.mutation.ticketId,
        issue: params.snapshot?.issue,
      })
    } catch (error) {
      console.error("[landlord-decision] tenant fixed text", error)
    }
  }
  return true
}

async function textTenantLandlordFixed(
  supabase: SupabaseClient,
  params: { landlordId: string; ticketId: string; issue?: string | null },
): Promise<void> {
  const { data: ticket } = await supabase
    .from("maintenance_requests")
    .select("resident_phone, issue_headline, description")
    .eq("id", params.ticketId)
    .eq("landlord_id", params.landlordId)
    .maybeSingle()
  const phone = typeof ticket?.resident_phone === "string" ? ticket.resident_phone.trim() : ""
  if (!phone) return
  const issue = params.issue?.trim() ||
    (typeof ticket?.issue_headline === "string" ? ticket.issue_headline.trim() : "") ||
    "repair"
  await sendOutboundSms(phone, landlordFixedTenantSms(issue), { landlordId: params.landlordId })
}
