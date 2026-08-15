/**
 * Lease / move-in files from Fast Track, scoped to a tenant for their profile.
 */
import type { PortfolioDocumentExtractPayload } from '@/api/onboardingDocumentExtract'
import { getActiveLandlordId } from '@/lib/activeLandlord'
import {
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
import { isPlaceholderResidentEmail } from '@/lib/residentProfileDetail'

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

  const associations = collectReviewAssociations(review, identity)
  const matched = documents.filter((doc) => {
    if (!isLeasingDocumentCategory(doc.documentCategory)) return false
    if (associations.documentIds.has(doc.id)) return true
    if (associations.fileNames.has(doc.fileName.trim().toLowerCase())) return true
    return payloadMentionsResident(doc.extractedPayload, identity)
  })

  return [...matched].sort((left, right) => left.fileName.localeCompare(right.fileName))
}

export async function loadResidentLeaseDocuments(
  resident: ResidentLeaseDocumentMatchInput,
  landlordId: string = getActiveLandlordId(),
): Promise<OrganizationDocument[]> {
  const archive = await loadOnboardingDocumentArchive(landlordId)
  return collectResidentLeaseDocuments(archive.documents, resident, archive.review).map(
    organizationDocumentFromOnboarding,
  )
}
