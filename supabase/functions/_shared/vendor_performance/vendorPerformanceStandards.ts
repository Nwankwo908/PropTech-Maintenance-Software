/**
 * Vendor Performance Standards (§7).
 *
 * | Metric                         | Threshold              | Consequence           |
 * |--------------------------------|------------------------|-----------------------|
 * | Avg rating (5+ jobs)           | < 3.5 stars            | Review + coaching     |
 * | Avg rating — continued         | < 3.0 persistent       | Suspension review     |
 * | No-show                        | >2 in 30 days          | Warning issued        |
 * | No-show — continued            | >3 in 60 days          | Suspension review     |
 * | Job acceptance rate            | < 40% over 20+ jobs    | Profile review        |
 * | Misconduct (Class A/B)         | Any incident           | Immediate suspension  |
 *
 * Soft reviews update `performance_review` + ops notify; misconduct sets roster SUSPENDED.
 * Capacity (Paused) is separate.
 */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { logGraphEvent } from "../graph/logGraphEvent.ts"
import { sendLandlordOpsEmail } from "../landlordOpsNotify.ts"
import { getSMSProvider } from "../sms/providerFactory.ts"
import {
  findOrCreateConversation,
  normalizeSmsPhone,
  upsertSmsIdentityForPhone,
} from "../sms/inbound_db.ts"
import { sendInboundAutoReply } from "../sms/inboundReply.ts"
import { resolveOutboundLandlordSmsLine } from "../sms/landlordSmsOnboarding.ts"
import { resolveVendorVerificationConversationId } from "../sms/vendorVerificationInbox.ts"
import type { SmsProviderName } from "../sms/types.ts"
import { loadLandlordDisplayName } from "../landlordDisplayName.ts"

export type PerformanceNotices = {
  rating_coaching?: string
  rating_suspension_review?: string
  noshow_warning?: string
  noshow_suspension_review?: string
  acceptance_profile_review?: string
}

export type PerformanceReviewKind =
  | "coaching"
  | "profile_review"
  | "suspension_review"

export type PerformanceSummary = {
  scanned: number
  noShowsRecorded: number
  coaching: number
  warnings: number
  profileReviews: number
  suspensionReviews: number
  errors: string[]
}

export type MisconductClass = "A" | "B"

const RATING_MIN_JOBS = 5
const RATING_COACHING_MAX = 3.5
const RATING_SUSPEND_REVIEW_MAX = 3.0
const NOSHOW_WARN_COUNT = 2
const NOSHOW_WARN_DAYS = 30
const NOSHOW_REVIEW_COUNT = 3
const NOSHOW_REVIEW_DAYS = 60
const ACCEPTANCE_MIN_JOBS = 20
const ACCEPTANCE_MIN_RATE = 0.4
/** Confirmed appointment is a no-show this many ms after scheduled_at without progress. */
const NOSHOW_GRACE_MS = 2 * 60 * 60 * 1000

const PERFORMANCE_SUSPEND_REASONS = new Set([
  "misconduct_class_a",
  "misconduct_class_b",
  "performance_low_rating",
  "performance_noshow",
])

export function asNotices(raw: unknown): PerformanceNotices {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {}
  return { ...(raw as PerformanceNotices) }
}

export function evaluateRatingStandards(input: {
  reviewCount: number
  avgRating: number | null
  notices: PerformanceNotices
}): { coaching: boolean; suspensionReview: boolean } {
  const avg = input.avgRating
  if (avg == null || input.reviewCount < RATING_MIN_JOBS) {
    return { coaching: false, suspensionReview: false }
  }
  const suspensionReview =
    avg < RATING_SUSPEND_REVIEW_MAX &&
    Boolean(input.notices.rating_coaching) &&
    !input.notices.rating_suspension_review
  const coaching =
    !suspensionReview &&
    avg < RATING_COACHING_MAX &&
    !input.notices.rating_coaching
  return { coaching, suspensionReview }
}

export function evaluateNoShowStandards(input: {
  count30: number
  count60: number
  notices: PerformanceNotices
}): { warning: boolean; suspensionReview: boolean } {
  const suspensionReview =
    input.count60 > NOSHOW_REVIEW_COUNT &&
    !input.notices.noshow_suspension_review
  const warning =
    !suspensionReview &&
    input.count30 > NOSHOW_WARN_COUNT &&
    !input.notices.noshow_warning
  return { warning, suspensionReview }
}

