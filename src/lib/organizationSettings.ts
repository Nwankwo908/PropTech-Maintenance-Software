import { getActiveLandlordId } from '@/lib/activeLandlord'
import { supabase } from '@/lib/supabase'

export type OrganizationDocumentStatus = 'valid' | 'expiring' | 'expired'

export type OrganizationDocument = {
  id: string
  name: string
  meta: string
  updatedLabel: string
  status: OrganizationDocumentStatus
}

export type OrganizationSettingsForm = {
  legalName: string
  displayName: string
  supportEmail: string
  phone: string
  about: string
  street: string
  city: string
  state: string
  zip: string
  timeZone: string
  currency: string
  dateFormat: string
  brandAccent: string
  autoApprovalLimit: string
  escalationThreshold: string
  defaultResponseSla: string
  preferredVendorPool: string
  requirePhotoEvidence: boolean
  allowAiDispatch: boolean
  emailUpdates: boolean
  smsAlerts: boolean
  pushNotifications: boolean
  quietHours: boolean
  rentReminderCadence: string
  preferredLanguage: string
}

export type OrganizationWorkspaceSummary = {
  planLabel: string
  propertyCount: number
  activeUnitCount: number
  teamMemberCount: number
  createdLabel: string
  workspaceId: string
}

const STORAGE_PREFIX = 'ulo.organizationSettings.'

export const DEFAULT_ORGANIZATION_SETTINGS: OrganizationSettingsForm = {
  legalName: 'Ulo Home Management, Inc.',
  displayName: 'Ulo Home',
  supportEmail: 'support@ulohome.com',
  phone: '+1 (415) 555-0143',
  about: 'Modern property operations for multi-family portfolios across the West Coast.',
  street: '1230 Market Street, Suite 400',
  city: 'San Francisco',
  state: 'CA',
  zip: '94103',
  timeZone: 'America/Los_Angeles',
  currency: 'USD',
  dateFormat: 'MM/DD/YYYY',
  brandAccent: '#101828',
  autoApprovalLimit: '500',
  escalationThreshold: '2500',
  defaultResponseSla: '4 hours',
  preferredVendorPool: 'Tier 1 — Certified',
  requirePhotoEvidence: true,
  allowAiDispatch: true,
  emailUpdates: true,
  smsAlerts: true,
  pushNotifications: false,
  quietHours: true,
  rentReminderCadence: '2, 5, 1 day before',
  preferredLanguage: 'English (US)',
}

export const ORGANIZATION_BRAND_ACCENTS = [
  { id: 'navy', color: '#101828', label: 'Navy' },
  { id: 'teal', color: '#0d9488', label: 'Teal' },
  { id: 'purple', color: '#7c3aed', label: 'Purple' },
  { id: 'orange', color: '#ea580c', label: 'Orange' },
  { id: 'pink', color: '#db2777', label: 'Pink' },
  { id: 'slate', color: '#334155', label: 'Slate' },
] as const

export const ORGANIZATION_COMPLIANCE_DOCUMENTS: OrganizationDocument[] = [
  {
    id: 'certificate-of-incorporation',
    name: 'Certificate of Incorporation',
    meta: 'PDF · 218 KB',
    updatedLabel: 'Updated Jan 12, 2024',
    status: 'valid',
  },
  {
    id: 'business-license',
    name: 'Business License',
    meta: 'PDF · 142 KB',
    updatedLabel: 'Updated Nov 3, 2025',
    status: 'valid',
  },
  {
    id: 'insurance-coi',
    name: 'Insurance Certificate (COI)',
    meta: 'PDF · 384 KB',
    updatedLabel: 'Updated Feb 18, 2026',
    status: 'expiring',
  },
  {
    id: 'w9',
    name: 'W-9',
    meta: 'PDF · 96 KB',
    updatedLabel: 'Updated Aug 9, 2023',
    status: 'valid',
  },
  {
    id: 'operating-agreement',
    name: 'Operating Agreement',
    meta: 'PDF · 512 KB',
    updatedLabel: 'Updated Jun 1, 2022',
    status: 'expired',
  },
]

function storageKey(landlordId: string): string {
  return `${STORAGE_PREFIX}${landlordId}`
}

function formatCreatedLabel(value: string | null | undefined): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function workspaceIdFromLandlord(landlordId: string): string {
  const compact = landlordId.replace(/-/g, '').slice(0, 5)
  return `ulo_${compact}`
}

function readStoredSettings(landlordId: string): OrganizationSettingsForm | null {
  try {
    const raw = window.localStorage.getItem(storageKey(landlordId))
    if (!raw) return null
    return { ...DEFAULT_ORGANIZATION_SETTINGS, ...(JSON.parse(raw) as Partial<OrganizationSettingsForm>) }
  } catch {
    return null
  }
}

