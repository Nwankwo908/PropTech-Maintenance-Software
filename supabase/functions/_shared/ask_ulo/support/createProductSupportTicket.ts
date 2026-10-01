/**
 * Create or bump Ask Ulo product-support tickets; best-effort Resend to systems@.
 * Persist first — notify failure never blocks the ticket row.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { sendResendEmail } from "../../delivery.ts"
import { recordActivityLog } from "../../graph/recordActivityLog.ts"
import {
  buildTranscriptExcerpt,
  generateProductSupportSummary,
  productSupportDedupSignature,
} from "./productSupportSummary.ts"

export const PRODUCT_SUPPORT_NOTIFY_EMAIL = "systems@ulohome.io"

export type SupportTicketNotifyStatus =
  | "pending"
  | "sent"
  | "failed"
  | "skipped"

export type ProductSupportTicketResult = {
  ok: true
  ticketId: string
  created: boolean
  repeatCount: number
  summary: string
  dedupSignature: string
  notifyStatus: SupportTicketNotifyStatus
  confirmationMarkdown: string
}

export type CreateProductSupportTicketInput = {
  landlordId: string
  adminUserId?: string | null
  conversationId?: string | null
  question: string
  history?: Array<{ role: "user" | "assistant"; content: string }>
  attemptedResolution?: string | null
  /** Inject for tests. */
  sendEmail?: typeof sendResendEmail
}

function shouldNotify(created: boolean, repeatCount: number): boolean {
  if (created) return true
  return repeatCount > 0 && repeatCount % 3 === 0
}

function confirmationMarkdown(input: {
  created: boolean
  summary: string
  repeatCount: number
}): string {
  if (input.created) {
    return [
      "## Support ticket created",
      "",
      `I opened a support ticket: **${input.summary}**.`,
      "",
      "Our product team was notified at systems@ulohome.io. Someone will follow up — you can keep chatting here in the meantime.",
    ].join("\n")
  }
  return [
    "## Support ticket updated",
    "",
    `I updated your existing open ticket (**${input.summary}**) — this has come up **${input.repeatCount}** times.`,
    "",
    input.repeatCount % 3 === 0
      ? "I also re-notified the product team so they see the repeat."
      : "The product team already has this ticket; repeating the ask bumps the count so they can prioritize.",
  ].join("\n")
}

async function bumpSignatureSignal(
  supabase: SupabaseClient,
  input: { dedupSignature: string; landlordId: string; isNewLandlordTicket: boolean },
): Promise<void> {
  const now = new Date().toISOString()
  const { data: existing } = await supabase
    .from("support_ticket_signature_signals")
    .select("dedup_signature, distinct_landlord_count, total_sightings")
    .eq("dedup_signature", input.dedupSignature)
    .maybeSingle()

  if (!existing) {
    await supabase.from("support_ticket_signature_signals").insert({
      dedup_signature: input.dedupSignature,
      distinct_landlord_count: 1,
      total_sightings: 1,
      last_seen_at: now,
      updated_at: now,
    })
    return
  }

  const distinct =
    Number(existing.distinct_landlord_count) +
    (input.isNewLandlordTicket ? 1 : 0)
  await supabase
    .from("support_ticket_signature_signals")
    .update({
      distinct_landlord_count: Math.max(1, distinct),
      total_sightings: Number(existing.total_sightings) + 1,
      last_seen_at: now,
      updated_at: now,
    })
    .eq("dedup_signature", input.dedupSignature)
}

async function notifySystems(input: {
  sendEmail: typeof sendResendEmail
  ticketId: string
  landlordId: string
  summary: string
  repeatCount: number
  created: boolean
  transcriptExcerpt: string
  attemptedResolution: string | null
}): Promise<{ status: SupportTicketNotifyStatus; error: string | null }> {
  const subject = input.created
    ? `[Ask Ulo] New support ticket: ${input.summary}`
    : `[Ask Ulo] Repeat (×${input.repeatCount}): ${input.summary}`
  const text = [
    `Ticket: ${input.ticketId}`,
    `Landlord: ${input.landlordId}`,
    `Summary: ${input.summary}`,
    `Repeat count: ${input.repeatCount}`,
    `Created now: ${input.created ? "yes" : "no (bump)"}`,
    "",
    "Attempted resolution:",
    input.attemptedResolution ?? "(none)",
    "",
    "Transcript excerpt:",
    input.transcriptExcerpt,
  ].join("\n")
  const html = `<pre style="font-family:system-ui,sans-serif;white-space:pre-wrap">${text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")}</pre>`

  const result = await input.sendEmail(
    PRODUCT_SUPPORT_NOTIFY_EMAIL,
    subject,
    text,
    html,
  )
  if ("error" in result) {
    return { status: "failed", error: result.error.slice(0, 500) }
  }
  return { status: "sent", error: null }
}