export function evaluateAcceptanceStandards(input: {
  offered: number
  accepted: number
  notices: PerformanceNotices
}): { profileReview: boolean; rate: number | null } {
  if (input.offered < ACCEPTANCE_MIN_JOBS) {
    return { profileReview: false, rate: null }
  }
  const rate = input.offered > 0 ? input.accepted / input.offered : null
  const profileReview =
    rate != null &&
    rate < ACCEPTANCE_MIN_RATE &&
    !input.notices.acceptance_profile_review
  return { profileReview, rate }
}

export function buildPerformanceCoachingSms(input: {
  vendorLabel: string
  companyName?: string | null
  avgRating: number
}): string {
  const name = input.vendorLabel.trim() || "there"
  const company = input.companyName?.trim()
  const team = company
    ? `This is the property management team at ${company}.`
    : "This is the property management team."
  return [
    `Hi ${name},`,
    "",
    team,
    "",
    `We value you as a preferred vendor. Your recent average rating is ${
      input.avgRating.toFixed(1)
    } stars, which is below our target.`,
    "",
    "A member of our team will reach out soon with coaching and tips so we can keep sending you work orders.",
  ].join("\n")
}

export function buildNoShowWarningSms(input: {
  vendorLabel: string
  companyName?: string | null
  count30: number
}): string {
  const name = input.vendorLabel.trim() || "there"
  const company = input.companyName?.trim()
  const team = company
    ? `This is the property management team at ${company}.`
    : "This is the property management team."
  return [
    `Hi ${name},`,
    "",
    team,
    "",
    `We've recorded ${input.count30} missed appointments in the last ${NOSHOW_WARN_DAYS} days.`,
    "",
    "Please confirm only times you can keep. Continued no-shows may affect your eligibility for new work orders.",
  ].join("\n")
}

export function buildAcceptanceProfileReviewSms(input: {
  vendorLabel: string
  companyName?: string | null
  ratePct: number
}): string {
  const name = input.vendorLabel.trim() || "there"
  const company = input.companyName?.trim()
  const team = company
    ? `This is the property management team at ${company}.`
    : "This is the property management team."
  return [
    `Hi ${name},`,
    "",
    team,
    "",
    `Your recent job acceptance rate is about ${input.ratePct}%, which is below our preferred network target.`,
    "",
    "We'll review your profile and may adjust the types of work we send. Reply if your availability or service area has changed.",
  ].join("\n")
}

export function buildMisconductSuspendedSms(input: {
  vendorLabel: string
  companyName?: string | null
}): string {
  const name = input.vendorLabel.trim() || "there"
  const company = input.companyName?.trim()
  const team = company
    ? `This is the property management team at ${company}.`
    : "This is the property management team."
  return [
    `Hi ${name},`,
    "",
    team,
    "",
    "We've placed a hold on your vendor account while we review a reported incident.",
    "",
    "You won't receive new work orders until this review is complete. Our team will contact you with next steps.",
  ].join("\n")
}

function adminNotifyPhones(): string[] {
  const raw = Deno.env.get("SMS_ADMIN_NOTIFY_PHONES")?.trim() ?? ""
  return raw.split(",").map((p: string) => p.trim()).filter(Boolean)
}

async function ensureVendorSmsChannel(
  supabase: SupabaseClient,
  params: {
    landlordId: string
    vendorId: string | null
    phone: string | null
  },
): Promise<{
  conversationId: string | null
  fromNumber: string | null
  toNumber: string | null
  provider: SmsProviderName | null
}> {
  const line = await resolveOutboundLandlordSmsLine(supabase, params.landlordId)
  if (!line?.phone) {
    return { conversationId: null, fromNumber: null, toNumber: null, provider: null }
  }
  const provider: SmsProviderName = line.provider === "telnyx" ? "telnyx" : "twilio"
  const toNumber = normalizeSmsPhone(params.phone ?? "")
  let conversationId = await resolveVendorVerificationConversationId(supabase, {
    landlordId: params.landlordId,
    inviteConversationId: null,
    vendorId: params.vendorId,
    phone: params.phone,
  })

  if (!conversationId && toNumber) {
    const identity = await upsertSmsIdentityForPhone(supabase, {
      landlordId: params.landlordId,
      phone: toNumber,
      identityType: "vendor",
      vendorId: params.vendorId ?? null,
    })
    if (identity) {
      const created = await findOrCreateConversation(supabase, {
        landlordId: params.landlordId,
        smsNumberId: line.id,
        externalPhone: toNumber,
        identity,
        conversationStatus: "open",
      })
      conversationId = created.conversationId
    }
  }

  return {
    conversationId,
    fromNumber: normalizeSmsPhone(line.phone),
    toNumber: toNumber || null,
    provider,
  }
}

