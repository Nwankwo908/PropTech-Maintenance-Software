/**
 * Create or bump Ask Ulo product-support tickets; best-effort Resend to systems@.
 * Persist first — notify failure never blocks the ticket row.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { sendResendEmail } from "../../delivery.ts"
import { withDeadline } from "../../ai/deadline.ts"
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

export function supportConfirmation(input: { created: boolean; summary: string; repeatCount: number; notifyStatus: SupportTicketNotifyStatus }): string {
  const saved = input.created ? `I saved a support ticket: **${input.summary}**.` : `I updated your open support ticket (**${input.summary}**). Reports recorded: **${input.repeatCount}**.`
  const notification = input.notifyStatus === "sent"
    ? "The email service accepted the product-team notification. This does not confirm it was read."
    : input.notifyStatus === "failed"
    ? "Your ticket is saved, but I could not confirm the product-team notification. You can email systems@ulohome.io and include the ticket ID below."
    : "Your ticket is saved. I cannot confirm a product-team notification yet."
  return `${saved}\n\n${notification}`
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
  signal?: AbortSignal
  deliveryKey?: string
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
    { signal: input.signal, idempotencyKey: input.deliveryKey, requireMessageId: true },
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
  const sendEmail = input.sendEmail ?? sendResendEmail

  const { data: reported, error: reportError } = await supabase.rpc("report_product_support_ticket", {
    p_landlord_id: landlordId, p_summary: summary, p_signature: dedupSignature,
    p_transcript: transcriptExcerpt, p_resolution: attemptedResolution,
    p_admin_user_id: input.adminUserId?.trim() || null,
    p_conversation_id: input.conversationId?.trim() || null,
  })
  if (reportError || !reported?.id) return { ok: false, error: reportError?.message ?? "Ticket persistence unavailable" }
  const ticketId = String(reported.id)
  const created = Boolean(reported.created)
  const repeatCount = Number(reported.repeat_count)
  const claim = reported.notify_claim as string | null

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
  }).catch(() => { console.warn("[ask_ulo/support] activity log unavailable") })

  let notifyStatus: SupportTicketNotifyStatus = reported.notify_status
  let notifyError: string | null = null
  if (claim) {
    const payload = reported.notify_payload ?? { summary, repeatCount, created, transcriptExcerpt, attemptedResolution }
    let notify: { status: SupportTicketNotifyStatus; error: string | null }
    try { notify = await withDeadline(6000, (signal) => notifySystems({
      signal, deliveryKey: reported.notify_delivery_key,
      sendEmail,
      ticketId,
      landlordId,
      summary: payload.summary,
      repeatCount: payload.repeatCount,
      created: payload.created,
      transcriptExcerpt: payload.transcriptExcerpt,
      attemptedResolution: payload.attemptedResolution,
    })) } catch { notify = { status: "failed", error: "Notification transport failed or timed out" } }
    notifyStatus = notify.status
    notifyError = notify.error
  }

  if (claim) {
    const failed = notifyStatus === "failed"
    const patch: Record<string, unknown> = {
      notify_status: notifyStatus, notify_error: notifyError, notify_claim: null,
      notify_claimed_at: null, updated_at: new Date().toISOString(),
      next_retry_at: failed ? new Date(Date.now() + 5 * 60 * 1000).toISOString() : null,
    }
    if (failed) patch.notify_attempt_count = 1
    const { data: saved, error } = await supabase.from("support_tickets").update(patch).eq("id", ticketId).eq("notify_claim", claim).select("id")
    if (error || !saved?.length) notifyStatus = "pending"
  }

  return {
    ok: true,
    ticketId,
    created,
    repeatCount,
    summary,
    dedupSignature,
    notifyStatus,
    confirmationMarkdown: supportConfirmation({ created, summary, repeatCount, notifyStatus }) + `\n\nTicket ID: ${ticketId}`,
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
    /\b(are you stuck|reply with a short description|can you (?:tell|clarify|share)|which |what (?:exactly|specifically)|could you (?:clarify|say more)|need a bit more|to help(?: me)?(?: with that)?)\b/i
      .test(m.content)
  )
}
