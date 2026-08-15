import { getActiveLandlordId } from '@/lib/activeLandlord'
import {
  DEFAULT_COMMUNICATION_STYLE,
  normalizeCommunicationStyle,
  type CommunicationStyle,
} from '@/lib/communicationStyle'
import {
  loadLandlordSettings,
  loadOrganizationWorkspaceSummary as loadWorkspaceSummaryFromSettings,
  saveLandlordOrganizationSettings,
} from '@/lib/landlordSettings'
import {
  documentCategoryLabel,
  formatFileSize,
  LANDLORD_ONBOARDING_DOCUMENTS_BUCKET,
  type OnboardingDocumentCategory,
  type OnboardingExtractionReview,
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
  contactName: string
  supportEmail: string
  phone: string
  backupContactName: string
  backupContactPhone: string
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
  legalName: '',
  displayName: '',
  contactName: '',
  supportEmail: '',
  phone: '',
  backupContactName: '',
  backupContactPhone: '',
  about: '',
  street: '',
  city: '',
  state: '',
  zip: '',
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

export async function loadOrganizationSettings(
  landlordId: string = getActiveLandlordId(),
): Promise<OrganizationSettingsForm> {
  const snapshot = await loadLandlordSettings(landlordId)
  return snapshot.organization
}

export async function saveOrganizationSettings(
  settings: OrganizationSettingsForm,
  landlordId: string = getActiveLandlordId(),
): Promise<void> {
  const result = await saveLandlordOrganizationSettings(settings, landlordId)
  if (!result.ok) {
    throw new Error(result.error ?? 'Could not save organization settings.')
  }
}

/** @deprecated Account settings no longer use localStorage. Kept for migration shims. */
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

function readLocalOnboardingFormDraft(
  landlordId: string,
): { uploadDocuments?: unknown; extractionReview?: unknown } | null {
  try {
    const raw = window.localStorage.getItem(`ulo.landlordOnboarding.${landlordId}`)
    if (!raw) return null
    const parsed = JSON.parse(raw) as { formDraft?: { uploadDocuments?: unknown; extractionReview?: unknown } }
    return parsed.formDraft ?? null
  } catch {
    return null
  }
}

function asOnboardingExtractionReview(value: unknown): OnboardingExtractionReview | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const rec = value as Partial<OnboardingExtractionReview>
  if (!Array.isArray(rec.residents) && !Array.isArray(rec.leases)) return null
  return rec as OnboardingExtractionReview
}

export type OnboardingDocumentArchive = {
  documents: OnboardingUploadedDocument[]
  review: OnboardingExtractionReview | null
}

/** Fast-track files + AI review from local draft and landlord_onboarding.draft_state. */
export async function loadOnboardingDocumentArchive(
  landlordId: string = getActiveLandlordId(),
): Promise<OnboardingDocumentArchive> {
  const byId = new Map<string, OnboardingUploadedDocument>()
  let review: OnboardingExtractionReview | null = null

  const localDraft = readLocalOnboardingFormDraft(landlordId)
  for (const doc of asOnboardingUploadedDocuments(localDraft?.uploadDocuments)) {
    byId.set(doc.id, doc)
  }
  review = asOnboardingExtractionReview(localDraft?.extractionReview)

  if (supabase) {
    const { data: onboarding } = await supabase
      .from('landlord_onboarding')
      .select('draft_state')
      .eq('landlord_id', landlordId)
      .maybeSingle()

    const draft = (onboarding?.draft_state ?? {}) as Record<string, unknown>
    const formDraft = (draft.formDraft ?? {}) as Record<string, unknown>
    for (const doc of asOnboardingUploadedDocuments(formDraft.uploadDocuments)) {
      byId.set(doc.id, doc)
    }
    review = asOnboardingExtractionReview(formDraft.extractionReview) ?? review
  }

  return { documents: Array.from(byId.values()), review }
}

export function organizationDocumentFromOnboarding(
  doc: OnboardingUploadedDocument,
): OrganizationDocument {
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

  const archive = await loadOnboardingDocumentArchive(landlordId)
  for (const doc of archive.documents) {
    byId.set(`onboarding:${doc.id}`, organizationDocumentFromOnboarding(doc))
  }

  if (supabase) {
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
  return loadWorkspaceSummaryFromSettings(landlordId)
}