async function sendVendorSms(
  supabase: SupabaseClient,
  params: {
    landlordId: string
    vendorId: string | null
    phone: string | null
    body: string
    source: string
  },
): Promise<string | null> {
  const channel = await ensureVendorSmsChannel(supabase, params)
  if (
    !channel.conversationId ||
    !channel.fromNumber ||
    !channel.toNumber ||
    !channel.provider
  ) {
    return null
  }
  const sent = await sendInboundAutoReply(supabase, {
    conversationId: channel.conversationId,
    landlordId: params.landlordId,
    fromNumber: channel.fromNumber,
    toNumber: channel.toNumber,
    body: params.body,
    provider: channel.provider,
    source: params.source,
  })
  return sent.messageId ?? null
}

async function notifyOpsSms(body: string, landlordId: string, supabase: SupabaseClient) {
  const phones = adminNotifyPhones()
  if (phones.length === 0) return
  const line = await resolveOutboundLandlordSmsLine(supabase, landlordId)
  if (!line?.phone) return
  const provider = getSMSProvider()
  for (const to of phones) {
    const send = await provider.sendMessage({
      to,
      body,
      from: line.phone,
    })
    if (send.error) {
      console.warn("[vendor-performance] ops SMS failed", to, send.error)
    }
  }
}

async function updateVendorPerformance(
  supabase: SupabaseClient,
  params: {
    vendorId: string
    landlordId: string
    notices: PerformanceNotices
    review?: PerformanceReviewKind | null
  },
): Promise<boolean> {
  const patch: Record<string, unknown> = {
    performance_notices: params.notices,
  }
  if (params.review !== undefined) {
    patch.performance_review = params.review
  }
  const { error } = await supabase
    .from("vendors")
    .update(patch)
    .eq("id", params.vendorId)
    .eq("landlord_id", params.landlordId)
  if (error) {
    console.error("[vendor-performance] update", error.message)
    return false
  }
  return true
}

function escalateReview(
  current: string | null | undefined,
  next: PerformanceReviewKind,
): PerformanceReviewKind {
  const rank: Record<PerformanceReviewKind, number> = {
    coaching: 1,
    profile_review: 2,
    suspension_review: 3,
  }
  const cur = (current ?? "").trim() as PerformanceReviewKind
  if (cur in rank && rank[cur] >= rank[next]) return cur
  return next
}

/** Record confirmed appointments that lapsed without vendor progress. */
export async function recordLapsedNoShows(
  supabase: SupabaseClient,
  landlordId: string | null,
  now = new Date(),
): Promise<{ recorded: number; errors: string[] }> {
  const cutoff = new Date(now.getTime() - NOSHOW_GRACE_MS).toISOString()
  let query = supabase
    .from("maintenance_requests")
    .select(
      "id, landlord_id, assigned_vendor_id, scheduled_at, schedule_confirmed_at, vendor_work_status",
    )
    .not("schedule_confirmed_at", "is", null)
    .not("scheduled_at", "is", null)
    .not("assigned_vendor_id", "is", null)
    .lt("scheduled_at", cutoff)
    .in("vendor_work_status", ["accepted", "pending_accept"])
    .limit(300)

  if (landlordId?.trim()) {
    query = query.eq("landlord_id", landlordId.trim())
  }

  const { data: rows, error } = await query
  const errors: string[] = []
  if (error) return { recorded: 0, errors: [error.message] }

  let recorded = 0
  for (const raw of rows ?? []) {
    const row = raw as Record<string, unknown>
    const ticketId = typeof row.id === "string" ? row.id : ""
    const lid = typeof row.landlord_id === "string" ? row.landlord_id : ""
    const vendorId = typeof row.assigned_vendor_id === "string"
      ? row.assigned_vendor_id
      : ""
    const scheduledAt = typeof row.scheduled_at === "string" ? row.scheduled_at : ""
    if (!ticketId || !lid || !vendorId || !scheduledAt) continue

    const { error: insertErr } = await supabase.from("vendor_job_no_shows").insert({
      landlord_id: lid,
      vendor_id: vendorId,
      maintenance_request_id: ticketId,
      scheduled_at: scheduledAt,
      source: "performance_cron",
    })
    if (insertErr) {
      // Unique violation = already recorded
      if (!/duplicate|unique/i.test(insertErr.message)) {
        errors.push(insertErr.message)
      }
      continue
    }

    recorded += 1
    await logGraphEvent(supabase, {
      landlord_id: lid,
      event_type: "vendor.job_no_show",
      source: "automation",
      actor_type: "system",
      vendor_id: vendorId,
      maintenance_request_id: ticketId,
      metadata: {
        scheduled_at: scheduledAt,
        summary: "Confirmed appointment lapsed without job progress.",
      },
    })
  }

  return { recorded, errors }
}

