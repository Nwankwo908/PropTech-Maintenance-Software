import { getActiveLandlordId } from '@/lib/activeLandlord'
import type {
  ConnectedEmailProvider,
  ConnectedEmailSettings,
  LandlordAccountSettingsPayload,
} from '@/lib/landlordSettings/types'
import { recordActivityLog } from '@/lib/recordActivityLog'
import { supabase } from '@/lib/supabase'

export type EmailConfidenceLevel = 'high' | 'medium'

export type EmailDocumentCategory =
  | 'lease'
  | 'invoice'
  | 'inspection'
  | 'insurance'
  | 'vendor'
  | 'rent_roll'

export type EmailDocumentStatus = 'ready' | 'needs_review'

export type DiscoveredDocumentBucket = {
  id: string
  label: string
  count: number
  confidence: EmailConfidenceLevel
}

export type RecentlyDiscoveredDocument = {
  id: string
  name: string
  category: string
  property: string
  dateLabel: string
  confidencePercent: number
  status: EmailDocumentStatus
}

export type RecommendedAction = {
  id: string
  title: string
  detail: string
}

export type EmailActivityItem = {
  id: string
  dayLabel: string
  message: string
}

export const EMAIL_DISCOVERY_CATEGORIES = [
  {
    id: 'property',
    title: 'Property documents',
    icon: 'property',
    items: ['Property deeds', 'Tax records', 'Purchase agreements', 'Insurance policies'],
  },
  {
    id: 'resident',
    title: 'Resident documents',
    icon: 'resident',
    items: ['Lease agreements', 'Move-in documents', 'Resident rosters', 'Renewal notices'],
  },
  {
    id: 'vendor',
    title: 'Vendor documents',
    icon: 'vendor',
    items: ['Vendor contracts', 'Invoices', 'W-9 forms', 'COI certificates'],
  },
  {
    id: 'financial',
    title: 'Financial documents',
    icon: 'financial',
    items: ['Rent rolls', 'Property statements', 'Expense reports', 'Bank reconciliations'],
  },
] as const

export const EMAIL_PRIVACY_POINTS = [
  'Ulo only searches for property-related emails',
  'Nothing is imported without your approval',
  'You can disconnect or pause scanning anytime',
  'Credentials are encrypted and never shared',
]

export const EMAIL_AUTOMATION_TOGGLES = [
  { id: 'new_lease', label: 'New lease found', defaultOn: true },
  { id: 'vendor_invoice', label: 'Vendor invoice received', defaultOn: true },
  { id: 'inspection_report', label: 'Inspection report detected', defaultOn: true },
  { id: 'insurance_expiry', label: 'Insurance document expires', defaultOn: true },
  { id: 'rent_roll', label: 'Rent roll updated', defaultOn: false },
] as const

export const EMAIL_PROVIDER_OPTIONS: {
  id: ConnectedEmailProvider
  label: string
}[] = [
  { id: 'gmail', label: 'Gmail' },
  { id: 'outlook', label: 'Outlook' },
  { id: 'microsoft365', label: 'Microsoft 365' },
]

export function defaultConnectedEmailAutomation(): Record<string, boolean> {
  const automation: Record<string, boolean> = {}
  for (const toggle of EMAIL_AUTOMATION_TOGGLES) {
    automation[toggle.id] = toggle.defaultOn
  }
  return automation
}

export function defaultConnectedEmailSettings(): ConnectedEmailSettings {
  return {
    connected: false,
    provider: null,
    email: '',
    connectedAt: null,
    paused: false,
    automation: defaultConnectedEmailAutomation(),
  }
}

export function normalizeConnectedEmailSettings(
  raw: Partial<ConnectedEmailSettings> | null | undefined,
): ConnectedEmailSettings {
  const base = defaultConnectedEmailSettings()
  if (!raw || typeof raw !== 'object') return base

  const provider =
    raw.provider === 'gmail' || raw.provider === 'outlook' || raw.provider === 'microsoft365'
      ? raw.provider
      : null

  const automation = { ...base.automation }
  if (raw.automation && typeof raw.automation === 'object') {
    for (const toggle of EMAIL_AUTOMATION_TOGGLES) {
      if (typeof raw.automation[toggle.id] === 'boolean') {
        automation[toggle.id] = raw.automation[toggle.id]
      }
    }
  }

  return {
    connected: Boolean(raw.connected) && Boolean(provider) && Boolean(String(raw.email ?? '').trim()),
    provider,
    email: typeof raw.email === 'string' ? raw.email.trim() : '',
    connectedAt: typeof raw.connectedAt === 'string' ? raw.connectedAt : null,
    paused: Boolean(raw.paused),
    automation,
  }
}

