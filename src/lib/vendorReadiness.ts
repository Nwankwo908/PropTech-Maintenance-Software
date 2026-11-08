/**
 * Display-only regrouping of the vendor profile verification checklist.
 * Does not change how verification is computed, stored, or requested.
 */

import { formatVendorTradeLabel } from '@/lib/vendorTrades'
import type {
  VerificationChecklist,
  VerificationChecklistItem,
  VerificationItemId,
  VerificationItemStatus,
  VerificationRecord,
} from '@/lib/vendorVerificationChecklist'
import {
  isVendorVerificationRequestItemId,
  type VendorVerificationRequestItemId,
} from '@shared/sms/vendorInsuranceRequestSms'

export type VendorReadinessGroupId = 'licensing' | 'payment' | 'work_profile'

export type VendorReadinessDisplayItem = {
  id: VerificationItemId
  label: string
  status: VerificationItemStatus
  /** Chip label — Verified / Expired / Action needed / Not collected / Pending. */
  statusLabel: string
  /** Underneath helper / value line; null when nothing useful to show. */
  detail: string | null
  /** True only for recommended/missing items that are still optional. */
  showOptional: boolean
  requestItemId: VendorVerificationRequestItemId | null
}

export type VendorReadinessGroup = {
  id: VendorReadinessGroupId
  title: string
  question: string
  completeCount: number
  totalCount: number
  needsAction: boolean
  items: VendorReadinessDisplayItem[]
}

export type VendorReadinessView = {
  groups: VendorReadinessGroup[]
  completeCount: number
  totalCount: number
  pct: number
}

const GROUP_ORDER: Array<{
  id: VendorReadinessGroupId
  title: string
  question: string
  itemIds: VerificationItemId[]
}> = [
  {
    id: 'licensing',
    title: 'Licensing & insurance',
    question: 'Can they legally do the work?',
    itemIds: ['license', 'coi_coverage'],
  },
  {
    id: 'payment',
    title: 'Payment & tax',
    question: 'Can you pay them?',
    itemIds: ['w9', 'stripe_connect'],
  },
  {
    id: 'work_profile',
    title: 'Work profile',
    question: 'What jobs should they get?',
    itemIds: ['trade_categories', 'service_area', 'availability'],
  },
]

const DISPLAY_LABELS: Partial<Record<VerificationItemId, string>> = {
  license: 'State license',
  coi_coverage: 'General liability insurance (recommended $500K)',
  w9: 'W-9 on file',
  stripe_connect: 'Payout account',
  trade_categories: 'Trade categories',
  service_area: 'Service area',
  availability: 'Availability',
}

/** Items that may show Optional when still missing (recommended, not blocking). */
const OPTIONAL_WHEN_MISSING = new Set<VerificationItemId>(['license', 'coi_coverage'])

export type BuildVendorReadinessOptions = {
  verification?: VerificationRecord | null
  tradeLabels?: string[]
  serviceAreaSummary?: string | null
}

function tradeLabelsFromVerification(verification?: VerificationRecord | null): string[] {
  const slugs = (verification?.trade_categories ?? []).filter(
    (t): t is string => typeof t === 'string' && t.trim().length > 0,
  )
  return slugs.map((slug) => formatVendorTradeLabel(slug))
}

function availabilityDetail(item: VerificationChecklistItem): string {
  const paused = /paused/i.test(item.detail)
  return paused ? 'Not accepting work' : 'Accepting work'
}

function isExpiredAction(item: VerificationChecklistItem): boolean {
  return item.status === 'action_needed' && /expir/i.test(item.detail)
}

function statusLabelFor(item: VerificationChecklistItem): string {
  if (isExpiredAction(item)) return 'Expired'
  switch (item.status) {
    case 'complete':
      return 'Verified'
    case 'action_needed':
      return 'Action needed'
    case 'pending':
      return 'Pending'
    default:
      return 'Not collected'
  }
}

