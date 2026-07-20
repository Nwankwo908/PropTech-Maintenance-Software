import { formatVendorTradeLabel, normalizeVendorTrade } from '@/lib/vendorTrades'
import {
  computeVerificationChecklist,
  type VerificationRecord,
  type VerificationServiceArea,
} from '@/lib/vendorVerificationChecklist'
import { resolveVendorCapacityChip } from '@/lib/vendorStatusChip'

/**
 * Vendor compliance profile for the vendor detail KPI + cards.
 *
 * When a linked `vendor_verifications` row exists, document counts and
 * capacity come from that checklist. Without verification, docs stay empty
 * ("not collected yet") and capacity stays Pending.
 */

export type VendorComplianceItem = {
  id: string
  label: string
  /** True only when a real document/record has been retrieved and stored. */
  collected: boolean
  /** Populated headline/detail when collected; null while empty. */
  headline: string | null
  detail: string | null
  meta?: string | null
  /** Shown when nothing has been collected yet. */
  emptyHint: string
}

export type VendorServiceArea = {
  set: boolean
  primaryMetro: string | null
  radiusMiles: number | null
  zipCodes: string[]
  emptyHint: string
}

export type VendorCapacity = {
  status: 'active' | 'paused' | 'pending'
  label: string
  detail: string
}

export type VendorTradeCategories = {
  set: boolean
  primaryLabel: string | null
  labels: string[]
  emptyHint: string
}

export type VendorComplianceProfile = {
  documents: VendorComplianceItem[]
  stateLicense: VendorComplianceItem
  generalLiabilityCoi: VendorComplianceItem
  backgroundCheck: VendorComplianceItem
  w9: VendorComplianceItem
  tradeCategories: VendorTradeCategories
  serviceArea: VendorServiceArea
  capacity: VendorCapacity
  collectedCount: number
  totalRequirements: number
}

export type VendorComplianceSubject = {
  id?: string | null
  name: string
  phone?: string | null
  category?: string | null
  active?: boolean | null
}

/** Empty compliance requirement — nothing retrieved during onboarding. */
function emptyDocument(id: string, label: string, emptyHint: string): VendorComplianceItem {
  return {
    id,
    label,
    collected: false,
    headline: null,
    detail: null,
    meta: null,
    emptyHint,
  }
}

function documentFromChecklist(
  empty: VendorComplianceItem,
  checklistItem: { status: string; detail: string; label: string } | undefined,
  headlineWhenComplete: string,
): VendorComplianceItem {
  if (!checklistItem) return empty
  if (checklistItem.status === 'complete') {
    return {
      ...empty,
      collected: true,
      headline: headlineWhenComplete,
      detail: checklistItem.detail,
      emptyHint: '',
    }
  }
  if (checklistItem.status === 'action_needed' || checklistItem.status === 'pending') {
    return {
      ...empty,
      collected: false,
      headline: null,
      detail: checklistItem.detail,
      emptyHint: checklistItem.detail || empty.emptyHint,
    }
  }
  return empty
}

function buildTradeCategories(
  subject: VendorComplianceSubject,
  verification?: VerificationRecord | null,
): VendorTradeCategories {
  const tradeSlugs = (verification?.trade_categories ?? []).filter(
    (t): t is string => typeof t === 'string' && t.trim().length > 0,
  )
  if (tradeSlugs.length > 0) {
    const labels = tradeSlugs.map((slug) => formatVendorTradeLabel(slug))
    return {
      set: true,
      primaryLabel: labels[0] ?? null,
      labels,
      emptyHint: '',
    }
  }

  const hasCategory = !!subject.category?.trim()
  if (!hasCategory) {
    return {
      set: false,
      primaryLabel: null,
      labels: [],
      emptyHint: 'No trade category set for this vendor yet.',
    }
  }

  const primaryLabel = formatVendorTradeLabel(subject.category)
  const slug = normalizeVendorTrade(subject.category, { fallbackOther: true })
  const labels: string[] = [primaryLabel]
  if (slug === 'general') {
    for (const extra of ['Carpentry', 'Painting', 'Flooring']) {
      if (!labels.includes(extra)) labels.push(extra)
    }
  }

  return { set: true, primaryLabel, labels, emptyHint: '' }
}

