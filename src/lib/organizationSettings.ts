import { getActiveLandlordId } from '@/lib/activeLandlord'
import {
  DEFAULT_COMMUNICATION_STYLE,
  normalizeCommunicationStyle,
  type CommunicationStyle,
} from '@/lib/communicationStyle'
import { persistLandlordCommunicationStyle } from '@/lib/onboarding'
import {
  documentCategoryLabel,
  formatFileSize,
  LANDLORD_ONBOARDING_DOCUMENTS_BUCKET,
  type OnboardingDocumentCategory,
  type OnboardingUploadedDocument,
  type UploadFileStatus,
} from '@/lib/onboardingDocumentUpload'
import { supabase } from '@/lib/supabase'

export type OrganizationDocumentStatus = 'valid' | 'expiring' | 'expired'

export type OrganizationDocumentSource = 'onboarding' | 'vendor_verification'

export type OrganizationDocument = {
  id: string
  name: string
  meta: string
  updatedLabel: string
  status: OrganizationDocumentStatus
  source: OrganizationDocumentSource
  sourceLabel: string
  storageBucket: string | null
  storagePath: string | null
  /** Short-lived signed URL for in-browser preview (null when file is unavailable). */
  previewUrl: string | null
}

const VENDOR_DOCUMENTS_BUCKET = 'vendor-documents'

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
  /** Surface landlord alerts in the Overview Ulo Activity Feed. */
  activityFeedAlerts: boolean
  pushNotifications: boolean
  quietHours: boolean
  rentReminderCadence: string
  preferredLanguage: string
  /** Tone for Ulo-generated operational SMS and email. */
  communicationStyle: CommunicationStyle
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
  autoApprovalLimit: '250',
  escalationThreshold: '2500',
  defaultResponseSla: '4 hours',
  preferredVendorPool: 'Include imported vendors',
  requirePhotoEvidence: true,
  allowAiDispatch: true,
  emailUpdates: true,
  smsAlerts: true,
  activityFeedAlerts: true,
  pushNotifications: false,
  quietHours: true,
  rentReminderCadence: '2, 5, 1 day before',
  preferredLanguage: 'English (US)',
  communicationStyle: DEFAULT_COMMUNICATION_STYLE,
}

