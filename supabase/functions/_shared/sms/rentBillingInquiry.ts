/**
 * Rent-reminder QUESTIONS → support_tickets (type rent_billing_inquiry).
 * Reuses the Ask Ulo support_tickets table with a type field — not a parallel table.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { generateIssueSummary } from "../../../../shared/maintenance/generateIssueSummary.ts"
import { recordActivityLog } from "../graph/recordActivityLog.ts"
import { notifyLandlordNeedsAttention } from "../landlordAttentionNotify.ts"
import {
  productSupportDedupSignature,
} from "../ask_ulo/support/productSupportSummary.ts"

export const RENT_BILLING_INQUIRY_TYPE = "rent_billing_inquiry" as const

/** Non-urgent billing question — escalate if still open with no staff close. */
export const RENT_BILLING_INQUIRY_TTL_MS = 24 * 60 * 60 * 1000

/** Window to attach the next free-text reply after a bare QUESTIONS. */
export const RENT_QUESTION_FOLLOWUP_ATTACH_MS = 2 * 60 * 60 * 1000

export const PENDING_RENT_BILLING_INQUIRY_KEY = "pending_rent_billing_inquiry"

export type PendingRentBillingInquiry = {
  ticketId: string
  ticketRef: string
  createdAt: string
  attachUntil: string
}

export type RentBillingInquiryTicketResult = {
  ok: true
  ticketId: string
  ticketRef: string
  created: boolean
  summary: string
  awaitingTenantDetail: boolean
}

/** Short tenant-facing ref (RQ-XXXX), same style as WO-XXXX. */
export function formatRentBillingInquiryRef(ticketId: string): string {
  const compact = ticketId.replace(/-/g, "").slice(0, 4).toUpperCase()
  return `RQ-${compact || "0000"}`
}

/**
 * Strip the QUESTIONS/HELP keyword and return the inline ask, if any.
 */
export function extractInlineRentQuestion(body: string): string | null {
  let t = body.trim()
  if (!t) return null
  t = t
    .replace(
      /^(?:reply\s+)?(?:questions?|help|talk|call|manager)\b[\s,.:;!?\-—–]*/i,
      "",
    )
    .trim()
  if (!t || t.length < 3) return null
  // Drop lone punctuation / emoji noise
  if (/^[\W_]+$/u.test(t)) return null
  return t
}

export function summarizeRentBillingInquiryQuestion(
  inlineQuestion: string | null,
): { summary: string; awaitingTenantDetail: boolean } {
  if (!inlineQuestion?.trim()) {
    return {
      summary: "Resident asked a rent question (no details yet)",
      awaitingTenantDetail: true,
    }
  }
  const summary = generateIssueSummary(inlineQuestion, {
    format: "summary",
    category: "rent",
    maxWords: 18,
  })
  return {
    summary: summary?.trim() || inlineQuestion.trim().slice(0, 90),
    awaitingTenantDetail: false,
  }
}

export function rentBillingInquiryDedupSignature(input: {
  residentId: string
  billingPeriod: string | null
  summary: string
  awaitingTenantDetail: boolean
}): string {
  if (input.awaitingTenantDetail) {
    const period = (input.billingPeriod ?? "open").trim() || "open"
    return `rbi_bare_${input.residentId.slice(0, 8)}_${period}`
  }
  // Prefix so product-support signatures never collide.
  const base = productSupportDedupSignature(input.summary).replace(/^ps_/, "rbi_")
  return `${base}_${input.residentId.slice(0, 8)}`
}

export function readPendingRentBillingInquiry(
  intake: unknown,
): PendingRentBillingInquiry | null {
  if (!intake || typeof intake !== "object") return null
  const raw = (intake as Record<string, unknown>)[PENDING_RENT_BILLING_INQUIRY_KEY]
  if (!raw || typeof raw !== "object") return null
  const row = raw as Record<string, unknown>
  const ticketId = typeof row.ticketId === "string" ? row.ticketId.trim() : ""
  const ticketRef = typeof row.ticketRef === "string" ? row.ticketRef.trim() : ""
  const createdAt = typeof row.createdAt === "string" ? row.createdAt : ""
  const attachUntil = typeof row.attachUntil === "string" ? row.attachUntil : ""
  if (!ticketId || !attachUntil) return null
  return {
    ticketId,
    ticketRef: ticketRef || formatRentBillingInquiryRef(ticketId),
    createdAt,
    attachUntil,
  }
}

export function writePendingRentBillingInquiry(
  intake: Record<string, unknown>,
  pending: PendingRentBillingInquiry | null,
): Record<string, unknown> {
  const next = { ...intake }
  if (!pending) {
    delete next[PENDING_RENT_BILLING_INQUIRY_KEY]
    return next
  }
  next[PENDING_RENT_BILLING_INQUIRY_KEY] = pending
  return next
}