function buildServiceArea(verification?: VerificationRecord | null): VendorServiceArea {
  const area = (verification?.service_area ?? {}) as VerificationServiceArea
  const zips = Array.isArray(area.zips) ? area.zips.filter(Boolean) : []
  const cities = Array.isArray(area.cities) ? area.cities.filter(Boolean) : []
  const radiusMiles =
    typeof area.radiusMiles === 'number' && Number.isFinite(area.radiusMiles)
      ? area.radiusMiles
      : null

  if (zips.length === 0 && cities.length === 0 && radiusMiles == null) {
    return {
      set: false,
      primaryMetro: null,
      radiusMiles: null,
      zipCodes: [],
      emptyHint: 'No service area set yet — add coverage to route nearby work.',
    }
  }

  const primaryMetro = cities[0] ?? (zips.length ? `ZIPs: ${zips.slice(0, 3).join(', ')}` : null)
  return {
    set: true,
    primaryMetro: primaryMetro ?? 'Service area on file',
    radiusMiles,
    zipCodes: zips,
    emptyHint: '',
  }
}

function buildCapacity(
  subject: VendorComplianceSubject,
  verification?: VerificationRecord | null,
): VendorCapacity {
  const chip = resolveVendorCapacityChip({
    verificationStatus: verification?.status,
    vendorActive: verification?.availability === 'paused' ? false : subject.active !== false,
  })
  return {
    status: chip.status,
    label: chip.label,
    detail:
      chip.status === 'active'
        ? 'Available to receive new work orders.'
        : chip.status === 'paused'
          ? 'Not accepting new work orders — kept as backup.'
          : 'Verification pending — vendor completes onboarding before going active.',
  }
}

export function buildVendorComplianceProfile(
  subject: VendorComplianceSubject,
  verification?: VerificationRecord | null,
): VendorComplianceProfile {
  const emptyLicense = emptyDocument(
    'state_license',
    'State license',
    'Not collected yet — Ulo will verify against the state licensing board.',
  )
  const emptyCoi = emptyDocument(
    'gl_coi',
    'General liability COI',
    'Not collected yet — request a certificate of insurance from the vendor.',
  )
  const emptyBackground = emptyDocument(
    'background_check',
    'Background check',
    'Not run yet — order a Checkr screening before assigning work.',
  )
  const emptyW9 = emptyDocument(
    'w9',
    'W-9 on file',
    'Not collected yet — request a W-9 for 1099 tax reporting.',
  )

  let stateLicense = emptyLicense
  let generalLiabilityCoi = emptyCoi
  let backgroundCheck = emptyBackground
  let w9 = emptyW9

  if (verification) {
    const checklist = computeVerificationChecklist(verification)
    const byId = new Map(checklist.items.map((item) => [item.id, item]))

    stateLicense = documentFromChecklist(emptyLicense, byId.get('license'), 'State license on file')
    generalLiabilityCoi = documentFromChecklist(
      emptyCoi,
      byId.get('coi_coverage'),
      'General liability COI on file',
    )
    backgroundCheck = documentFromChecklist(
      emptyBackground,
      byId.get('background_check'),
      'Background check on file',
    )
    w9 = documentFromChecklist(emptyW9, byId.get('w9'), 'W-9 on file')
  }

  const documents = [stateLicense, generalLiabilityCoi, backgroundCheck, w9]
  const collectedCount = documents.filter((item) => item.collected).length

  return {
    documents,
    stateLicense,
    generalLiabilityCoi,
    backgroundCheck,
    w9,
    tradeCategories: buildTradeCategories(subject, verification),
    serviceArea: buildServiceArea(verification),
    capacity: buildCapacity(subject, verification),
    collectedCount,
    totalRequirements: documents.length,
  }
}
