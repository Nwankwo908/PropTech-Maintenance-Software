/**
 * Cron: escalate open rent_billing_inquiry tickets past escalate_after.
 * Mirrors tenant rent-report confirm TTL / dwell — one escalate notify, then stamp escalated_at.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { recordActivityLog } from "../graph/recordActivityLog.ts"
import { loadLandlordOperationalSettings } from "../landlordNotificationPrefs.ts"
import { isRentCollectionPaused } from "../engine/rentCollectionPolicy.ts"
import { notifyLandlordNeedsAttention } from "../landlordAttentionNotify.ts"
import {
  formatRentBillingInquiryRef,
  RENT_BILLING_INQUIRY_TYPE,
} from "./rentBillingInquiry.ts"

export type RentBillingInquiryTtlSummary = {
  scanned: number
  escalated: number
  skipped: number
  dryRun: boolean
}

export async function processRentBillingInquiryTtl(
  supabase: SupabaseClient,
  options?: {
    landlordId?: string | null
    now?: Date
    limit?: number
    dryRun?: boolean
  },
): Promise<RentBillingInquiryTtlSummary> {
  const now = options?.now ?? new Date()
  const limit = options?.limit ?? 40
  const dryRun = options?.dryRun === true
  const nowIso = now.toISOString()

  let q = supabase
    .from("support_tickets")
    .select(
      "id, landlord_id, resident_id, conversation_id, workflow_run_id, summary, escalate_after",
    )
    .eq("type", RENT_BILLING_INQUIRY_TYPE)
    .eq("status", "open")
    .is("escalated_at", null)
    .not("escalate_after", "is", null)
    .lte("escalate_after", nowIso)
    .order("escalate_after", { ascending: true })
    .limit(limit)

  if (options?.landlordId?.trim()) {
    q = q.eq("landlord_id", options.landlordId.trim())
  }

  const { data: rows, error } = await q
  if (error) {
    console.error("[rent-billing-inquiry-ttl] list", error.message)
    return { scanned: 0, escalated: 0, skipped: 0, dryRun }
  }

  let scanned = 0
  let escalated = 0
  let skipped = 0

  for (const row of rows ?? []) {
    scanned += 1
    const ticketId = String(row.id ?? "").trim()
    const landlordId = String(row.landlord_id ?? "").trim()
    if (!ticketId || !landlordId) {
      skipped += 1
      continue
    }

    const operational = await loadLandlordOperationalSettings(supabase, landlordId)
    if (isRentCollectionPaused(operational.rentCollectionPaused)) {
      skipped += 1
      continue
    }

    if (dryRun) {
      escalated += 1
      continue
    }

    const ticketRef = formatRentBillingInquiryRef(ticketId)
    const summary =
      typeof row.summary === "string" && row.summary.trim()
        ? row.summary.trim()
        : "Rent question"

    try {
      await notifyLandlordNeedsAttention(supabase, {
        landlordId,
        kind: "late_rent",
        headline: `Unanswered rent question — ${ticketRef}`,
        detail: summary.slice(0, 200),
        whyLine:
          "This rent question has had no staff reply for 24 hours and needs a follow-up.",
        nextSteps: [
          "Reply to the resident on the SMS thread",
          "Close the question once answered",
        ],
        idempotencyKey: `rent-billing-inquiry-ttl:${ticketId}:${row.escalate_after}`,
        residentId:
          typeof row.resident_id === "string" ? row.resident_id : null,
        workflowRunId:
          typeof row.workflow_run_id === "string" ? row.workflow_run_id : null,
      })
    } catch (err) {
      console.error(
        "[rent-billing-inquiry-ttl] notify",
        ticketId,
        err instanceof Error ? err.message : err,
      )
    }

    await supabase
      .from("support_tickets")
      .update({
        escalated_at: nowIso,
        updated_at: nowIso,
        notify_status: "sent",
      })
      .eq("id", ticketId)

    await recordActivityLog(supabase, {
      landlordId,
      eventType: "rent.billing_inquiry_escalated",
      source: "automation",
      actorType: "system",
      residentId:
        typeof row.resident_id === "string" ? row.resident_id : null,
      conversationId:
        typeof row.conversation_id === "string" ? row.conversation_id : null,
      workflowRunId:
        typeof row.workflow_run_id === "string" ? row.workflow_run_id : null,
      workflowTemplateId: "rent_collection",
      metadata: {
        message: `Rent question ${ticketRef} escalated after 24h with no staff reply.`,
        ticket_id: ticketId,
        ticket_ref: ticketRef,
        summary,
      },
    })

    escalated += 1
  }

  return { scanned, escalated, skipped, dryRun }
}