export function isPendingRentBillingInquiryOpen(
  pending: PendingRentBillingInquiry,
  now: Date = new Date(),
): boolean {
  const until = Date.parse(pending.attachUntil)
  return Number.isFinite(until) && until > now.getTime()
}

export async function createOrBumpRentBillingInquiryTicket(
  supabase: SupabaseClient,
  input: {
    landlordId: string
    residentId: string
    conversationId: string
    workflowRunId?: string | null
    billingPeriod?: string | null
    body: string
    messageId?: string | null
    now?: Date
  },
): Promise<RentBillingInquiryTicketResult | { ok: false; error: string }> {
  const landlordId = input.landlordId.trim()
  const residentId = input.residentId.trim()
  const conversationId = input.conversationId.trim()
  if (!landlordId || !residentId || !conversationId) {
    return { ok: false, error: "landlordId, residentId, and conversationId are required" }
  }

  const now = input.now ?? new Date()
  const nowIso = now.toISOString()
  const inline = extractInlineRentQuestion(input.body)
  const { summary, awaitingTenantDetail } = summarizeRentBillingInquiryQuestion(inline)
  const dedupSignature = rentBillingInquiryDedupSignature({
    residentId,
    billingPeriod: input.billingPeriod ?? null,
    summary,
    awaitingTenantDetail,
  })
  const escalateAfter = new Date(now.getTime() + RENT_BILLING_INQUIRY_TTL_MS).toISOString()
  const transcriptExcerpt = inline
    ? `Resident: ${inline.trim().slice(0, 400)}`
    : "Resident: QUESTIONS (no details yet)"

  const { data: openTicket, error: lookupErr } = await supabase
    .from("support_tickets")
    .select("id, repeat_count, summary, awaiting_tenant_detail")
    .eq("landlord_id", landlordId)
    .eq("type", RENT_BILLING_INQUIRY_TYPE)
    .eq("dedup_signature", dedupSignature)
    .eq("status", "open")
    .maybeSingle()

  if (lookupErr) {
    console.error("[rent-billing-inquiry] lookup", lookupErr.message)
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
        last_seen_at: nowIso,
        updated_at: nowIso,
        transcript_excerpt: transcriptExcerpt,
        summary,
        awaiting_tenant_detail: awaitingTenantDetail,
        conversation_id: conversationId,
        resident_id: residentId,
        workflow_run_id: input.workflowRunId?.trim() || null,
        // Fresh detail resets the escalate clock; bare bump keeps existing unless null.
        escalate_after: awaitingTenantDetail ? escalateAfter : escalateAfter,
        escalated_at: null,
      })
      .eq("id", ticketId)
    if (updErr) {
      console.error("[rent-billing-inquiry] bump", updErr.message)
      return { ok: false, error: updErr.message }
    }
  } else {
    created = true
    repeatCount = 1
    const { data: inserted, error: insErr } = await supabase
      .from("support_tickets")
      .insert({
        type: RENT_BILLING_INQUIRY_TYPE,
        summary,
        landlord_id: landlordId,
        transcript_excerpt: transcriptExcerpt,
        dedup_signature: dedupSignature,
        repeat_count: 1,
        last_seen_at: nowIso,
        status: "open",
        notify_status: "pending",
        conversation_id: conversationId,
        resident_id: residentId,
        workflow_run_id: input.workflowRunId?.trim() || null,
        escalate_after: escalateAfter,
        awaiting_tenant_detail: awaitingTenantDetail,
      })
      .select("id")
      .single()
    if (insErr || !inserted?.id) {
      console.error("[rent-billing-inquiry] insert", insErr?.message)
      return { ok: false, error: insErr?.message ?? "insert failed" }
    }
    ticketId = String(inserted.id)
  }

  const ticketRef = formatRentBillingInquiryRef(ticketId)

  await recordActivityLog(supabase, {
    landlordId,
    eventType: created
      ? "rent.billing_inquiry_ticket_created"
      : "rent.billing_inquiry_ticket_updated",
    source: "sms",
    actorType: "resident",
    residentId,
    conversationId,
    workflowRunId: input.workflowRunId?.trim() || null,
    workflowTemplateId: "rent_collection",
    metadata: {
      message: created
        ? `Rent question ticket ${ticketRef}: ${summary}`
        : `Rent question ticket ${ticketRef} updated: ${summary}`,
      ticket_id: ticketId,
      ticket_ref: ticketRef,
      summary,
      awaiting_tenant_detail: awaitingTenantDetail,
    },
  })

  const detail = inline
    ? `Latest message: "${inline.trim().slice(0, 160)}"`
    : "They replied QUESTIONS on a rent reminder (waiting for details)."

  let notifyStatus: "pending" | "sent" | "failed" | "skipped" = "pending"
  let notifyError: string | null = null
  try {
    const attention = await notifyLandlordNeedsAttention(supabase, {
      landlordId,
      kind: "late_rent",
      headline: created
        ? `Resident rent question — ${ticketRef}`
        : `Rent question update — ${ticketRef}`,
      detail,
      whyLine: "A resident asked about rent and needs a reply from your team.",
      nextSteps: [
        "Read the question in Messages",
        "Reply to the resident on the SMS thread",
      ],
      idempotencyKey: created
        ? `rent-billing-inquiry:${ticketId}:created`
        : `rent-billing-inquiry:${ticketId}:bump:${repeatCount}`,
      residentId,
      workflowRunId: input.workflowRunId?.trim() || null,
    })
    notifyStatus = attention.skipped
      ? "skipped"
      : attention.errors.length > 0 &&
          attention.smsSent.length === 0 &&
          attention.emailSent.length === 0
      ? "failed"
      : "sent"
    notifyError = attention.errors[0]?.slice(0, 500) ?? null
  } catch (err) {
    notifyStatus = "failed"
    notifyError = err instanceof Error ? err.message.slice(0, 500) : "notify failed"
    console.error("[rent-billing-inquiry] landlord notify", notifyError)
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
    ticketRef,
    created,
    summary,
    awaitingTenantDetail,
  }
}

