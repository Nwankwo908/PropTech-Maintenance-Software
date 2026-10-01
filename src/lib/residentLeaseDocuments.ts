/**
 * Lease / move-in files from the Edit Resident rail, scoped to a tenant profile.
 * Stored separately from Fast Track formDraft so uploads never touch AI-review account.
 */
import type { PortfolioDocumentExtractPayload } from '@/api/onboardingDocumentExtract'
import { getActiveLandlordId } from '@/lib/activeLandlord'
import {
  createUploadedDocumentFromFile,
  isAcceptedUploadFile,
  persistOnboardingDocumentFile,
  extractedResidentIdentityMatch,
  type OnboardingDocumentCategory,
  type OnboardingExtractionReview,
  type OnboardingUploadedDocument,
} from '@/lib/onboardingDocumentUpload'
import {
  loadOnboardingDocumentArchive,
  organizationDocumentFromOnboarding,
  type OrganizationDocument,
} from '@/lib/organizationSettings'
import { recordActivityLog } from '@/lib/recordActivityLog'
import { isPlaceholderResidentEmail } from '@/lib/residentProfileDetail'
import { supabase } from '@/lib/supabase'
import { getErrorMessage } from '@/lib/errorMessage'

export type ResidentLeaseDocumentMatchInput = {
  fullName: string
  unit: string
  building: string
  phone?: string | null
  email?: string | null
}

const LEASING_DOCUMENT_CATEGORIES = new Set<OnboardingDocumentCategory>([
  'lease_agreement',
  'move_in_document',
])

/** Dedicated draft + local keys — never write formDraft.extractionReview. */
const DRAFT_LEASE_DOCS_KEY = 'residentLeaseDocuments'
const localLeaseDocsKey = (landlordId: string) => `ulo.residentLeaseDocs.${landlordId}`

function residentIdentity(
  resident: ResidentLeaseDocumentMatchInput,
): Pick<ResidentLeaseDocumentMatchInput, 'fullName' | 'unit' | 'building'> & {
  phone: string
  email: string
} {
  const email = (resident.email ?? '').trim()
  return {
    fullName: resident.fullName,
    unit: resident.unit,
    building: resident.building,
    phone: (resident.phone ?? '').trim(),
    email: isPlaceholderResidentEmail(email) ? '' : email,
  }
}

function splitSourceDocumentNames(value: string): string[] {
  return [...new Set(
    value
      .split(' · ')
      .map((name) => name.trim().toLowerCase())
      .filter(Boolean),
  )]
}

function parseUploadedDocumentId(extractedId: string): string | null {
  const match = /^(?:ext-res|ext-lease)-(.+)-\d+$/.exec(extractedId.trim())
  const id = match?.[1]?.trim()
  return id || null
}

function asUploadedDocuments(value: unknown): OnboardingUploadedDocument[] {
  if (!Array.isArray(value)) return []
  return value.filter((row): row is OnboardingUploadedDocument => {
    if (!row || typeof row !== 'object') return false
    const rec = row as Record<string, unknown>
    return typeof rec.id === 'string' && typeof rec.fileName === 'string'
  })
}

function payloadMentionsResident(
  payload: PortfolioDocumentExtractPayload | null | undefined,
  resident: ReturnType<typeof residentIdentity>,
): boolean {
  if (!payload) return false
  const people = [
    ...(payload.residents ?? []).map((row) => ({
      fullName: row.fullName,
      unit: row.unit,
      building: row.building,
      phone: row.phone ?? '',
      email: row.email ?? '',
    })),
    ...(payload.leases ?? []).map((row) => ({
      fullName: row.residentName,
      unit: row.unit,
      building: row.building,
      phone: '',
      email: '',
    })),
  ]
  return people.some((person) => extractedResidentIdentityMatch(person, resident))
}

function collectReviewAssociations(
  review: OnboardingExtractionReview | null | undefined,
  resident: ReturnType<typeof residentIdentity>,
): { fileNames: Set<string>; documentIds: Set<string> } {
  const fileNames = new Set<string>()
  const documentIds = new Set<string>()
  if (!review) return { fileNames, documentIds }

  const remember = (id: string, sourceDocumentName: string) => {
    const parsed = parseUploadedDocumentId(id)
    if (parsed) documentIds.add(parsed)
    for (const name of splitSourceDocumentNames(sourceDocumentName)) {
      fileNames.add(name)
    }
  }

  for (const row of review.residents ?? []) {
    if (
      extractedResidentIdentityMatch(
        {
          fullName: row.fullName,
          unit: row.unit,
          building: row.building,
          phone: row.phone ?? '',
          email: row.email ?? '',
        },
        resident,
      )
    ) {
      remember(row.id, row.sourceDocumentName)
    }
  }

  for (const row of review.leases ?? []) {
    if (
      extractedResidentIdentityMatch(
        {
          fullName: row.residentName,
          unit: row.unit,
          building: row.building,
          phone: '',
          email: '',
        },
        resident,
      )
    ) {
      remember(row.id, row.sourceDocumentName)
    }
  }

  return { fileNames, documentIds }
}

