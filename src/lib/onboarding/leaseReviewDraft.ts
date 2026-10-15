import type { LeaseFieldEvidence, LeaseFieldName, LeaseScanReview } from '@shared/onboarding/leaseScan'
import { formatMoney } from '@shared/onboarding/typedDocumentExtract/parse'
import { placePropertyAddressFields } from '@shared/onboarding/typedDocumentExtract/placeFields'
import type {
  ExtractedLeaseInfo,
  OnboardingExtractedProperty,
  OnboardingExtractedResident,
  OnboardingExtractedUnit,
  OnboardingExtractionReview,
} from '@/lib/onboardingDocumentUpload'

/** How a lease reading is shown on the human-review draft. */
export type ReviewFieldAttention = 'verified' | 'needs_verification' | 'required'

export type ReviewFieldAttentionMap = Partial<Record<string, ReviewFieldAttention>>

const REQUIRED_LEASE_FIELDS = new Set<LeaseFieldName>([
  'tenant_names',
  'property_address',
  'lease_start',
  'monthly_rent',
])

export function reviewFieldStateLabel(state?: ReviewFieldAttention): string | null {
  if (state === 'verified') return 'Verified'
  if (state === 'needs_verification') return 'Needs verification'
  if (state === 'required') return 'Required'
  return null
}

export function reviewRowNeedsAttention(attention?: ReviewFieldAttentionMap): boolean {
  return Object.values(attention ?? {}).some(
    (state) => state === 'needs_verification' || state === 'required',
  )
}

/** A required blank is not ready to become a permanent portfolio row. */
export function draftBlocksPermanentWrite(attention?: ReviewFieldAttentionMap): boolean {
  return Object.values(attention ?? {}).includes('required')
}

/** Continue stays on Review while a required lease field is still blank. */
export function leaseDraftRequiredBlankMessage(review: {
  properties: Array<{ fieldAttention?: ReviewFieldAttentionMap }>
  residents: Array<{ fieldAttention?: ReviewFieldAttentionMap }>
  leases: Array<{ fieldAttention?: ReviewFieldAttentionMap }>
}): string | null {
  const blocked = [...review.properties, ...review.residents, ...review.leases].some((row) =>
    draftBlocksPermanentWrite(row.fieldAttention),
  )
  if (!blocked) return null
  return 'Enter the lease details marked Required before continuing.'
}

function usableFieldValue(field: LeaseFieldEvidence | undefined): string {
  const value = field?.value
  if (Array.isArray(value)) return value.map((item) => item.trim()).filter(Boolean).join(', ')
  if (typeof value === 'number' && Number.isFinite(value)) return formatMoney(value)
  if (typeof value === 'string') return value.trim()
  return ''
}

function fieldAttention(
  field: LeaseFieldEvidence | undefined,
  name: LeaseFieldName,
): { value: string; attention: ReviewFieldAttention | null } {
  const value = usableFieldValue(field)
  if (value && field?.status === 'found' && !field.needsReview) {
    return { value, attention: 'verified' }
  }
  if (value) return { value, attention: 'needs_verification' }
  if (REQUIRED_LEASE_FIELDS.has(name)) return { value: '', attention: 'required' }
  return { value: '', attention: null }
}

function put(
  map: ReviewFieldAttentionMap,
  key: string,
  attention: ReviewFieldAttention | null,
) {
  if (attention) map[key] = attention
}

export type LeaseReviewDraftRows = {
  properties: OnboardingExtractedProperty[]
  units: OnboardingExtractedUnit[]
  residents: OnboardingExtractedResident[]
  leases: ExtractedLeaseInfo[]
}

/**
 * Best-effort review rows from a lease scan. Usable values are kept even when
 * source verification failed. Missing required fields stay blank.
 * Returns null when the scan produced no usable value to carry forward.
 */