export function providerLabel(provider: ConnectedEmailProvider | null | undefined): string {
  if (!provider) return 'Not connected'
  return EMAIL_PROVIDER_OPTIONS.find((row) => row.id === provider)?.label ?? provider
}

export async function loadConnectedEmailSettings(
  landlordId: string = getActiveLandlordId(),
): Promise<ConnectedEmailSettings> {
  if (!supabase) return defaultConnectedEmailSettings()

  const { data } = await supabase
    .from('landlord_onboarding')
    .select('account_settings')
    .eq('landlord_id', landlordId)
    .maybeSingle()

  const account = (data?.account_settings ?? {}) as LandlordAccountSettingsPayload
  return normalizeConnectedEmailSettings(account.connectedEmail)
}

export async function saveConnectedEmailSettings(
  settings: ConnectedEmailSettings,
  landlordId: string = getActiveLandlordId(),
): Promise<{ ok: boolean; error?: string }> {
  if (!supabase) return { ok: false, error: 'Database unavailable.' }

  const normalized = normalizeConnectedEmailSettings(settings)

  const { data: existing } = await supabase
    .from('landlord_onboarding')
    .select('account_settings, draft_state')
    .eq('landlord_id', landlordId)
    .maybeSingle()

  const prior = (existing?.account_settings ?? {}) as LandlordAccountSettingsPayload
  const accountSettings: LandlordAccountSettingsPayload = {
    ...prior,
    version: 1,
    connectedEmail: normalized,
  }

  const { error } = await supabase.from('landlord_onboarding').upsert(
    {
      landlord_id: landlordId,
      account_settings: accountSettings,
      draft_state: existing?.draft_state ?? {},
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'landlord_id' },
  )

  if (error) return { ok: false, error: error.message }
  return { ok: true }
}

export function getDiscoveredDocumentBuckets(): DiscoveredDocumentBucket[] {
  return []
}

export function getRecentlyDiscoveredDocuments(): RecentlyDiscoveredDocument[] {
  return []
}

export function getEmailRecommendedActions(): RecommendedAction[] {
  return []
}

export function getEmailActivityFeed(): EmailActivityItem[] {
  return []
}

export function getConnectedEmailAccount(settings?: ConnectedEmailSettings) {
  const state = settings ? normalizeConnectedEmailSettings(settings) : defaultConnectedEmailSettings()
  return {
    provider: providerLabel(state.provider),
    email: state.email,
    lastSyncLabel: state.connected
      ? state.paused
        ? 'Paused'
        : 'Waiting for sync'
      : '—',
    connected: state.connected,
    paused: state.paused,
    connectedAt: state.connectedAt,
  }
}

export async function connectEmailAccount(input: {
  provider: ConnectedEmailProvider
  email: string
  landlordId?: string
}): Promise<{ ok: true; settings: ConnectedEmailSettings } | { ok: false; error: string }> {
  const email = input.email.trim()
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false, error: 'Enter a valid email address.' }
  }

  const landlordId = input.landlordId ?? getActiveLandlordId()
  const prior = await loadConnectedEmailSettings(landlordId)
  const next: ConnectedEmailSettings = {
    ...prior,
    connected: true,
    provider: input.provider,
    email,
    connectedAt: new Date().toISOString(),
    paused: false,
    automation: prior.automation?.new_lease != null ? prior.automation : defaultConnectedEmailAutomation(),
  }

  const result = await saveConnectedEmailSettings(next, landlordId)
  if (!result.ok) return { ok: false, error: result.error ?? 'Could not save connection.' }

  void recordActivityLog({
    landlordId,
    eventType: 'integrations.email_connected',
    source: 'dashboard',
    actorType: 'landlord',
    metadata: {
      message: `${providerLabel(input.provider)} connection saved for ${email}.`,
      provider: input.provider,
      email,
    },
  })

  return { ok: true, settings: next }
}

export async function disconnectEmailAccount(
  landlordId: string = getActiveLandlordId(),
): Promise<{ ok: true; settings: ConnectedEmailSettings } | { ok: false; error: string }> {
  const prior = await loadConnectedEmailSettings(landlordId)
  const next: ConnectedEmailSettings = {
    ...defaultConnectedEmailSettings(),
    automation: prior.automation,
  }
  const result = await saveConnectedEmailSettings(next, landlordId)
  if (!result.ok) return { ok: false, error: result.error ?? 'Could not disconnect.' }

  void recordActivityLog({
    landlordId,
    eventType: 'integrations.email_disconnected',
    source: 'dashboard',
    actorType: 'landlord',
    metadata: {
      message: 'Connected email was disconnected.',
      previousEmail: prior.email,
      previousProvider: prior.provider,
    },
  })

  return { ok: true, settings: next }
}