export function isLeasingDocumentCategory(
  category: OnboardingDocumentCategory | string | null | undefined,
): boolean {
  return LEASING_DOCUMENT_CATEGORIES.has((category ?? 'unknown') as OnboardingDocumentCategory)
}

export function collectResidentLeaseDocuments(
  documents: OnboardingUploadedDocument[],
  resident: ResidentLeaseDocumentMatchInput,
  review?: OnboardingExtractionReview | null,
): OnboardingUploadedDocument[] {
  const identity = residentIdentity(resident)
  if (!identity.fullName.trim()) return []

  const identities = [identity]
  if (identity.phone) {
    identities.push({ ...identity, phone: '' })
  }

  const matched = documents.filter((doc) => {
    if (!isLeasingDocumentCategory(doc.documentCategory)) return false
    return identities.some((person) => {
      const associations = collectReviewAssociations(review, person)
      if (associations.documentIds.has(doc.id)) return true
      if (associations.fileNames.has(doc.fileName.trim().toLowerCase())) return true
      return payloadMentionsResident(doc.extractedPayload, person)
    })
  })

  return [...matched].sort((left, right) => left.fileName.localeCompare(right.fileName))
}

function readLocalResidentLeaseDocuments(landlordId: string): OnboardingUploadedDocument[] {
  try {
    const raw = window.localStorage.getItem(localLeaseDocsKey(landlordId))
    if (!raw) return []
    return asUploadedDocuments(JSON.parse(raw))
  } catch {
    return []
  }
}

function writeLocalResidentLeaseDocuments(
  landlordId: string,
  documents: OnboardingUploadedDocument[],
) {
  try {
    window.localStorage.setItem(localLeaseDocsKey(landlordId), JSON.stringify(documents))
  } catch {
    // Best-effort local mirror.
  }
}

function isBlankAccountReviewStub(review: OnboardingExtractionReview): boolean {
  if (review.account?.contactName?.trim()) return false
  const hasPortfolio =
    (review.properties?.length ?? 0) > 0 ||
    (review.residents?.length ?? 0) > 0 ||
    (review.vendors?.length ?? 0) > 0 ||
    (review.units?.length ?? 0) > 0
  if (hasPortfolio) return false
  const leases = review.leases ?? []
  if (leases.length === 0) return true
  return leases.every(
    (row) =>
      /^ext-lease-.+-0$/.test(row.id) && !row.leaseStart?.trim() && !row.leaseEnd?.trim(),
  )
}

/**
 * Remove blank AI-review stubs left by the earlier upload bug without rewriting
 * the rest of onboarding local state (status, accountSetup, etc.).
 */
function clearBlankExtractionReviewStub(landlordId: string) {
  try {
    const key = `ulo.landlordOnboarding.${landlordId}`
    const raw = window.localStorage.getItem(key)
    if (!raw) return
    const parsed = JSON.parse(raw) as Record<string, unknown>
    const formDraft = (parsed.formDraft as Record<string, unknown> | undefined) ?? {}
    const review = formDraft.extractionReview as OnboardingExtractionReview | undefined
    if (!review || typeof review !== 'object' || !isBlankAccountReviewStub(review)) return
    const nextDraft = { ...formDraft }
    delete nextDraft.extractionReview
    window.localStorage.setItem(key, JSON.stringify({ ...parsed, formDraft: nextDraft }))
  } catch {
    // Best-effort.
  }
}

async function loadProfileLeaseDocuments(
  landlordId: string,
): Promise<OnboardingUploadedDocument[]> {
  const byId = new Map<string, OnboardingUploadedDocument>()
  for (const doc of readLocalResidentLeaseDocuments(landlordId)) {
    byId.set(doc.id, doc)
  }

  if (supabase) {
    const { data } = await supabase
      .from('landlord_onboarding')
      .select('draft_state')
      .eq('landlord_id', landlordId)
      .maybeSingle()
    const draft = (data?.draft_state ?? {}) as Record<string, unknown>
    for (const doc of asUploadedDocuments(draft[DRAFT_LEASE_DOCS_KEY])) {
      byId.set(doc.id, doc)
    }
  }

  return Array.from(byId.values())
}

export async function loadResidentLeaseDocuments(
  resident: ResidentLeaseDocumentMatchInput,
  landlordId: string = getActiveLandlordId(),
): Promise<OrganizationDocument[]> {
  clearBlankExtractionReviewStub(landlordId)
  const [archive, profileDocs] = await Promise.all([
    loadOnboardingDocumentArchive(landlordId),
    loadProfileLeaseDocuments(landlordId),
  ])
  const byId = new Map<string, OnboardingUploadedDocument>()
  for (const doc of archive.documents) byId.set(doc.id, doc)
  for (const doc of profileDocs) byId.set(doc.id, doc)
  return collectResidentLeaseDocuments(
    Array.from(byId.values()),
    resident,
    archive.review,
  ).map(organizationDocumentFromOnboarding)
}

