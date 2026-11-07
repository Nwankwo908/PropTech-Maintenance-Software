/**
 * Landlord-only “Needs your attention” feed for a vendor profile.
 * Includes compliance, blocked estimates, exhausted follow-ups, no-shows,
 * and completed→open reopens (not cancelled→open). Excludes normal jobs
 * and mid-follow-up soft nudges.
 *
 * Every row title goes through `attentionTitle` so copy stays landlord-friendly
 * (Compliance checklist labels can stay more formal).
 */
import { formatWorkOrderRefFromTicketId } from '@/lib/vendorCallFlow'
import { isNeedsAdminVendorStickyOutcome } from '@/lib/maintenanceAdminVendor'
import {
  vendorComplianceActionNeededItems,
  type VerificationChecklist,
  type VerificationChecklistItem,
  type VerificationRecord,
} from '@/lib/vendorVerificationChecklist'

export const VENDOR_ATTENTION_REOPEN_WINDOW_MS = 30 * 24 * 60 * 60 * 1000
export const VENDOR_ATTENTION_COMPLIANCE_SOON_DAYS = 30

const CLOSED_WORK_STATUSES = new Set(['completed', 'cancelled', 'declined'])

export type VendorAttentionKind =
  | 'compliance_high'
  | 'compliance_soon'
  | 'compliance'
  | 'estimate'
  | 'exhausted'
  | 'no_show'
  | 'reopen'

export type VendorAttentionItem = {
  id: string
  kind: VendorAttentionKind
  /** Lower sorts first. */
  sortRank: number
  title: string
  detail: string
  badgeLabel: string
  actionLabel: string
  workOrderRef?: string
  ticketId?: string
  href?: string
  scrollToCompliance?: boolean
}

export type VendorAttentionTicket = {
  id: string
  vendorWorkStatus?: string | null
  autoReassignLastOutcome?: string | null
  scheduledAt?: string | null
  stallFollowUpSentAt?: string | null
  stallFollowUpKind?: string | null
}

export type VendorAttentionEstimate = {
  id: string
  maintenanceRequestId: string
  status?: string | null
  totalAmount?: number | null
}

export type VendorAttentionNoShow = {
  id: string
  maintenanceRequestId: string
  recordedAt: string
}

export type VendorAttentionReopen = {
  id: string
  maintenanceRequestId: string
  reopenedAt: string
  previousStatus: string
  newStatus: string
}

type AttentionTitleInput =
  | { kind: 'compliance'; checklistId: VerificationChecklistItem['id'] | 'unverified' }
  | { kind: 'compliance_soon'; which: 'license' | 'coi'; when: string | null }
  | { kind: 'estimate'; workOrderRef: string; amountLabel: string | null }
  | { kind: 'exhausted'; workOrderRef: string; pendingAccept: boolean }
  | { kind: 'no_show'; workOrderRef: string }
  | { kind: 'reopen'; workOrderRef: string }

/** Landlord-facing attention titles for every Needs your attention row. */
export function attentionTitle(input: AttentionTitleInput): string {
  switch (input.kind) {
    case 'compliance':
      switch (input.checklistId) {
        case 'coi_coverage':
          return 'I recommend requesting general liability insurance'
        case 'license':
          return 'I recommend requesting an updated state license'
        case 'w9':
          return 'I recommend finishing the W-9 details'
        case 'stripe_connect':
          return 'I recommend setting up the payout account'
        case 'trade_categories':
          return 'I recommend confirming which trades this vendor covers'
        case 'service_area':
          return 'I recommend confirming this vendor’s service area'
        case 'availability':
          return 'I recommend reviewing this vendor’s availability'
        case 'unverified':
          return 'I recommend finishing vendor verification'
        default:
          return 'I recommend reviewing this vendor’s compliance details'
      }
    case 'compliance_soon':
      if (input.which === 'license') {
        return input.when
          ? `I recommend renewing the license before ${input.when}`
          : 'I recommend renewing the license soon'
      }
      return input.when
        ? `I recommend renewing insurance before ${input.when}`
        : 'I recommend renewing insurance soon'
    case 'estimate':
      return input.amountLabel
        ? `I recommend approving the ${input.amountLabel} estimate for ${input.workOrderRef}`
        : `I recommend reviewing the estimate for ${input.workOrderRef}`
    case 'exhausted':
      return input.pendingAccept
        ? `I recommend reassigning ${input.workOrderRef} — the vendor hasn’t responded`
        : `I recommend deciding next steps for ${input.workOrderRef}`
    case 'no_show':
      return `I recommend following up on ${input.workOrderRef} — the vendor missed the visit`
    case 'reopen':
      return `I recommend following up on ${input.workOrderRef} — the issue came back after completion`
  }
}