async function loadRatingStats(
  supabase: SupabaseClient,
  vendorId: string,
  landlordId: string,
): Promise<{ reviewCount: number; avgRating: number | null }> {
  const { data, error } = await supabase
    .from("vendor_feedback")
    .select("rating")
    .eq("vendor_id", vendorId)
    .eq("landlord_id", landlordId)
    .not("rating", "is", null)

  if (error || !data?.length) {
    return { reviewCount: 0, avgRating: null }
  }
  const ratings = data
    .map((r) => (typeof r.rating === "number" ? r.rating : null))
    .filter((n): n is number => n != null)
  if (ratings.length === 0) return { reviewCount: 0, avgRating: null }
  const sum = ratings.reduce((a, b) => a + b, 0)
  return {
    reviewCount: ratings.length,
    avgRating: Math.round((sum / ratings.length) * 100) / 100,
  }
}

async function loadAcceptanceStats(
  supabase: SupabaseClient,
  vendorId: string,
): Promise<{ offered: number; accepted: number }> {
  const { data, error } = await supabase
    .from("vendor_status_events")
    .select("to_status")
    .eq("vendor_id", vendorId)
    .in("to_status", ["accepted", "declined"])

  if (error || !data) return { offered: 0, accepted: 0 }
  let accepted = 0
  let declined = 0
  for (const row of data) {
    const s = (row.to_status ?? "").toString()
    if (s === "accepted") accepted += 1
    else if (s === "declined") declined += 1
  }
  return { offered: accepted + declined, accepted }
}

async function countNoShowsSince(
  supabase: SupabaseClient,
  vendorId: string,
  landlordId: string,
  sinceIso: string,
): Promise<number> {
  const { count, error } = await supabase
    .from("vendor_job_no_shows")
    .select("id", { count: "exact", head: true })
    .eq("vendor_id", vendorId)
    .eq("landlord_id", landlordId)
    .gte("recorded_at", sinceIso)
  if (error) return 0
  return count ?? 0
}

