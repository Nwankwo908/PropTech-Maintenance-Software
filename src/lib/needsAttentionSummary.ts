import { vendorDisplayName } from '@shared/activityFeed/feedFactSheet'
import { categoryLabelForSms } from '@shared/maintenance/categoryHandlingTips'
import { formatLocationWithOptionalUnit } from '@shared/properties/unitLabelDisplay'
import {
  rosterVendorTypePlural,
  staleVendorAttentionTitle,
} from '@/lib/maintenanceAdminVendor'

/** Words in a summary. Used to keep the attention column under about 20. */
export function attentionSummaryWordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length
}

export function attentionSummarySentenceCount(text: string): number {
  return text
    .trim()
    .split(/(?<=[.!?])\s+/)
    .filter(Boolean).length
}

/**
 * Landlord-facing trade for attention grey lines.
 * Never "Maintenance", "Other", or "General".
 */
export function namedTrade(issueCategory?: string | null): string | null {
  const label = categoryLabelForSms({ primaryCategory: issueCategory ?? null })
  if (!label || label === 'maintenance' || label === 'general' || label === 'other') {
    return null
  }
  if (label === 'HVAC') return 'HVAC'
  return label.charAt(0).toUpperCase() + label.slice(1)
}

/** Prefer the assigned vendor’s trade/category; else the ticket issue category. */
export function attentionTradeLabel(input: {
  vendorCategory?: string | null
  issueCategory?: string | null
}): string | null {
  return namedTrade(input.vendorCategory) ?? namedTrade(input.issueCategory)
}

/**
 * Grey line for vendor-related Needs Your Attention cards.
 * Property · unit · tenant · trade (trade omitted when unknown; SFH omits unit).
 */
export function formatVendorAttentionContextLabel(input: {
  propertyLabel?: string | null
  unitLabel?: string | null
  residentName?: string | null
  propertyType?: string | null
  trade?: string | null
}): string {
  const place = formatLocationWithOptionalUnit({
    propertyLabel: input.propertyLabel,
    unitLabel: input.unitLabel,
    propertyType: input.propertyType,
  })
  const resident = (input.residentName ?? '').trim()
  const parts = [place, resident].filter(Boolean)
  const base = parts.length ? parts.join(' · ') : '—'
  const trade = (input.trade ?? '').trim()
  if (!trade) return base
  if (base === '—') return trade
  return `${base} · ${trade}`
}

/** "3 days ago" → "for 3 days"; "yesterday" → "since yesterday". */
function waitPhrase(relative?: string | null): string | null {
  const value = (relative ?? '').trim()
  if (!value || value === 'just now') return null
  if (value === 'yesterday') return 'since yesterday'
  if (value.endsWith(' ago')) return `for ${value.slice(0, -' ago'.length)}`
  return `since ${value}`
}

export function leaseInfoAttentionSummary(): string {
  return 'Resident asked about their lease. No details on file; property team notified.'
}

export function smsDeliveryAttentionSummary(): string {
  return 'A text could not be sent. No phone number is on file; add one in Account settings.'
}

export function responseTimeNoVendorSummary(issueCategory?: string | null): string {
  const trade = namedTrade(issueCategory)
  const happened = trade
    ? `${trade} response time has passed.`
    : 'The response time has passed.'
  return `${happened} No vendor is available; assign one.`
}

export function rosterGapAttentionSummary(issueCategory?: string | null): string {
  const vendors = rosterVendorTypePlural(issueCategory)
  const happened = vendors
    ? `No ${vendors} on the roster can take this.`
    : 'No vendor on the roster can take this.'
  return `${happened} Assign one.`
}

export function vendorDeclinedAttentionSummary(vendorName?: string | null): string {
  const name = vendorDisplayName(vendorName)
  if (name) return `${name} declined. Find a replacement.`
  return 'The assigned vendor declined. Find a replacement.'
}

export function staleVendorAttentionSummary(vendorName?: string | null): string {
  const name = vendorDisplayName(vendorName)
  if (name) return `${name} never accepted. Choose a new vendor.`
  return 'The assigned vendor never accepted. Choose a new vendor.'
}

/** Shared copy for escalated-run and stale-ticket Vendor unresponsive cards. */
export function buildStaleVendorAttentionCard(input: {
  vendorName?: string | null
  propertyLabel?: string | null
  unitLabel?: string | null
  residentName?: string | null
  propertyType?: string | null
  vendorCategory?: string | null
  issueCategory?: string | null
}): { title: string; meta: string; context: string } {
  return {
    title: staleVendorAttentionTitle(input.vendorName),
    meta: staleVendorAttentionSummary(input.vendorName),
    context: formatVendorAttentionContextLabel({
      propertyLabel: input.propertyLabel,
      unitLabel: input.unitLabel,
      residentName: input.residentName,
      propertyType: input.propertyType,
      trade: attentionTradeLabel({
        vendorCategory: input.vendorCategory,
        issueCategory: input.issueCategory,
      }),
    }),
  }
}

export function leaseRenewalAttentionSummary(relative?: string | null): string {
  const wait = waitPhrase(relative)
  if (wait) return `No reply ${wait}. Review the renewal.`
  return 'This renewal needs a decision. Review it.'
}

export function waitingAttentionSummary(relative?: string | null): string {
  const wait = waitPhrase(relative)
  if (wait) return `This has waited ${wait}. Review it.`
  return 'This needs a decision. Review it.'
}

export function lateRentAttentionSummary(sinceLabel?: string | null): string {
  const since = (sinceLabel ?? '').trim()
  if (since) return `Rent has been overdue since ${since}. Review the account.`
  return 'Rent is overdue. Review the account.'
}

export function invoiceAttentionSummary(input: {
  vendorName: string
  amountLabel: string
}): string {
  const vendor = input.vendorName.trim() || 'The vendor'
  return `${vendor} submitted a ${input.amountLabel} invoice. Review and approve the cost.`
}

export function inspectionItemAttentionSummary(input: {
  itemLabel: string
  itemIndex: number
  itemTotal: number
}): string {
  const label = input.itemLabel.trim()
  const place = `Item ${input.itemIndex} of ${input.itemTotal} on the inspection`
  if (!label) return `${place} needs a review.`
  return `${place}: ${label}. Review it.`
}