function leasePayloadForResident(
  resident: ResidentLeaseDocumentMatchInput,
): PortfolioDocumentExtractPayload {
  const identity = residentIdentity(resident)
  return {
    properties: [],
    units: [],
    residents: [
      {
        fullName: identity.fullName,
        unit: identity.unit,
        building: identity.building,
        phone: identity.phone,
        email: identity.email,
        leaseStart: '',
        leaseEnd: '',
        monthlyRent: '',
        confidence: 1,
      },
    ],
    vendors: [],
    leases: [
      {
        residentName: identity.fullName,
        unit: identity.unit,
        building: identity.building,
        leaseStart: '',
        leaseEnd: '',
        rentAmount: '',
        securityDeposit: '',
        confidence: 1,
      },
    ],
    maintenanceIssues: [],
    financialRecords: [],
    imageLabels: [],
    warnings: [],
  }
}

/**
 * Upload lease files from Edit Resident. Persists under residentLeaseDocuments only —
 * never formDraft / extractionReview (that path caused "Enter your name.").
 */
export async function uploadResidentLeaseDocuments(params: {
  landlordId?: string
  residentId: string
  resident: ResidentLeaseDocumentMatchInput
  files: File[]
}): Promise<{ ok: true; uploaded: number } | { ok: false; error: string }> {
  const landlordId = (params.landlordId ?? getActiveLandlordId()).trim()
  const files = params.files.filter((file) => file.size > 0)
  if (!landlordId) return { ok: false, error: 'Missing landlord account.' }
  if (files.length === 0) return { ok: true, uploaded: 0 }
  if (!supabase) return { ok: false, error: 'Supabase is not configured.' }

  for (const file of files) {
    const accepted = isAcceptedUploadFile(file)
    if (!accepted.ok) return { ok: false, error: accepted.error }
  }

  clearBlankExtractionReviewStub(landlordId)

  const existingDocs = await loadProfileLeaseDocuments(landlordId)
  const byId = new Map(existingDocs.map((doc) => [doc.id, doc]))
  const uploadedDocs: OnboardingUploadedDocument[] = []

  for (const file of files) {
    const draft = createUploadedDocumentFromFile(file)
    draft.documentCategory = 'lease_agreement'
    draft.categoryGroup = 'resident'
    draft.processingLabel = 'Uploaded from resident profile'
    draft.extractedPayload = leasePayloadForResident(params.resident)

    const stored = await persistOnboardingDocumentFile(landlordId, draft.id, file)
    if ('error' in stored) {
      return { ok: false, error: stored.error }
    }

    const completed: OnboardingUploadedDocument = {
      ...draft,
      uploadStatus: 'complete',
      uploadProgress: 100,
      extractionStatus: 'complete',
      storageBucket: stored.storageBucket,
      storagePath: stored.storagePath,
      contentType: file.type || null,
      errorMessage: null,
    }
    byId.set(completed.id, completed)
    uploadedDocs.push(completed)
  }

  const documents = Array.from(byId.values())

  const { data: existing, error: loadError } = await supabase
    .from('landlord_onboarding')
    .select('draft_state')
    .eq('landlord_id', landlordId)
    .maybeSingle()

  if (loadError) {
    return { ok: false, error: getErrorMessage(loadError, 'Could not save lease documents.') }
  }

  const draftState = {
    ...((existing?.draft_state ?? {}) as Record<string, unknown>),
  }
  draftState[DRAFT_LEASE_DOCS_KEY] = documents

  // Heal any blank AI-review stub still sitting in formDraft from the earlier bug.
  const formDraft = (draftState.formDraft as Record<string, unknown> | undefined) ?? null
  if (formDraft?.extractionReview) {
    const review = formDraft.extractionReview as OnboardingExtractionReview
    if (isBlankAccountReviewStub(review)) {
      const cleaned = { ...formDraft }
      delete cleaned.extractionReview
      draftState.formDraft = cleaned
    }
  }

  const now = new Date().toISOString()
  if (existing) {
    const { error: saveError } = await supabase
      .from('landlord_onboarding')
      .update({
        draft_state: draftState,
        updated_at: now,
      })
      .eq('landlord_id', landlordId)

    if (saveError) {
      return { ok: false, error: getErrorMessage(saveError, 'Could not save lease documents.') }
    }
  } else {
    const { error: insertError } = await supabase.from('landlord_onboarding').insert({
      landlord_id: landlordId,
      draft_state: draftState,
      updated_at: now,
    })
    if (insertError) {
      return { ok: false, error: getErrorMessage(insertError, 'Could not save lease documents.') }
    }
  }

  writeLocalResidentLeaseDocuments(landlordId, documents)

  void recordActivityLog({
    landlordId,
    eventType: 'resident.lease_documents_uploaded',
    source: 'dashboard',
    actorType: 'landlord',
    residentId: params.residentId,
    metadata: {
      message: `Lease document${uploadedDocs.length === 1 ? '' : 's'} uploaded for ${params.resident.fullName.trim() || 'resident'}.`,
      fileCount: uploadedDocs.length,
      fileNames: uploadedDocs.map((doc) => doc.fileName),
    },
  })

  return { ok: true, uploaded: uploadedDocs.length }
}