async function processVendorPerformance(
  supabase: SupabaseClient,
  params: {
    vendorId: string
    landlordId: string
    vendorName: string
    phone: string | null
    companyName: string | null
    notices: PerformanceNotices
    currentReview: string | null
    now: Date
  },
  summary: PerformanceSummary,
): Promise<void> {
  let notices = { ...params.notices }
  let review = params.currentReview

  const ratings = await loadRatingStats(
    supabase,
    params.vendorId,
    params.landlordId,
  )
  const ratingEval = evaluateRatingStandards({
    reviewCount: ratings.reviewCount,
    avgRating: ratings.avgRating,
    notices,
  })

  if (ratingEval.coaching && ratings.avgRating != null) {
    const body = buildPerformanceCoachingSms({
      vendorLabel: params.vendorName,
      companyName: params.companyName,
      avgRating: ratings.avgRating,
    })
    const messageId = await sendVendorSms(supabase, {
      landlordId: params.landlordId,
      vendorId: params.vendorId,
      phone: params.phone,
      body,
      source: "vendor_performance_coaching",
    })
    notices = { ...notices, rating_coaching: params.now.toISOString() }
    review = escalateReview(review, "coaching")
    await sendLandlordOpsEmail(supabase, {
      landlordId: params.landlordId,
      subject: `${params.vendorName}: performance coaching (avg ${ratings.avgRating.toFixed(1)})`,
      text:
        `${params.vendorName} has an average rating of ${ratings.avgRating.toFixed(1)} ` +
        `across ${ratings.reviewCount} jobs (below 3.5). Coaching SMS sent — please follow up.`,
      html:
        `<p><strong>${params.vendorName}</strong> has an average rating of ` +
        `<strong>${ratings.avgRating.toFixed(1)}</strong> across ${ratings.reviewCount} jobs ` +
        `(below 3.5).</p><p>Coaching SMS sent — please follow up.</p>`,
      logLabel: "vendor_performance_coaching",
    })
    await logGraphEvent(supabase, {
      landlord_id: params.landlordId,
      event_type: "vendor.performance_coaching",
      source: "automation",
      actor_type: "system",
      vendor_id: params.vendorId,
      message_id: messageId,
      metadata: {
        avg_rating: ratings.avgRating,
        review_count: ratings.reviewCount,
        summary: `${params.vendorName}: coaching — avg ${ratings.avgRating.toFixed(1)}.`,
      },
    })
    summary.coaching += 1
  }

  if (ratingEval.suspensionReview && ratings.avgRating != null) {
    notices = {
      ...notices,
      rating_suspension_review: params.now.toISOString(),
    }
    review = escalateReview(review, "suspension_review")
    await sendLandlordOpsEmail(supabase, {
      landlordId: params.landlordId,
      subject: `${params.vendorName}: SUSPENSION REVIEW — low ratings (${ratings.avgRating.toFixed(1)})`,
      text:
        `${params.vendorName} still averages ${ratings.avgRating.toFixed(1)} stars after coaching ` +
        `(${ratings.reviewCount} ratings). Open a suspension review in the vendors dashboard.`,
      html:
        `<p><strong>${params.vendorName}</strong> still averages ` +
        `<strong>${ratings.avgRating.toFixed(1)}</strong> stars after coaching ` +
        `(${ratings.reviewCount} ratings).</p>` +
        `<p>Open a <strong>suspension review</strong> in the vendors dashboard.</p>`,
      logLabel: "vendor_performance_rating_suspension_review",
    })
    await notifyOpsSms(
      `Ulo ops: ${params.vendorName} — suspension review (avg ${ratings.avgRating.toFixed(1)} stars).`,
      params.landlordId,
      supabase,
    )
    await logGraphEvent(supabase, {
      landlord_id: params.landlordId,
      event_type: "vendor.performance_suspension_review",
      source: "automation",
      actor_type: "system",
      vendor_id: params.vendorId,
      metadata: {
        reason: "performance_low_rating",
        avg_rating: ratings.avgRating,
        review_count: ratings.reviewCount,
        summary: `${params.vendorName}: suspension review — persistent low ratings.`,
      },
    })
    summary.suspensionReviews += 1
  }

  const since30 = new Date(
    params.now.getTime() - NOSHOW_WARN_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString()
  const since60 = new Date(
    params.now.getTime() - NOSHOW_REVIEW_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString()
  const count30 = await countNoShowsSince(
    supabase,
    params.vendorId,
    params.landlordId,
    since30,
  )
  const count60 = await countNoShowsSince(
    supabase,
    params.vendorId,
    params.landlordId,
    since60,
  )
  const noshowEval = evaluateNoShowStandards({ count30, count60, notices })

  if (noshowEval.warning) {
    const body = buildNoShowWarningSms({
      vendorLabel: params.vendorName,
      companyName: params.companyName,
      count30,
    })
    const messageId = await sendVendorSms(supabase, {
      landlordId: params.landlordId,
      vendorId: params.vendorId,
      phone: params.phone,
      body,
      source: "vendor_performance_noshow_warning",
    })
    notices = { ...notices, noshow_warning: params.now.toISOString() }
    await sendLandlordOpsEmail(supabase, {
      landlordId: params.landlordId,
      subject: `${params.vendorName}: no-show warning (${count30} in ${NOSHOW_WARN_DAYS}d)`,
      text:
        `${params.vendorName} has ${count30} no-shows in the last ${NOSHOW_WARN_DAYS} days. ` +
        `A warning SMS was sent.`,
      html:
        `<p><strong>${params.vendorName}</strong> has <strong>${count30}</strong> no-shows ` +
        `in the last ${NOSHOW_WARN_DAYS} days.</p><p>A warning SMS was sent.</p>`,
      logLabel: "vendor_performance_noshow_warning",
    })
    await logGraphEvent(supabase, {
      landlord_id: params.landlordId,
      event_type: "vendor.performance_noshow_warning",
      source: "automation",
      actor_type: "system",
      vendor_id: params.vendorId,
      message_id: messageId,
      metadata: {
        count_30d: count30,
        summary: `${params.vendorName}: no-show warning (${count30} in ${NOSHOW_WARN_DAYS}d).`,
      },
    })
    summary.warnings += 1
  }

  if (noshowEval.suspensionReview) {
    notices = {
      ...notices,
      noshow_suspension_review: params.now.toISOString(),
    }
    review = escalateReview(review, "suspension_review")
    await sendLandlordOpsEmail(supabase, {
      landlordId: params.landlordId,
      subject: `${params.vendorName}: SUSPENSION REVIEW — no-shows (${count60} in ${NOSHOW_REVIEW_DAYS}d)`,
      text:
        `${params.vendorName} has ${count60} no-shows in the last ${NOSHOW_REVIEW_DAYS} days. ` +
        `Open a suspension review.`,
      html:
        `<p><strong>${params.vendorName}</strong> has <strong>${count60}</strong> no-shows ` +
        `in the last ${NOSHOW_REVIEW_DAYS} days.</p>` +
        `<p>Open a <strong>suspension review</strong>.</p>`,
      logLabel: "vendor_performance_noshow_suspension_review",
    })
    await notifyOpsSms(
      `Ulo ops: ${params.vendorName} — suspension review (${count60} no-shows / ${NOSHOW_REVIEW_DAYS}d).`,
      params.landlordId,
      supabase,
    )
    await logGraphEvent(supabase, {
      landlord_id: params.landlordId,
      event_type: "vendor.performance_suspension_review",
      source: "automation",
      actor_type: "system",
      vendor_id: params.vendorId,
      metadata: {
        reason: "performance_noshow",
        count_60d: count60,
        summary: `${params.vendorName}: suspension review — repeated no-shows.`,
      },
    })
    summary.suspensionReviews += 1
  }

  const acceptance = await loadAcceptanceStats(supabase, params.vendorId)
  const acceptEval = evaluateAcceptanceStandards({
    offered: acceptance.offered,
    accepted: acceptance.accepted,
    notices,
  })

  if (acceptEval.profileReview && acceptEval.rate != null) {
    const ratePct = Math.round(acceptEval.rate * 100)
    const body = buildAcceptanceProfileReviewSms({
      vendorLabel: params.vendorName,
      companyName: params.companyName,
      ratePct,
    })
    const messageId = await sendVendorSms(supabase, {
      landlordId: params.landlordId,
      vendorId: params.vendorId,
      phone: params.phone,
      body,
      source: "vendor_performance_acceptance_review",
    })
    notices = {
      ...notices,
      acceptance_profile_review: params.now.toISOString(),
    }
    review = escalateReview(review, "profile_review")
    await sendLandlordOpsEmail(supabase, {
      landlordId: params.landlordId,
      subject: `${params.vendorName}: profile review — ${ratePct}% acceptance`,
      text:
        `${params.vendorName} accepted ${acceptance.accepted} of ${acceptance.offered} jobs ` +
        `(${ratePct}%, below 40% over 20+ offers). Profile review recommended.`,
      html:
        `<p><strong>${params.vendorName}</strong> accepted ${acceptance.accepted} of ` +
        `${acceptance.offered} jobs (<strong>${ratePct}%</strong>, below 40% over 20+ offers).</p>` +
        `<p>Profile review recommended.</p>`,
      logLabel: "vendor_performance_acceptance",
    })
    await logGraphEvent(supabase, {
      landlord_id: params.landlordId,
      event_type: "vendor.performance_profile_review",
      source: "automation",
      actor_type: "system",
      vendor_id: params.vendorId,
      message_id: messageId,
      metadata: {
        acceptance_rate: acceptEval.rate,
        offered: acceptance.offered,
        accepted: acceptance.accepted,
        summary: `${params.vendorName}: profile review — ${ratePct}% acceptance.`,
      },
    })
    summary.profileReviews += 1
  }

  const reviewChanged = review !== params.currentReview
  const noticesChanged = JSON.stringify(notices) !== JSON.stringify(params.notices)
  if (reviewChanged || noticesChanged) {
    const ok = await updateVendorPerformance(supabase, {
      vendorId: params.vendorId,
      landlordId: params.landlordId,
      notices,
      review: reviewChanged
        ? (review as PerformanceReviewKind | null)
        : undefined,
    })
    if (!ok) summary.errors.push(`update failed for ${params.vendorId}`)
  }
}

/** Daily sweep: record no-shows, then evaluate performance thresholds. */
export async function checkVendorPerformanceStandards(
  supabase: SupabaseClient,
  landlordId: string | null,
): Promise<PerformanceSummary> {
  const summary: PerformanceSummary = {
    scanned: 0,
    noShowsRecorded: 0,
    coaching: 0,
    warnings: 0,
    profileReviews: 0,
    suspensionReviews: 0,
    errors: [],
  }

  const noshow = await recordLapsedNoShows(supabase, landlordId)
  summary.noShowsRecorded = noshow.recorded
  summary.errors.push(...noshow.errors)

  let query = supabase
    .from("vendors")
    .select(
      "id, landlord_id, name, phone, roster_status, roster_status_reason, " +
        "performance_notices, performance_review, active",
    )
    .limit(500)

  if (landlordId?.trim()) {
    query = query.eq("landlord_id", landlordId.trim())
  }

  const { data: vendors, error } = await query
  if (error) {
    summary.errors.push(error.message)
    return summary
  }

  const now = new Date()
  const companyCache = new Map<string, string | null>()

  for (const raw of vendors ?? []) {
    const vendor = raw as unknown as Record<string, unknown>
    const vendorId = typeof vendor.id === "string" ? vendor.id : ""
    const lid = typeof vendor.landlord_id === "string" ? vendor.landlord_id : ""
    if (!vendorId || !lid) continue

    const roster = (typeof vendor.roster_status === "string"
      ? vendor.roster_status
      : "").trim().toLowerCase()
    if (roster === "banned") continue
    // Already on a platform hold for misconduct/compliance — still allow soft metrics,
    // but skip if banned. Suspended vendors can still accumulate review flags.
    if (roster === "suspended") {
      const reason = (typeof vendor.roster_status_reason === "string"
        ? vendor.roster_status_reason
        : "").trim()
      if (PERFORMANCE_SUSPEND_REASONS.has(reason) || reason.includes("misconduct")) {
        // Still scan for ops visibility on new no-shows; metrics may escalate review.
      }
    }

    summary.scanned += 1
    if (!companyCache.has(lid)) {
      companyCache.set(lid, await loadLandlordDisplayName(supabase, lid))
    }

    await processVendorPerformance(
      supabase,
      {
        vendorId,
        landlordId: lid,
        vendorName:
          (typeof vendor.name === "string" && vendor.name.trim()) || "Vendor",
        phone: typeof vendor.phone === "string" ? vendor.phone : null,
        companyName: companyCache.get(lid) ?? null,
        notices: asNotices(vendor.performance_notices),
        currentReview: typeof vendor.performance_review === "string"
          ? vendor.performance_review
          : null,
        now,
      },
      summary,
    )
  }

  return summary
}

/**
 * Class A/B misconduct → immediate roster suspension (not capacity pause).
 */
export async function reportVendorMisconduct(
  supabase: SupabaseClient,
  params: {
    landlordId: string
    vendorId: string
    class: MisconductClass
    summary: string
    reportedBy?: string | null
    maintenanceRequestId?: string | null
  },
): Promise<{ ok: boolean; reportId?: string; error?: string }> {
  const cls = params.class === "A" || params.class === "B" ? params.class : null
  if (!cls) return { ok: false, error: "class must be A or B" }
  const summaryText = params.summary.trim()
  if (!summaryText) return { ok: false, error: "summary required" }

  const { data: vendor, error: vendorErr } = await supabase
    .from("vendors")
    .select("id, name, phone, roster_status")
    .eq("id", params.vendorId)
    .eq("landlord_id", params.landlordId)
    .maybeSingle()

  if (vendorErr || !vendor) {
    return { ok: false, error: vendorErr?.message ?? "vendor not found" }
  }

  if ((vendor.roster_status ?? "").toString().toLowerCase() === "banned") {
    return { ok: false, error: "vendor is banned" }
  }

  const { data: report, error: insertErr } = await supabase
    .from("vendor_misconduct_reports")
    .insert({
      landlord_id: params.landlordId,
      vendor_id: params.vendorId,
      class: cls,
      summary: summaryText,
      reported_by: params.reportedBy?.trim() || null,
      maintenance_request_id: params.maintenanceRequestId?.trim() || null,
    })
    .select("id")
    .maybeSingle()

  if (insertErr) {
    return { ok: false, error: insertErr.message }
  }

  const reason = cls === "A" ? "misconduct_class_a" : "misconduct_class_b"
  const { error: suspendErr } = await supabase
    .from("vendors")
    .update({
      roster_status: "suspended",
      roster_status_reason: reason,
      performance_review: "suspension_review",
    })
    .eq("id", params.vendorId)
    .eq("landlord_id", params.landlordId)

  if (suspendErr) {
    return { ok: false, error: suspendErr.message }
  }

  const vendorName =
    (typeof vendor.name === "string" && vendor.name.trim()) || "Vendor"
  const companyName = await loadLandlordDisplayName(supabase, params.landlordId)
  const phone = typeof vendor.phone === "string" ? vendor.phone : null

  const messageId = await sendVendorSms(supabase, {
    landlordId: params.landlordId,
    vendorId: params.vendorId,
    phone,
    body: buildMisconductSuspendedSms({
      vendorLabel: vendorName,
      companyName,
    }),
    source: "vendor_misconduct_suspended",
  })

  const classLabel = cls === "A"
    ? "Class A (physical safety)"
    : "Class B (theft/fraud)"

  await sendLandlordOpsEmail(supabase, {
    landlordId: params.landlordId,
    subject: `${vendorName}: IMMEDIATE SUSPENSION — ${classLabel}`,
    text:
      `${vendorName} was immediately suspended after a ${classLabel} report.\n\n` +
      `Summary: ${summaryText}\n\n` +
      (cls === "A"
        ? "Founder contact target: within 15 minutes during business hours."
        : "Human review target: within 1 hour.") +
      `\nReport safety@ulohome.com / law enforcement as needed.`,
    html:
      `<p><strong>${vendorName}</strong> was immediately suspended after a ` +
      `<strong>${classLabel}</strong> report.</p>` +
      `<p>${summaryText}</p>` +
      `<p>${
        cls === "A"
          ? "Founder contact target: within 15 minutes during business hours."
          : "Human review target: within 1 hour."
      }</p>`,
    logLabel: "vendor_misconduct_suspend",
  })

  await notifyOpsSms(
    `Ulo URGENT: ${vendorName} suspended — ${classLabel}. ${summaryText.slice(0, 120)}`,
    params.landlordId,
    supabase,
  )

  await logGraphEvent(supabase, {
    landlord_id: params.landlordId,
    event_type: "vendor.misconduct_suspended",
    source: "edge_function",
    actor_type: "system",
    vendor_id: params.vendorId,
    maintenance_request_id: params.maintenanceRequestId?.trim() || null,
    message_id: messageId,
    metadata: {
      class: cls,
      reason,
      report_id: report?.id ?? null,
      summary: `${vendorName} suspended — ${classLabel}: ${summaryText}`,
    },
  })

  return { ok: true, reportId: typeof report?.id === "string" ? report.id : undefined }
}

export function isPerformanceSuspendReason(reason: string | null | undefined): boolean {
  const r = (reason ?? "").trim()
  return PERFORMANCE_SUSPEND_REASONS.has(r)
}

export const __test = {
  RATING_MIN_JOBS,
  RATING_COACHING_MAX,
  RATING_SUSPEND_REVIEW_MAX,
  NOSHOW_WARN_COUNT,
  NOSHOW_WARN_DAYS,
  NOSHOW_REVIEW_COUNT,
  NOSHOW_REVIEW_DAYS,
  ACCEPTANCE_MIN_JOBS,
  ACCEPTANCE_MIN_RATE,
  NOSHOW_GRACE_MS,
  escalateReview,
  isPerformanceSuspendReason,
}