/**
 * Attach a follow-up SMS to an open bare-QUESTIONS ticket and clear the wait flag.
 */
export async function attachFollowUpToRentBillingInquiryTicket(
  supabase: SupabaseClient,
  input: {
    ticketId: string
    landlordId: string
    residentId: string
    conversationId: string
    body: string
    workflowRunId?: string | null
  },
): Promise<RentBillingInquiryTicketResult | { ok: false; error: string }> {
  const inline = extractInlineRentQuestion(input.body) ?? input.body.trim()
  if (!inline || inline.length < 2) {
    return { ok: false, error: "empty follow-up" }
  }
  const { summary } = summarizeRentBillingInquiryQuestion(inline)
  const nowIso = new Date().toISOString()
  const escalateAfter = new Date(Date.now() + RENT_BILLING_INQUIRY_TTL_MS).toISOString()
  const transcriptExcerpt = `Resident: ${inline.slice(0, 400)}`

  const { data: row, error } = await supabase
    .from("support_tickets")
    .update({
      summary,
      transcript_excerpt: transcriptExcerpt,
      awaiting_tenant_detail: false,
      last_seen_at: nowIso,
      updated_at: nowIso,
      escalate_after: escalateAfter,
      escalated_at: null,
      conversation_id: input.conversationId,
    })
    .eq("id", input.ticketId)
    .eq("type", RENT_BILLING_INQUIRY_TYPE)
    .eq("status", "open")
    .select("id, repeat_count")
    .maybeSingle()

  if (error || !row?.id) {
    return { ok: false, error: error?.message ?? "ticket not found" }
  }

  const ticketRef = formatRentBillingInquiryRef(String(row.id))

  await recordActivityLog(supabase, {
    landlordId: input.landlordId,
    eventType: "rent.billing_inquiry_detail_attached",
    source: "sms",
    actorType: "resident",
    residentId: input.residentId,
    conversationId: input.conversationId,
    workflowRunId: input.workflowRunId?.trim() || null,
    workflowTemplateId: "rent_collection",
    metadata: {
      message: `Resident added detail to rent question ${ticketRef}: ${summary}`,
      ticket_id: String(row.id),
      ticket_ref: ticketRef,
      summary,
    },
  })

  try {
    await notifyLandlordNeedsAttention(supabase, {
      landlordId: input.landlordId,
      kind: "late_rent",
      headline: `Rent question detail — ${ticketRef}`,
      detail: `Latest message: "${inline.slice(0, 160)}"`,
      whyLine: "The resident followed up with more detail on their rent question.",
      nextSteps: [
        "Read the question in Messages",
        "Reply to the resident on the SMS thread",
      ],
      idempotencyKey: `rent-billing-inquiry:${row.id}:detail:${nowIso}`,
      residentId: input.residentId,
      workflowRunId: input.workflowRunId?.trim() || null,
    })
  } catch (err) {
    console.error(
      "[rent-billing-inquiry] detail notify",
      err instanceof Error ? err.message : err,
    )
  }

  return {
    ok: true,
    ticketId: String(row.id),
    ticketRef,
    created: false,
    summary,
    awaitingTenantDetail: false,
  }
}
