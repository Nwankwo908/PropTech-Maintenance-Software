import type { MonitoringTranscriptItem } from '@/lib/conversationMonitoring'
import { vendorOutreachLocationPhrase } from '@/lib/vendorOutreachCopy'
import {
  touchVendorSetupInboxActivity,
  type VendorSetupThreadContext,
} from '@/lib/vendorSetupConversation'

export type VendorIntakeSession = VendorSetupThreadContext & {
  conversationId: string
  token: string
}

export type VendorIntakeInsuranceStep = {
  coiFileName: string | null
  generalLiability: string
  workersComp: 'active' | 'inactive' | null
  policyExpiration: string
}

export type VendorIntakePricingStep = {
  serviceCallFee: string
  hourlyRate: string
  acceptsEmergency: boolean | null
}

export type VendorIntakeAvailabilityStep = {
  canTakeJobToday: boolean | null
  notes: string
}

export type VendorIntakeFormData = {
  insurance: VendorIntakeInsuranceStep
  pricing: VendorIntakePricingStep
  availability: VendorIntakeAvailabilityStep
}

export type VendorIntakeSubmission = VendorIntakeFormData & {
  submittedAtMs: number
}

const SUBMISSION_STORAGE_PREFIX = 'ulo.vendorSetupIntakeSubmission.'
const RESPONSE_STORAGE_PREFIX = 'ulo.vendorSetupIntakeResponses.'
const TOKEN_STORAGE_PREFIX = 'ulo.vendorSetupIntakeToken.'

function readJson<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return null
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* ignore */
  }
}

export function readVendorIntakeSessionByToken(token: string): VendorIntakeSession | null {
  return readJson<VendorIntakeSession>(`${TOKEN_STORAGE_PREFIX}${token.trim()}`)
}

export function readVendorIntakeSubmission(conversationId: string): VendorIntakeSubmission | null {
  return readJson<VendorIntakeSubmission>(`${SUBMISSION_STORAGE_PREFIX}${conversationId}`)
}

export function hasVendorIntakeSubmission(conversationId: string): boolean {
  return readVendorIntakeSubmission(conversationId) != null
}

export function readVendorIntakeResponses(conversationId: string): MonitoringTranscriptItem[] {
  return readJson<MonitoringTranscriptItem[]>(`${RESPONSE_STORAGE_PREFIX}${conversationId}`) ?? []
}

function formatCurrency(value: string): string {
  const digits = value.replace(/[^\d.]/g, '')
  if (!digits) return '—'
  const num = Number(digits)
  if (!Number.isFinite(num)) return value.trim() || '—'
  return `$${num.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
}

function buildSubmissionSummary(data: VendorIntakeFormData): string {
  const workersComp =
    data.insurance.workersComp === 'active'
      ? 'Active'
      : data.insurance.workersComp === 'inactive'
        ? 'Not active'
        : '—'
  const emergency =
    data.pricing.acceptsEmergency == null
      ? '—'
      : data.pricing.acceptsEmergency
        ? 'Yes'
        : 'No'
  const availability =
    data.availability.canTakeJobToday == null
      ? '—'
      : data.availability.canTakeJobToday
        ? 'Yes, available today'
        : 'No, not today'

  const lines = [
    'Quick form submitted:',
    `· Insurance doc: ${data.insurance.coiFileName ?? 'Not uploaded'}`,
    `· General liability: ${formatCurrency(data.insurance.generalLiability)}`,
    `· Workers' comp: ${workersComp}`,
    `· Policy expires: ${data.insurance.policyExpiration || '—'}`,
    `· Service call: ${formatCurrency(data.pricing.serviceCallFee)}`,
    `· Hourly rate: ${formatCurrency(data.pricing.hourlyRate)}/hr`,
    `· Emergency jobs: ${emergency}`,
    `· Available today: ${availability}`,
  ]

  if (data.availability.notes.trim()) {
    lines.push(`· Notes: ${data.availability.notes.trim()}`)
  }

  lines.push('· Pricing: pending confirmation from you and the property manager')

  return lines.join('\n')
}

export function submitVendorIntakeForm(
  session: VendorIntakeSession,
  data: VendorIntakeFormData,
): VendorIntakeSubmission {
  const submission: VendorIntakeSubmission = {
    ...data,
    submittedAtMs: Date.now(),
  }

  writeJson(`${SUBMISSION_STORAGE_PREFIX}${session.conversationId}`, submission)

  const responseItem: MonitoringTranscriptItem = {
    type: 'message',
    sender: 'vendor',
    senderName: session.vendorName,
    body: buildSubmissionSummary(data),
    timestampMs: submission.submittedAtMs,
    outreachChannel: 'both',
  }

  writeJson(`${RESPONSE_STORAGE_PREFIX}${session.conversationId}`, [responseItem])
  touchVendorSetupInboxActivity(
    session.conversationId,
    'Quick form submitted',
    submission.submittedAtMs,
  )

  return submission
}

export function buildVendorIntakeJobDetails(session: VendorIntakeSession): {
  locationLine: string
  tradeLine: string
  urgencyLine: string
} {
  const locationLine = vendorOutreachLocationPhrase(session.locationLabel)
  const tradeLower = session.tradeLabel.toLowerCase().replace(/\s+/g, ' ')
  const tradeLine = `${tradeLower.charAt(0).toUpperCase()}${tradeLower.slice(1)} repair`
  return {
    locationLine,
    tradeLine,
    urgencyLine: 'Needed today · please reply within 4 hours',
  }
}

export function emptyVendorIntakeForm(): VendorIntakeFormData {
  return {
    insurance: {
      coiFileName: null,
      generalLiability: '',
      workersComp: null,
      policyExpiration: '',
    },
    pricing: {
      serviceCallFee: '',
      hourlyRate: '',
      acceptsEmergency: null,
    },
    availability: {
      canTakeJobToday: null,
      notes: '',
    },
  }
}

export function resolveVendorIntakeSession(token: string): VendorIntakeSession | null {
  if (!token.trim()) return null
  return readVendorIntakeSessionByToken(token.trim())
}
