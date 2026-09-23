/**
 * Pure helpers for the public vendor job detail page (`/w/:token`).
 * Maps existing resolve flags → one primary next step + progress marks.
 * No workflow side effects — UI only.
 */

export type VendorJobNextStepKind =
  | 'accept'
  | 'submit_estimate'
  | 'waiting_estimate_approval'
  | 'start_work'
  | 'add_photos'
  | 'submit_invoice'
  | 'waiting_payment'
  | 'job_complete'
  | 'declined'

export type VendorJobProgressId =
  | 'estimate'
  | 'start_work'
  | 'photos'
  | 'invoice'

export type VendorJobProgressMark = 'done' | 'current' | 'upcoming'

export type VendorJobNextStepInput = {
  status: string | null | undefined
  estimateStatus: string | null | undefined
  estimateSubmitted: boolean
  estimateApproved: boolean
  completionPhotosUploaded: boolean
  invoiceStatus: string | null | undefined
  invoiceSubmitted: boolean
}

export type VendorJobNextStep = {
  kind: VendorJobNextStepKind
  /** Progress row emphasis */
  progress: Record<VendorJobProgressId, VendorJobProgressMark>
  /** Coming-next ids (upcoming only, after current) */
  comingNext: VendorJobProgressId[]
}

export const PROGRESS_ORDER: VendorJobProgressId[] = [
  'estimate',
  'start_work',
  'photos',
  'invoice',
]

function marks(
  current: VendorJobProgressId | null,
  doneThrough: VendorJobProgressId | null,
): Record<VendorJobProgressId, VendorJobProgressMark> {
  const doneIdx = doneThrough ? PROGRESS_ORDER.indexOf(doneThrough) : -1
  const currentIdx = current ? PROGRESS_ORDER.indexOf(current) : -1
  const out = {} as Record<VendorJobProgressId, VendorJobProgressMark>
  for (let i = 0; i < PROGRESS_ORDER.length; i++) {
    const id = PROGRESS_ORDER[i]!
    if (i <= doneIdx) out[id] = 'done'
    else if (i === currentIdx) out[id] = 'current'
    else out[id] = 'upcoming'
  }
  return out
}

function comingNextFrom(
  progress: Record<VendorJobProgressId, VendorJobProgressMark>,
): VendorJobProgressId[] {
  const currentIdx = PROGRESS_ORDER.findIndex((id) => progress[id] === 'current')
  const start = currentIdx >= 0 ? currentIdx + 1 : PROGRESS_ORDER.findIndex((id) => progress[id] === 'upcoming')
  if (start < 0) return []
  return PROGRESS_ORDER.slice(start).filter((id) => progress[id] === 'upcoming')
}

/**
 * Decide the single dominant next step from existing job flags.
 */
export function resolveVendorJobNextStep(
  input: VendorJobNextStepInput,
): VendorJobNextStep {
  const status = (input.status ?? '').trim().toLowerCase()
  const estimateStatus = (input.estimateStatus ?? '').trim().toLowerCase()
  const invoiceStatus = (input.invoiceStatus ?? '').trim().toLowerCase()
  const workStarted = status === 'in_progress' || status === 'completed'
  const invoicePaid =
    invoiceStatus === 'approved' ||
    invoiceStatus === 'paid' ||
    invoiceStatus === 'recognized'
  const invoiceSubmitted =
    input.invoiceSubmitted ||
    invoiceStatus === 'submitted' ||
    invoicePaid

  if (status === 'declined') {
    const progress = marks(null, null)
    return { kind: 'declined', progress, comingNext: [] }
  }

  if (status === 'completed' || invoicePaid) {
    const progress = marks(null, 'invoice')
    return { kind: 'job_complete', progress, comingNext: [] }
  }

  if (invoiceSubmitted) {
    const progress = marks('invoice', 'photos')
    return {
      kind: 'waiting_payment',
      progress,
      comingNext: comingNextFrom(progress),
    }
  }

  if (status === 'pending_accept') {
    const progress = marks('estimate', null)
    return {
      kind: 'accept',
      progress,
      comingNext: comingNextFrom(progress),
    }
  }

  if (input.completionPhotosUploaded) {
    const progress = marks('invoice', 'photos')
    return {
      kind: 'submit_invoice',
      progress,
      comingNext: comingNextFrom(progress),
    }
  }

  if (workStarted || status === 'in_progress') {
    const progress = marks('photos', 'start_work')
    return {
      kind: 'add_photos',
      progress,
      comingNext: comingNextFrom(progress),
    }
  }

  if (input.estimateApproved) {
    const progress = marks('start_work', 'estimate')
    return {
      kind: 'start_work',
      progress,
      comingNext: comingNextFrom(progress),
    }
  }

  if (estimateStatus === 'pending_approval' || (input.estimateSubmitted && !input.estimateApproved)) {
    const progress = marks('estimate', null)
    return {
      kind: 'waiting_estimate_approval',
      progress,
      comingNext: comingNextFrom(progress),
    }
  }

  // accepted (or open) without an approved estimate — submit / resubmit
  const progress = marks('estimate', null)
  return {
    kind: 'submit_estimate',
    progress,
    comingNext: comingNextFrom(progress),
  }
}