function displayDetail(
  item: VerificationChecklistItem,
  options: BuildVendorReadinessOptions,
): string | null {
  const emptyNoise =
    /not required to (?:verify|confirm details)/i.test(item.detail) ||
    /^recommended \$500k minimum gl$/i.test(item.detail.trim())

  if (item.id === 'w9' && item.status === 'missing') {
    return 'Needed before year-end tax forms'
  }
  if (item.id === 'stripe_connect' && item.status === 'missing') {
    return 'Needed to pay this vendor through Ulo'
  }
  if (item.id === 'trade_categories' && item.status === 'complete') {
    const labels =
      options.tradeLabels && options.tradeLabels.length > 0
        ? options.tradeLabels
        : tradeLabelsFromVerification(options.verification)
    if (labels.length === 0) {
      return item.detail.trim() || null
    }
    const countLabel = `${labels.length} trade${labels.length === 1 ? '' : 's'}`
    return `${countLabel} · ${labels.join(', ')}`
  }
  if (item.id === 'service_area' && item.status === 'complete') {
    const summary = options.serviceAreaSummary?.trim()
    return summary || 'Set'
  }
  if (item.id === 'availability') {
    return availabilityDetail(item)
  }
  if (item.id === 'coi_coverage' && item.status === 'missing') {
    return null
  }
  if (item.id === 'license' && item.status === 'missing') {
    return null
  }
  if (emptyNoise) return null
  const trimmed = item.detail.trim()
  return trimmed || null
}

function showOptionalFor(item: VerificationChecklistItem): boolean {
  if (item.status === 'action_needed' || item.status === 'pending' || item.status === 'complete') {
    return false
  }
  if (isExpiredAction(item)) return false
  return OPTIONAL_WHEN_MISSING.has(item.id) && item.status === 'missing'
}

function toDisplayItem(
  item: VerificationChecklistItem,
  options: BuildVendorReadinessOptions,
): VendorReadinessDisplayItem {
  const requestItemId = isVendorVerificationRequestItemId(item.id) ? item.id : null
  return {
    id: item.id,
    label: DISPLAY_LABELS[item.id] ?? item.label,
    status: item.status,
    statusLabel: statusLabelFor(item),
    detail: displayDetail(item, options),
    showOptional: showOptionalFor(item),
    requestItemId,
  }
}

export function buildVendorReadinessGroups(
  checklist: VerificationChecklist,
  options: BuildVendorReadinessOptions = {},
): VendorReadinessGroup[] {
  const byId = new Map(checklist.items.map((item) => [item.id, item]))

  const groups: VendorReadinessGroup[] = GROUP_ORDER.map((def) => {
    const rawItems = def.itemIds
      .map((id) => byId.get(id))
      .filter((item): item is VerificationChecklistItem => Boolean(item))
    const items = rawItems.map((item) => toDisplayItem(item, options))
    const completeCount = items.filter((item) => item.status === 'complete').length
    const needsAction = items.some(
      (item) => item.status === 'action_needed' || item.statusLabel === 'Expired',
    )
    return {
      id: def.id,
      title: def.title,
      question: def.question,
      completeCount,
      totalCount: items.length,
      needsAction,
      items,
    }
  }).filter((group) => group.totalCount > 0)

  return [...groups].sort((a, b) => {
    if (a.needsAction === b.needsAction) {
      return (
        GROUP_ORDER.findIndex((g) => g.id === a.id) - GROUP_ORDER.findIndex((g) => g.id === b.id)
      )
    }
    return a.needsAction ? -1 : 1
  })
}

export function buildVendorReadinessView(
  checklist: VerificationChecklist,
  options: BuildVendorReadinessOptions = {},
): VendorReadinessView {
  const groups = buildVendorReadinessGroups(checklist, options)
  const completeCount = groups.reduce((sum, group) => sum + group.completeCount, 0)
  const totalCount = groups.reduce((sum, group) => sum + group.totalCount, 0)
  const pct = totalCount > 0 ? Math.min(100, Math.round((completeCount / totalCount) * 100)) : 0
  return { groups, completeCount, totalCount, pct }
}
