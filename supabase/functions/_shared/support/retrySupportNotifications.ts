import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { sendResendEmail } from "../delivery.ts"
import { PRODUCT_SUPPORT_NOTIFY_EMAIL } from "../ask_ulo/support/createProductSupportTicket.ts"
import { recordActivityLog } from "../graph/recordActivityLog.ts"

const MAX_ATTEMPTS = 3

/** Delay after a failed attempt. Null means stop. */
export function supportNotifyRetryDelayMs(attemptCount: number): number | null {
  if (attemptCount >= MAX_ATTEMPTS) return null
  if (attemptCount <= 1) return 5 * 60 * 1000
  return 30 * 60 * 1000
}

type DueTicket = {
  id: string
  landlord_id: string
  summary: string
  repeat_count: number
  transcript_excerpt: string | null
  attempted_resolution: string | null
  notify_delivery_key: string | null
  notify_attempt_count: number | null
  notify_payload: Record<string, unknown> | null
}

export async function retryFailedSupportNotifications(
  supabase: SupabaseClient,
  options: { sendEmail?: typeof sendResendEmail; now?: Date; limit?: number } = {},
): Promise<{ checked: number; sent: number; failed: number; skipped: number }> {
  const sendEmail = options.sendEmail ?? sendResendEmail
  const now = options.now ?? new Date()
  const { data, error } = await supabase
    .from("support_tickets")
    .select("id, landlord_id, summary, repeat_count, transcript_excerpt, attempted_resolution, notify_delivery_key, notify_attempt_count, notify_payload")
    .eq("notify_status", "failed")
    .lt("notify_attempt_count", MAX_ATTEMPTS)
    .not("next_retry_at", "is", null)
    .lte("next_retry_at", now.toISOString())
    .limit(options.limit ?? 10)
  if (error || !data) return { checked: 0, sent: 0, failed: 0, skipped: 0 }

  let sent = 0
  let failed = 0
  let skipped = 0
  for (const row of data as DueTicket[]) {
    const claim = crypto.randomUUID()
    const { data: claimed } = await supabase
      .from("support_tickets")
      .update({ notify_claim: claim, notify_claimed_at: now.toISOString(), notify_status: "pending" })
      .eq("id", row.id)
      .eq("notify_status", "failed")
      .select("id")
    if (!claimed?.length) {
      skipped += 1
      continue
    }
    const payload = row.notify_payload ?? {}
    const summary = typeof payload.summary === "string" ? payload.summary : row.summary
    const text = [
      `Ticket: ${row.id}`,
      `Landlord: ${row.landlord_id}`,
      `Summary: ${summary}`,
      "",
      "This is a retry of a notification that did not send earlier.",
      "",
      String(payload.transcriptExcerpt ?? row.transcript_excerpt ?? ""),
    ].join("\n")
    const result = await sendEmail(
      PRODUCT_SUPPORT_NOTIFY_EMAIL,
      `[Ask Ulo] Support ticket update: ${summary}`,
      text,
      `<pre>${text.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</pre>`,
      { idempotencyKey: row.notify_delivery_key ?? row.id, requireMessageId: true },
    )
    const nextAttempt = (row.notify_attempt_count ?? 0) + 1
    if ("error" in result) {
      const delay = supportNotifyRetryDelayMs(nextAttempt)
      await supabase.from("support_tickets").update({
        notify_status: "failed",
        notify_error: result.error.slice(0, 500),
        notify_claim: null,
        notify_claimed_at: null,
        notify_attempt_count: nextAttempt,
        next_retry_at: delay == null ? null : new Date(now.getTime() + delay).toISOString(),
        updated_at: now.toISOString(),
      }).eq("id", row.id).eq("notify_claim", claim)
      failed += 1
      continue
    }
    await supabase.from("support_tickets").update({
      notify_status: "sent",
      notify_error: null,
      notify_claim: null,
      notify_claimed_at: null,
      notify_attempt_count: nextAttempt,
      next_retry_at: null,
      updated_at: now.toISOString(),
    }).eq("id", row.id).eq("notify_claim", claim)
    await recordActivityLog(supabase, {
      landlordId: row.landlord_id,
      eventType: "ask_ulo.support_notification_retried",
      source: "automation",
      actorType: "system",
      metadata: { message: "A failed support notification was sent.", ticket_id: row.id },
    }).catch(() => undefined)
    sent += 1
  }
  return { checked: data.length, sent, failed, skipped }
}
