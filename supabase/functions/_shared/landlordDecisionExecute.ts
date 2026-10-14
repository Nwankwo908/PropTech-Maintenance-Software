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
import {
  AWAITING_LANDLORD_VENDOR_CHOICE,
  confirmDurableLandlordChoiceTrigger,
} from "./vendorLandlordChoice.ts"

export type PickSnapshot = {
  vendor_id?: string | null
  vendor_name?: string | null
  window?: string | null
  cost_low?: number | null
  cost_high?: number | null
  ticket_class?: "reactive" | "proactive" | null
  issue?: string | null
  unit_label?: string | null
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
    "Schema: [{\"display_id\":number,\"action\":\"yes\"|\"options\"|\"self\"|\"snooze\"|\"skip\",\"params\":{\"snooze_until\":\"YYYY-MM-DD\"},\"confidence\":0-1}]",
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
        model: "gpt-4o-mini",
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
  const { data } = await supabase
    .from("vendors")
    .select("id, active, availability")
    .eq("id", id)
    .maybeSingle()
  if (!data?.id) return false
  if (data.active === false) return false
  if (typeof data.availability === "string" && data.availability.trim().toLowerCase() === "paused") {
    return false
  }
  return true
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
      .select("id, vendor_notify_error, snoozed_until")
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
        const text = `#${mutation.displayId} already decided.`
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

  return {
    handled: true,
    replyBody: buildDecisionConfirmation(lines, plan.question),
  }
}

async function applyMutation(
  supabase: SupabaseClient,
  params: {
    landlordId: string
    conversationId: string
    messageId: string
    mutation: {
      kind: "book" | "snooze" | "self" | "skip" | "options"
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
  return true
}