export function isOpenVendorWorkStatus(status: string | null | undefined): boolean {
  const value = (status ?? '').trim().toLowerCase()
  if (!value) return false
  return !CLOSED_WORK_STATUSES.has(value)
}

/** Attention reopens: completed → open only (cancelled → open is audited but hidden). */
export function isAttentionReopenPreviousStatus(
  previousStatus: string | null | undefined,
): boolean {
  return (previousStatus ?? '').trim().toLowerCase() === 'completed'
}

export function daysUntilIsoDate(
  isoDate: string | null | undefined,
  nowMs: number = Date.now(),
): number | null {
  const raw = (isoDate ?? '').trim()
  if (!raw) return null
  const day = raw.slice(0, 10)
  const ms = Date.parse(`${day}T00:00:00.000Z`)
  if (!Number.isFinite(ms)) return null
  const nowDay = new Date(nowMs).toISOString().slice(0, 10)
  const nowDayMs = Date.parse(`${nowDay}T00:00:00.000Z`)
  return Math.round((ms - nowDayMs) / (24 * 60 * 60 * 1000))
}

function formatMoney(amount: number | null | undefined): string | null {
  if (amount == null || !Number.isFinite(amount)) return null
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: amount >= 100 ? 0 : 2,
  }).format(amount)
}