export function writeStoredOrganizationSettings(
  landlordId: string,
  settings: OrganizationSettingsForm,
): void {
  try {
    window.localStorage.setItem(storageKey(landlordId), JSON.stringify(settings))
  } catch {
    // private mode
  }
}

export async function loadOrganizationSettings(
  landlordId: string = getActiveLandlordId(),
): Promise<OrganizationSettingsForm> {
  const stored = readStoredSettings(landlordId)
  if (stored) return stored

  const next = { ...DEFAULT_ORGANIZATION_SETTINGS }

  if (!supabase) return next

  const [{ data: landlord }, { data: onboarding }] = await Promise.all([
    supabase.from('landlords').select('name, email').eq('id', landlordId).maybeSingle(),
    supabase
      .from('landlord_onboarding')
      .select('auto_approval_threshold, draft_state')
      .eq('landlord_id', landlordId)
      .maybeSingle(),
  ])

  if (landlord?.name) {
    next.legalName = landlord.name
    if (!next.displayName || next.displayName === DEFAULT_ORGANIZATION_SETTINGS.displayName) {
      next.displayName = landlord.name
    }
  }
  if (landlord?.email) {
    next.supportEmail = landlord.email
  }

  const threshold = onboarding?.auto_approval_threshold
  if (threshold != null && Number.isFinite(Number(threshold))) {
    next.autoApprovalLimit = String(Math.round(Number(threshold)))
  }

  const draft = (onboarding?.draft_state ?? {}) as Record<string, unknown>
  const accountSetup = (draft.accountSetup ?? {}) as Record<string, unknown>
  if (typeof accountSetup.companyName === 'string' && accountSetup.companyName.trim()) {
    next.legalName = accountSetup.companyName.trim()
  }
  if (typeof accountSetup.phone === 'string' && accountSetup.phone.trim()) {
    next.phone = accountSetup.phone.trim()
  }
  if (typeof accountSetup.email === 'string' && accountSetup.email.trim()) {
    next.supportEmail = accountSetup.email.trim()
  }

  return next
}

export async function saveOrganizationSettings(
  settings: OrganizationSettingsForm,
  landlordId: string = getActiveLandlordId(),
): Promise<void> {
  writeStoredOrganizationSettings(landlordId, settings)

  if (!supabase) return

  const autoApproval = Number.parseFloat(settings.autoApprovalLimit.replace(/[^\d.]/g, ''))
  const { data: existing } = await supabase
    .from('landlord_onboarding')
    .select('draft_state')
    .eq('landlord_id', landlordId)
    .maybeSingle()

  const draft = (existing?.draft_state ?? {}) as Record<string, unknown>
  const accountSetup = (draft.accountSetup ?? {}) as Record<string, unknown>

  await supabase.from('landlord_onboarding').upsert(
    {
      landlord_id: landlordId,
      auto_approval_threshold: Number.isFinite(autoApproval) ? autoApproval : 250,
      draft_state: {
        ...draft,
        accountSetup: {
          ...accountSetup,
          companyName: settings.legalName,
          email: settings.supportEmail,
          phone: settings.phone,
        },
        organizationSettings: settings,
      },
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'landlord_id' },
  )
}

export async function loadOrganizationWorkspaceSummary(
  landlordId: string = getActiveLandlordId(),
): Promise<OrganizationWorkspaceSummary> {
  const fallback: OrganizationWorkspaceSummary = {
    planLabel: 'Enterprise',
    propertyCount: 24,
    activeUnitCount: 1286,
    teamMemberCount: 15,
    createdLabel: 'Mar 4, 2023',
    workspaceId: workspaceIdFromLandlord(landlordId),
  }

  if (!supabase) return fallback

  const [{ data: landlord }, { data: units, count: unitCount }, { count: residentCount }] =
    await Promise.all([
      supabase.from('landlords').select('created_at').eq('id', landlordId).maybeSingle(),
      supabase.from('units').select('building', { count: 'exact' }).eq('landlord_id', landlordId),
      supabase.from('users').select('id', { count: 'exact', head: true }).eq('landlord_id', landlordId),
    ])

  const buildings = new Set(
    (units ?? []).map((row) => String(row.building ?? '').trim()).filter(Boolean),
  )

  return {
    planLabel: 'Enterprise',
    propertyCount: buildings.size || fallback.propertyCount,
    activeUnitCount: unitCount ?? fallback.activeUnitCount,
    teamMemberCount: residentCount ?? fallback.teamMemberCount,
    createdLabel: formatCreatedLabel(landlord?.created_at) || fallback.createdLabel,
    workspaceId: workspaceIdFromLandlord(landlordId),
  }
}