/** Format estimate dollars for vendor-facing copy (e.g. $200). */
export function formatEstimateDollars(
  totalCost: number | null | undefined,
): string | null {
  if (totalCost == null || !Number.isFinite(totalCost)) return null
  const rounded = Math.round(totalCost)
  if (rounded <= 0) return null
  return `$${rounded.toLocaleString('en-US')}`
}

export type HumanizedVendorJobDescription = {
  title: string
  residentReport: string | null
  affectedArea: string | null
  /** Coarse access signal for localized copy on the page. */
  accessFromIntake: 'must_be_home' | 'ok_if_away' | null
}

const INTAKE_LABELS = [
  'Affected area',
  'Safety concerns',
  'First noticed',
  'Resident availability',
  'Tenant update',
  'Entry if not home',
  'Entry if absent',
  'Preferred contact method',
  'Preferred contact',
]

/**
 * Turn SMS/intake description blobs into human-readable job copy.
 */
export function humanizeVendorJobDescription(input: {
  description: string | null | undefined
  issueHeadline?: string | null
  entryOkIfAbsent?: boolean | null
  fallbackTitle?: string | null
}): HumanizedVendorJobDescription {
  let rest = (input.description ?? '').replace(/\r\n/g, '\n').trim()

  const takeLabeled = (label: string): string | null => {
    const re = new RegExp(`(?:^|\\n+)\\s*${label}:\\s*([^\\n]+)`, 'i')
    const match = rest.match(re)
    if (!match) return null
    rest = rest.replace(re, '\n').trim()
    const value = match[1]!.replace(/[.]+$/, '').trim()
    return value || null
  }

  const affectedArea = takeLabeled('Affected area')
  const entryIfNotHome = takeLabeled('Entry if not home') ?? takeLabeled('Entry if absent')
  for (const label of INTAKE_LABELS) {
    if (label === 'Affected area' || label === 'Entry if not home' || label === 'Entry if absent') {
      continue
    }
    takeLabeled(label)
  }

  // Collapse leftover intake fragments like "Tenant update: No" that survived.
  rest = rest
    .replace(/(?:^|\n+)\s*[A-Za-z][A-Za-z /]{1,40}:\s*(Yes|No)\b/gi, '')
    .replace(/\n+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  const residentReport = rest || null

  const headline = input.issueHeadline?.trim() || ''
  const title =
    headline ||
    (residentReport
      ? residentReport.split(/[.!?]/)[0]!.trim().slice(0, 80)
      : '') ||
    input.fallbackTitle?.trim() ||
    'Maintenance'

  // accessFromIntake is a coarse signal; page maps to localized copy via entryOkIfAbsent / flag.
  let accessFromIntake: string | null = null
  if (typeof input.entryOkIfAbsent === 'boolean') {
    accessFromIntake = input.entryOkIfAbsent ? 'ok_if_away' : 'must_be_home'
  } else if (entryIfNotHome) {
    const lower = entryIfNotHome.toLowerCase()
    if (lower === 'yes' || lower === 'y' || lower === 'true') {
      accessFromIntake = 'ok_if_away'
    } else if (lower === 'no' || lower === 'n' || lower === 'false') {
      accessFromIntake = 'must_be_home'
    }
  }

  return {
    title,
    residentReport,
    affectedArea,
    accessFromIntake,
  }
}