function formatShortDate(iso: string | null | undefined): string | null {
  const raw = (iso ?? '').trim()
  if (!raw) return null
  const date = new Date(raw.length <= 10 ? `${raw}T00:00:00` : raw)
  if (Number.isNaN(date.getTime())) return null
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function workOrderHref(ticketId: string): string {
  return `/admin/requests?request=${encodeURIComponent(ticketId)}`
}

function ticketStatusById(
  tickets: VendorAttentionTicket[],
): Map<string, string | null | undefined> {
  return new Map(tickets.map((row) => [row.id, row.vendorWorkStatus]))
}

export function vendorHasActiveAssignedJobs(tickets: VendorAttentionTicket[]): boolean {
  return tickets.some((ticket) => isOpenVendorWorkStatus(ticket.vendorWorkStatus))
}

export function buildVendorProfileAttention(input: {
  checklist?: VerificationChecklist | null
  verification?: VerificationRecord | null
  onboardingOverriddenAt?: string | null
  tickets?: VendorAttentionTicket[]
  estimates?: VendorAttentionEstimate[]
  noShows?: VendorAttentionNoShow[]
  reopens?: VendorAttentionReopen[]
  nowMs?: number
}): VendorAttentionItem[] {
  const nowMs = input.nowMs ?? Date.now()
  const tickets = input.tickets ?? []
  const statusByTicket = ticketStatusById(tickets)
  const hasActiveJobs = vendorHasActiveAssignedJobs(tickets)
  const items: VendorAttentionItem[] = []

  const actionNeeded = vendorComplianceActionNeededItems(input.checklist)
  for (const row of actionNeeded) {
    const high = hasActiveJobs
    items.push({
      id: `compliance:${row.id}`,
      kind: high ? 'compliance_high' : 'compliance',
      sortRank: high ? 10 : 40,
      title: attentionTitle({ kind: 'compliance', checklistId: row.id }),
      detail: row.detail,
      badgeLabel: high ? 'HIGH' : 'Action needed',
      actionLabel: 'Review',
      scrollToCompliance: true,
    })
  }

  const verification = input.verification
  const verified =
    (verification?.status ?? '').trim().toLowerCase() === 'verified' ||
    Boolean((input.onboardingOverriddenAt ?? '').trim())
  if (verification && !verified && hasActiveJobs) {
    const already = items.some((item) => item.id.startsWith('compliance:'))
    if (!already) {
      items.push({
        id: 'compliance:unverified',
        kind: 'compliance_high',
        sortRank: 10,
        title: attentionTitle({ kind: 'compliance', checklistId: 'unverified' }),
        detail: 'This vendor still has open work orders and is not fully verified.',
        badgeLabel: 'HIGH',
        actionLabel: 'Review',
        scrollToCompliance: true,
      })
    }
  }

  if (verification) {
    const licenseDays = daysUntilIsoDate(verification.license_expiration, nowMs)
    if (
      licenseDays != null &&
      licenseDays >= 0 &&
      licenseDays <= VENDOR_ATTENTION_COMPLIANCE_SOON_DAYS
    ) {
      const when = formatShortDate(verification.license_expiration)
      items.push({
        id: 'compliance_soon:license',
        kind: 'compliance_soon',
        sortRank: 50,
        title: attentionTitle({ kind: 'compliance_soon', which: 'license', when }),
        detail: 'Renew before the license expires so this vendor can keep taking jobs.',
        badgeLabel: 'Action needed',
        actionLabel: 'Review',
        scrollToCompliance: true,
      })
    }
    const coiDays = daysUntilIsoDate(verification.coi_expiration, nowMs)
    if (coiDays != null && coiDays >= 0 && coiDays <= VENDOR_ATTENTION_COMPLIANCE_SOON_DAYS) {
      const when = formatShortDate(verification.coi_expiration)
      items.push({
        id: 'compliance_soon:coi',
        kind: 'compliance_soon',
        sortRank: 50,
        title: attentionTitle({ kind: 'compliance_soon', which: 'coi', when }),
        detail: 'Ask the vendor to upload a renewed certificate of insurance.',
        badgeLabel: 'Action needed',
        actionLabel: 'Review',
        scrollToCompliance: true,
      })
    }
  }

  for (const estimate of input.estimates ?? []) {
    const status = (estimate.status ?? '').trim().toLowerCase()
    if (status !== 'pending_approval') continue
    const ticketId = estimate.maintenanceRequestId.trim()
    if (!ticketId) continue
    if (!isOpenVendorWorkStatus(statusByTicket.get(ticketId))) continue
    const ref = formatWorkOrderRefFromTicketId(ticketId)
    const money = formatMoney(estimate.totalAmount)
    items.push({
      id: `estimate:${estimate.id}`,
      kind: 'estimate',
      sortRank: 20,
      title: attentionTitle({
        kind: 'estimate',
        workOrderRef: ref,
        amountLabel: money,
      }),
      detail: 'The vendor is waiting on your approval before they can continue.',
      badgeLabel: 'Action needed',
      actionLabel: 'Review',
      workOrderRef: ref,
      ticketId,
      href: workOrderHref(ticketId),
    })
  }

  for (const ticket of tickets) {
    if (!isOpenVendorWorkStatus(ticket.vendorWorkStatus)) continue
    if (!isNeedsAdminVendorStickyOutcome(ticket.autoReassignLastOutcome)) continue
    const ref = formatWorkOrderRefFromTicketId(ticket.id)
    const pending =
      (ticket.vendorWorkStatus ?? '').trim().toLowerCase() === 'pending_accept'
    items.push({
      id: `exhausted:${ticket.id}`,
      kind: 'exhausted',
      sortRank: 30,
      title: attentionTitle({
        kind: 'exhausted',
        workOrderRef: ref,
        pendingAccept: pending,
      }),
      detail: pending
        ? 'Follow-ups are exhausted. Pick another vendor or reach out directly.'
        : 'Automation handed this job to you after follow-ups ran out.',
      badgeLabel: 'Action needed',
      actionLabel: 'Open',
      workOrderRef: ref,
      ticketId: ticket.id,
      href: workOrderHref(ticket.id),
    })
  }

  for (const noShow of input.noShows ?? []) {
    const ticketId = noShow.maintenanceRequestId.trim()
    if (!ticketId) continue
    const recordedMs = Date.parse(noShow.recordedAt)
    if (!Number.isFinite(recordedMs) || nowMs - recordedMs > VENDOR_ATTENTION_REOPEN_WINDOW_MS) {
      continue
    }
    if (!isOpenVendorWorkStatus(statusByTicket.get(ticketId))) continue
    const ref = formatWorkOrderRefFromTicketId(ticketId)
    items.push({
      id: `no_show:${noShow.id}`,
      kind: 'no_show',
      sortRank: 35,
      title: attentionTitle({ kind: 'no_show', workOrderRef: ref }),
      detail: 'A confirmed appointment passed with no progress from this vendor.',
      badgeLabel: 'Action needed',
      actionLabel: 'Open',
      workOrderRef: ref,
      ticketId,
      href: workOrderHref(ticketId),
    })
  }

  for (const reopen of input.reopens ?? []) {
    if (!isAttentionReopenPreviousStatus(reopen.previousStatus)) continue
    const ticketId = reopen.maintenanceRequestId.trim()
    if (!ticketId) continue
    const reopenedMs = Date.parse(reopen.reopenedAt)
    if (!Number.isFinite(reopenedMs) || nowMs - reopenedMs > VENDOR_ATTENTION_REOPEN_WINDOW_MS) {
      continue
    }
    if (!isOpenVendorWorkStatus(statusByTicket.get(ticketId))) continue
    const ref = formatWorkOrderRefFromTicketId(ticketId)
    items.push({
      id: `reopen:${reopen.id}`,
      kind: 'reopen',
      sortRank: 35,
      title: attentionTitle({ kind: 'reopen', workOrderRef: ref }),
      detail: 'The resident said the repair still isn’t fixed. Follow up on this job.',
      badgeLabel: 'Action needed',
      actionLabel: 'Open',
      workOrderRef: ref,
      ticketId,
      href: workOrderHref(ticketId),
    })
  }

  return items.sort((left, right) => {
    if (left.sortRank !== right.sortRank) return left.sortRank - right.sortRank
    return left.title.localeCompare(right.title)
  })
}