export const ORGANIZATION_BRAND_ACCENTS = [
  { id: 'navy', color: '#101828', label: 'Navy' },
  { id: 'teal', color: '#0d9488', label: 'Teal' },
  { id: 'purple', color: '#7c3aed', label: 'Purple' },
  { id: 'orange', color: '#ea580c', label: 'Orange' },
  { id: 'pink', color: '#db2777', label: 'Pink' },
  { id: 'slate', color: '#334155', label: 'Slate' },
] as const

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
    const merged = {
      ...DEFAULT_ORGANIZATION_SETTINGS,
      ...(JSON.parse(raw) as Partial<OrganizationSettingsForm>),
    }
    merged.communicationStyle = normalizeCommunicationStyle(merged.communicationStyle)
    return merged
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
  const next = stored ?? { ...DEFAULT_ORGANIZATION_SETTINGS }

  if (!supabase) return next

  const [{ data: landlord }, { data: onboarding }] = await Promise.all([
    supabase
      .from('landlords')
      .select('name, email, communication_style')
      .eq('id', landlordId)
      .maybeSingle(),
    supabase
      .from('landlord_onboarding')
      .select(
        'auto_approval_threshold, marketplace_preference, draft_state, communication_style, notification_channel',
      )
      .eq('landlord_id', landlordId)
      .maybeSingle(),
  ])

  // Prefer DB communication style over stale localStorage.
  const styleFromLandlord = (landlord as { communication_style?: string } | null)
    ?.communication_style
  const styleFromOnboarding = (onboarding as { communication_style?: string } | null)
    ?.communication_style
  if (styleFromLandlord || styleFromOnboarding) {
    next.communicationStyle = normalizeCommunicationStyle(
      styleFromLandlord ?? styleFromOnboarding,
    )
  }

  if (stored) return next

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

  const marketplace = (onboarding as { marketplace_preference?: string } | null)
    ?.marketplace_preference
  if (marketplace === 'ulo_vetted_only') {
    next.preferredVendorPool = 'Ulo-vetted vendors only'
  } else if (marketplace === 'include_imported') {
    next.preferredVendorPool = 'Include imported vendors'
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

  const notificationChannel = String(
    (onboarding as { notification_channel?: string } | null)?.notification_channel ??
      (typeof (draft.approvalRules as { notificationChannel?: string } | undefined)
        ?.notificationChannel === 'string'
        ? (draft.approvalRules as { notificationChannel?: string }).notificationChannel
        : ''),
  ).trim()
  if (notificationChannel === 'sms') {
    next.smsAlerts = true
    next.emailUpdates = false
    next.activityFeedAlerts = false
  } else if (notificationChannel === 'email') {
    next.smsAlerts = false
    next.emailUpdates = true
    next.activityFeedAlerts = false
  } else if (notificationChannel === 'activity_feed') {
    next.smsAlerts = false
    next.emailUpdates = false
    next.activityFeedAlerts = true
  } else if (notificationChannel === 'both') {
    next.smsAlerts = true
    next.emailUpdates = true
    next.activityFeedAlerts = true
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
  const marketplacePreference =
    settings.preferredVendorPool === 'Ulo-vetted vendors only'
      ? 'ulo_vetted_only'
      : settings.preferredVendorPool === 'Include imported vendors'
        ? 'include_imported'
        : null

  const { data: existing } = await supabase
    .from('landlord_onboarding')
    .select('draft_state')
    .eq('landlord_id', landlordId)
    .maybeSingle()

  const draft = (existing?.draft_state ?? {}) as Record<string, unknown>
  const accountSetup = (draft.accountSetup ?? {}) as Record<string, unknown>

  const upsertRow: Record<string, unknown> = {
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
  }
  if (marketplacePreference) {
    upsertRow.marketplace_preference = marketplacePreference
  }
  const communicationStyle = normalizeCommunicationStyle(settings.communicationStyle)
  upsertRow.communication_style = communicationStyle

  const { error } = await supabase.from('landlord_onboarding').upsert(upsertRow, {
    onConflict: 'landlord_id',
  })
  if (
    error &&
    (error.code === '42703' ||
      /marketplace_preference|communication_style/i.test(error.message))
  ) {
    const {
      marketplace_preference: _dropMarket,
      communication_style: _dropStyle,
      ...legacy
    } = upsertRow
    await supabase.from('landlord_onboarding').upsert(legacy, { onConflict: 'landlord_id' })
  }

  await persistLandlordCommunicationStyle(landlordId, communicationStyle, {
    eventType: 'landlord.communication_style_updated',
    step: 'settings',
    source: 'admin_ui',
  })

  // Keep landlords profile aligned with organization settings (same fields as onboarding).
  const legalName = settings.legalName.trim()
  if (legalName) {
    const landlordPayload: Record<string, unknown> = {
      name: legalName,
      email: settings.supportEmail.trim() || null,
      phone: settings.phone.trim() || null,
    }
    const { error: landlordError } = await supabase
      .from('landlords')
      .update(landlordPayload)
      .eq('id', landlordId)
    if (landlordError && /phone|column .* does not exist/i.test(landlordError.message)) {
      await supabase
        .from('landlords')
        .update({
          name: legalName,
          email: settings.supportEmail.trim() || null,
        })
        .eq('id', landlordId)
    } else if (landlordError) {
      console.warn('[organizationSettings] landlords profile', landlordError.message)
    }
  }
}

function formatUpdatedLabel(iso: string | null | undefined): string {
  if (!iso?.trim()) return 'On file'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return 'On file'
  return `Updated ${date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })}`
}

function onboardingUploadStatus(
  status: UploadFileStatus | string | undefined,
): OrganizationDocumentStatus {
  switch (status) {
    case 'failed':
      return 'expired'
    case 'needs_attention':
      return 'expiring'
    default:
      return 'valid'
  }
}

function vendorKindLabel(kind: string): string {
  switch (kind) {
    case 'license':
      return 'License'
    case 'coi':
      return 'Insurance certificate (COI)'
    case 'w9':
      return 'W-9'
    default:
      return 'Vendor document'
  }
}

function asOnboardingUploadedDocuments(value: unknown): OnboardingUploadedDocument[] {
  if (!Array.isArray(value)) return []
  return value.filter((row): row is OnboardingUploadedDocument => {
    if (!row || typeof row !== 'object') return false
    const rec = row as Record<string, unknown>
    return typeof rec.id === 'string' && typeof rec.fileName === 'string'
  })
}

function readLocalOnboardingUploadDocuments(
  landlordId: string,
): OnboardingUploadedDocument[] {
  try {
    const raw = window.localStorage.getItem(`ulo.landlordOnboarding.${landlordId}`)
    if (!raw) return []
    const parsed = JSON.parse(raw) as { formDraft?: { uploadDocuments?: unknown } }
    return asOnboardingUploadedDocuments(parsed.formDraft?.uploadDocuments)
  } catch {
    return []
  }
}

function mapOnboardingDoc(doc: OnboardingUploadedDocument): OrganizationDocument {
  const category = documentCategoryLabel(
    (doc.documentCategory ?? 'unknown') as OnboardingDocumentCategory,
  )
  const typeLabel = (doc.fileType || 'file').toUpperCase()
  const sizeLabel = formatFileSize(Number(doc.fileSize) || 0)
  const storagePath =
    typeof doc.storagePath === 'string' && doc.storagePath.trim()
      ? doc.storagePath.trim()
      : null
  const storageBucket =
    (typeof doc.storageBucket === 'string' && doc.storageBucket.trim()) ||
    (storagePath ? LANDLORD_ONBOARDING_DOCUMENTS_BUCKET : null)
  return {
    id: `onboarding:${doc.id}`,
    name: doc.fileName,
    meta: `${category} · ${typeLabel} · ${sizeLabel}`,
    updatedLabel: 'From fast-track onboarding',
    status: onboardingUploadStatus(doc.uploadStatus),
    source: 'onboarding',
    sourceLabel: 'Onboarding upload',
    storageBucket,
    storagePath,
    previewUrl: null,
  }
}

async function signDocumentPreviewUrl(
  bucket: string | null,
  path: string | null,
): Promise<string | null> {
  if (!supabase || !bucket?.trim() || !path?.trim()) return null
  const { data, error } = await supabase.storage
    .from(bucket.trim())
    .createSignedUrl(path.trim(), 3600)
  if (error || !data?.signedUrl) {
    console.warn('[organizationSettings] signed preview failed', bucket, path, error?.message)
    return null
  }
  return data.signedUrl
}

/** Open a compliance document preview (refreshes the signed URL when needed). */
export async function openOrganizationDocumentPreview(
  document: OrganizationDocument,
): Promise<{ ok: true } | { ok: false; error: string }> {
  let url = document.previewUrl
  if (!url) {
    url = await signDocumentPreviewUrl(document.storageBucket, document.storagePath)
  }
  if (!url) {
    return {
      ok: false,
      error: 'Preview is unavailable for this file. Re-upload it during onboarding if needed.',
    }
  }
  window.open(url, '_blank', 'noopener,noreferrer')
  return { ok: true }
}

/** Compliance docs from fast-track onboarding uploads + vendor verification files. */
export async function loadOrganizationComplianceDocuments(
  landlordId: string = getActiveLandlordId(),
): Promise<OrganizationDocument[]> {
  const byId = new Map<string, OrganizationDocument>()

  for (const doc of readLocalOnboardingUploadDocuments(landlordId)) {
    byId.set(`onboarding:${doc.id}`, mapOnboardingDoc(doc))
  }

  if (supabase) {
    const { data: onboarding } = await supabase
      .from('landlord_onboarding')
      .select('draft_state')
      .eq('landlord_id', landlordId)
      .maybeSingle()

    const draft = (onboarding?.draft_state ?? {}) as Record<string, unknown>
    const formDraft = (draft.formDraft ?? {}) as Record<string, unknown>
    for (const doc of asOnboardingUploadedDocuments(formDraft.uploadDocuments)) {
      byId.set(`onboarding:${doc.id}`, mapOnboardingDoc(doc))
    }

    const { data: vendorDocs } = await supabase
      .from('vendor_documents')
      .select(
        'id, kind, file_name, content_type, uploaded_at, storage_path, vendor_id, vendors(name)',
      )
      .eq('landlord_id', landlordId)
      .order('uploaded_at', { ascending: false })
      .limit(100)

    for (const row of vendorDocs ?? []) {
      const rec = row as Record<string, unknown>
      const id = typeof rec.id === 'string' ? rec.id : ''
      if (!id) continue
      const kind = typeof rec.kind === 'string' ? rec.kind : ''
      const fileName =
        (typeof rec.file_name === 'string' && rec.file_name.trim()) ||
        vendorKindLabel(kind)
      const vendorJoin = rec.vendors as { name?: string } | { name?: string }[] | null
      const vendorRow = Array.isArray(vendorJoin) ? vendorJoin[0] : vendorJoin
      const vendorName =
        vendorRow && typeof vendorRow.name === 'string' && vendorRow.name.trim()
          ? vendorRow.name.trim()
          : 'Vendor'
      const contentType =
        typeof rec.content_type === 'string' && rec.content_type.trim()
          ? rec.content_type.split('/').pop()?.toUpperCase() || 'FILE'
          : 'FILE'
      const uploadedAt =
        typeof rec.uploaded_at === 'string' ? rec.uploaded_at : null
      const storagePath =
        typeof rec.storage_path === 'string' && rec.storage_path.trim()
          ? rec.storage_path.trim()
          : null
      byId.set(`vendor:${id}`, {
        id: `vendor:${id}`,
        name: fileName,
        meta: `${vendorKindLabel(kind)} · ${vendorName} · ${contentType}`,
        updatedLabel: formatUpdatedLabel(uploadedAt),
        status: 'valid',
        source: 'vendor_verification',
        sourceLabel: 'Vendor onboarding',
        storageBucket: storagePath ? VENDOR_DOCUMENTS_BUCKET : null,
        storagePath,
        previewUrl: null,
      })
    }
  }

  const documents = Array.from(byId.values()).sort((a, b) => {
    if (a.source !== b.source) {
      return a.source === 'onboarding' ? -1 : 1
    }
    return a.name.localeCompare(b.name)
  })

  return Promise.all(
    documents.map(async (doc) => ({
      ...doc,
      previewUrl: await signDocumentPreviewUrl(doc.storageBucket, doc.storagePath),
    })),
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