export async function createOrBumpProductSupportTicket(
  supabase: SupabaseClient,
  input: CreateProductSupportTicketInput,
): Promise<ProductSupportTicketResult | { ok: false; error: string }> {
  const landlordId = input.landlordId.trim()
  if (!landlordId) return { ok: false, error: "landlordId is required" }

  const summary = generateProductSupportSummary(input.question)
  const dedupSignature = productSupportDedupSignature(summary)
  const transcriptExcerpt = buildTranscriptExcerpt({
    question: input.question,
    history: input.history,
  })
  const attemptedResolution = (input.attemptedResolution ?? "").trim().slice(0, 2000) ||
    null
  const now = new Date().toISOString()
  const sendEmail = input.sendEmail ?? sendResendEmail

  const { data: openTicket, error: lookupErr } = await supabase
    .from("support_tickets")
    .select(
      "id, repeat_count, summary, status, notify_status",
    )
    .eq("landlord_id", landlordId)
    .eq("dedup_signature", dedupSignature)
    .eq("status", "open")
    .maybeSingle()

  if (lookupErr) {
    console.error("[ask_ulo/support] lookup", lookupErr.message)
    return { ok: false, error: lookupErr.message }
  }

  let ticketId: string
  let created: boolean
  let repeatCount: number

  if (openTicket?.id) {
    created = false
    repeatCount = Number(openTicket.repeat_count) + 1
    ticketId = String(openTicket.id)
    const { error: updErr } = await supabase
      .from("support_tickets")
      .update({
        repeat_count: repeatCount,
        last_seen_at: now,
        updated_at: now,
        transcript_excerpt: transcriptExcerpt,
        attempted_resolution: attemptedResolution,
        summary,
        admin_user_id: input.adminUserId?.trim() || null,
        conversation_id: input.conversationId?.trim() || null,
      })
      .eq("id", ticketId)
    if (updErr) {
      console.error("[ask_ulo/support] bump", updErr.message)
      return { ok: false, error: updErr.message }
    }
  } else {
    created = true
    repeatCount = 1
    const { data: inserted, error: insErr } = await supabase
      .from("support_tickets")
      .insert({
        type: "product_support",
        summary,
        landlord_id: landlordId,
        admin_user_id: input.adminUserId?.trim() || null,
        transcript_excerpt: transcriptExcerpt,
        attempted_resolution: attemptedResolution,
        dedup_signature: dedupSignature,
        repeat_count: 1,
        last_seen_at: now,
        status: "open",
        notify_status: "pending",
        conversation_id: input.conversationId?.trim() || null,
      })
      .select("id")
      .single()
    if (insErr || !inserted?.id) {
      console.error("[ask_ulo/support] insert", insErr?.message)
      return { ok: false, error: insErr?.message ?? "insert failed" }
    }
    ticketId = String(inserted.id)
  }

  await bumpSignatureSignal(supabase, {
    dedupSignature,
    landlordId,
    isNewLandlordTicket: created,
  })

  await recordActivityLog(supabase, {
    landlordId,
    eventType: created
      ? "ask_ulo.support_ticket_created"
      : "ask_ulo.support_ticket_repeated",
    source: "dashboard",
    actorType: "landlord",
    conversationId: input.conversationId?.trim() || null,
    metadata: {
      message: created
        ? `Ask Ulo support ticket created: ${summary}`
        : `Ask Ulo support ticket repeated (×${repeatCount}): ${summary}`,
      ticket_id: ticketId,
      dedup_signature: dedupSignature,
      repeat_count: repeatCount,
      summary,
    },
  })

  let notifyStatus: SupportTicketNotifyStatus = "skipped"
  let notifyError: string | null = null
  if (shouldNotify(created, repeatCount)) {
    const notify = await notifySystems({
      sendEmail,
      ticketId,
      landlordId,
      summary,
      repeatCount,
      created,
      transcriptExcerpt,
      attemptedResolution,
    })
    notifyStatus = notify.status
    notifyError = notify.error
  }

  await supabase
    .from("support_tickets")
    .update({
      notify_status: notifyStatus,
      notify_error: notifyError,
      updated_at: new Date().toISOString(),
    })
    .eq("id", ticketId)

  return {
    ok: true,
    ticketId,
    created,
    repeatCount,
    summary,
    dedupSignature,
    notifyStatus,
    confirmationMarkdown: confirmationMarkdown({ created, summary, repeatCount }),
  }
}

/** Whether product-support should open/bump a ticket this turn. */
export function shouldOpenProductSupportTicket(input: {
  explicitSupportAsk: boolean
  helpMatched: boolean
  /** Prior assistant asked a clarifying question. */
  hadClarifyingAttempt: boolean
  /** Still unresolved after clarify (or no help match). */
  unresolved: boolean
}): boolean {
  if (input.explicitSupportAsk) return true
  if (input.helpMatched) return false
  // Ticket only after a clarifying attempt still left us unresolved.
  if (input.hadClarifyingAttempt && input.unresolved) return true
  return false
}

export function historyHadClarifyingAttempt(
  history: Array<{ role: string; content: string }> | undefined,
): boolean {
  const prior = (history ?? []).filter((m) => m.role === "assistant").slice(-2)
  return prior.some((m) =>
    /\b(can you (?:tell|clarify|share)|which |what (?:exactly|specifically)|could you (?:clarify|say more)|need a bit more|to help(?: me)?(?: with that)?)\b/i
      .test(m.content)
  )
}