export function buildLeaseReviewDraft(input: {
  review: LeaseScanReview
  docId: string
  sourceDocumentName: string
}): LeaseReviewDraftRows | null {
  const fields = input.review.fields
  const tenant = fieldAttention(fields.tenant_names, 'tenant_names')
  const address = fieldAttention(fields.property_address, 'property_address')
  const unit = fieldAttention(fields.unit, 'unit')
  const start = fieldAttention(fields.lease_start, 'lease_start')
  const end = fieldAttention(fields.lease_end, 'lease_end')
  const rent = fieldAttention(fields.monthly_rent, 'monthly_rent')
  const deposit = fieldAttention(fields.security_deposit, 'security_deposit')
  const due = fieldAttention(fields.rent_due_day, 'rent_due_day')
  const useful = [tenant, address, unit, start, end, rent, deposit, due].some((row) => row.value)
  if (!useful) return null

  const placed = placePropertyAddressFields({
    name: address.value,
    streetAddress: address.value,
  })
  const street = placed.streetAddress || address.value
  const propertyName = placed.name || street
  const propertyAttention: ReviewFieldAttentionMap = {}
  put(propertyAttention, 'address', address.attention)
  const property: OnboardingExtractedProperty = {
    id: `ext-prop-${input.docId}-lease-draft`,
    name: propertyName,
    address: street,
    city: placed.city,
    state: placed.state,
    zipCode: placed.zipCode,
    propertyType: 'single_family_home',
    unitCount: 1,
    unitLabels: '',
    propertyManagerName: '',
    propertyManagerPhone: '',
    sourceDocumentName: input.sourceDocumentName,
    confidence: fields.property_address?.confidence ?? 0,
    selected: true,
    needsReview: reviewRowNeedsAttention(propertyAttention),
    fieldAttention: propertyAttention,
  }

  const names = tenant.value
    ? tenant.value.split(',').map((name) => name.trim()).filter(Boolean)
    : ['']
  const shared = {
    unit: unit.value,
    building: street,
    leaseStart: start.value,
    leaseEnd: end.value,
    monthlyRent: rent.value,
    rentDueDay: due.value,
  }
  const residents: OnboardingExtractedResident[] = []
  const leases: ExtractedLeaseInfo[] = []
  names.forEach((name, index) => {
    const suffix = names.length === 1 ? 'lease-draft' : `lease-draft-${index}`
    const residentAttention: ReviewFieldAttentionMap = {}
    put(residentAttention, 'fullName', tenant.attention)
    put(residentAttention, 'unit', unit.attention)
    put(residentAttention, 'leaseStart', start.attention)
    put(residentAttention, 'leaseEnd', end.attention)
    put(residentAttention, 'monthlyRent', rent.attention)
    put(residentAttention, 'rentDueDay', due.attention)
    const leaseAttention: ReviewFieldAttentionMap = {}
    put(leaseAttention, 'residentName', tenant.attention)
    put(leaseAttention, 'unit', unit.attention)
    put(leaseAttention, 'leaseStart', start.attention)
    put(leaseAttention, 'leaseEnd', end.attention)
    put(leaseAttention, 'rentAmount', rent.attention)
    put(leaseAttention, 'securityDeposit', deposit.attention)
    put(leaseAttention, 'rentDueDay', due.attention)
    residents.push({
      id: `ext-res-${input.docId}-${suffix}`,
      fullName: name,
      ...shared,
      phone: '',
      email: '',
      occupancyStatus: 'active',
      maintenanceResponsibilitiesClause: '',
      sourceDocumentName: input.sourceDocumentName,
      confidence: fields.tenant_names?.confidence ?? fields.monthly_rent?.confidence ?? 0,
      selected: true,
      needsReview: reviewRowNeedsAttention(residentAttention),
      fieldAttention: residentAttention,
    })
    leases.push({
      id: `ext-lease-${input.docId}-${suffix}`,
      residentName: name,
      unit: unit.value,
      building: street,
      leaseStart: start.value,
      leaseEnd: end.value,
      rentAmount: rent.value,
      securityDeposit: deposit.value,
      rentDueDay: due.value,
      sourceDocumentName: input.sourceDocumentName,
      confidence: fields.monthly_rent?.confidence ?? 0,
      selected: true,
      needsReview: reviewRowNeedsAttention(leaseAttention),
      fieldAttention: leaseAttention,
    })
  })

  const units: OnboardingExtractedUnit[] =
    unit.value && street
      ? [
        {
          id: `ext-unit-${input.docId}-lease-draft`,
          label: unit.value,
          building: street,
          sourceDocumentName: input.sourceDocumentName,
          confidence: fields.unit?.confidence ?? 0,
          selected: true,
        },
      ]
    : []

  return { properties: [property], units, residents, leases }
}

function draftPairKey(id: string): string | null {
  const match = id.match(/lease-draft(?:-\d+)?$/)
  return match ? match[0] : null
}

const REQUIRED_REVIEW_KEYS = new Set([
  'fullName',
  'residentName',
  'address',
  'leaseStart',
  'monthlyRent',
  'rentAmount',
])

function nextAttention(
  current: ReviewFieldAttentionMap | undefined,
  key: string,
  value: string,
): ReviewFieldAttentionMap {
  const next = { ...(current ?? {}) }
  delete next[key]
  if (!value.trim() && REQUIRED_REVIEW_KEYS.has(key)) next[key] = 'required'
  return next
}

function withAttention<T extends { fieldAttention?: ReviewFieldAttentionMap; needsReview: boolean }>(
  row: T,
  key: string,
  value: string,
): T {
  const fieldAttention = nextAttention(row.fieldAttention, key, value)
  return {
    ...row,
    fieldAttention,
    needsReview: reviewRowNeedsAttention(fieldAttention),
  }
}

const SHARED_DRAFT_KEYS = new Set(['leaseStart', 'leaseEnd', 'unit', 'rentDueDay'])

/** Editing one review field confirms that field only. */
export function editLeaseReviewDraft(
  review: OnboardingExtractionReview,
  targetId: string,
  key: string,
  value: string,
): OnboardingExtractionReview {
  const pair = draftPairKey(targetId)
  const samePair = (id: string) => Boolean(pair && draftPairKey(id) === pair)

  return {
    ...review,
    properties: review.properties.map((row) => {
      if (row.id !== targetId || key !== 'address') return row
      const namedFromAddress = !row.name.trim() || row.name.trim() === row.address.trim()
      return {
        ...withAttention(row, 'address', value),
        address: value,
        name: namedFromAddress ? value : row.name,
        selected: true,
      }
    }),
    residents: review.residents.map((row) => {
      const paired = samePair(row.id)
      if (key === 'fullName' || key === 'residentName') {
        if (row.id !== targetId && !paired) return row
        return { ...withAttention(row, 'fullName', value), fullName: value, selected: true }
      }
      if (key === 'monthlyRent' || key === 'rentAmount') {
        if (row.id !== targetId && !paired) return row
        return { ...withAttention(row, 'monthlyRent', value), monthlyRent: value, selected: true }
      }
      if (SHARED_DRAFT_KEYS.has(key) && (row.id === targetId || paired)) {
        return { ...withAttention(row, key, value), [key]: value, selected: true }
      }
      if (row.id !== targetId) return row
      return { ...withAttention(row, key, value), [key]: value, selected: true }
    }),
    leases: review.leases.map((row) => {
      const paired = samePair(row.id)
      if (!paired && row.id !== targetId) return row
      if (key === 'fullName' || key === 'residentName') {
        return { ...withAttention(row, 'residentName', value), residentName: value, selected: true }
      }
      if (key === 'monthlyRent' || key === 'rentAmount') {
        return { ...withAttention(row, 'rentAmount', value), rentAmount: value, selected: true }
      }
      if (key === 'securityDeposit') {
        if (row.id !== targetId) return row
        return { ...withAttention(row, 'securityDeposit', value), securityDeposit: value, selected: true }
      }
      if (SHARED_DRAFT_KEYS.has(key)) {
        return { ...withAttention(row, key, value), [key]: value, selected: true }
      }
      return row
    }),
  }
}

/** Continuing Review confirms the values on screen. Required blanks stay required. */
export function confirmDisplayedLeaseDraft(
  review: OnboardingExtractionReview,
): OnboardingExtractionReview {
  const confirm = (attention?: ReviewFieldAttentionMap) => {
    if (!attention) return attention
    const next: ReviewFieldAttentionMap = {}
    for (const [key, state] of Object.entries(attention)) {
      if (state === 'required') next[key] = 'required'
    }
    return next
  }
  const apply = <T extends { fieldAttention?: ReviewFieldAttentionMap; needsReview: boolean }>(row: T): T => {
    if (!row.fieldAttention) return row
    const fieldAttention = confirm(row.fieldAttention)
    return { ...row, fieldAttention, needsReview: reviewRowNeedsAttention(fieldAttention) }
  }
  return {
    ...review,
    properties: review.properties.map(apply),
    residents: review.residents.map(apply),
    leases: review.leases.map(apply),
  }
}
