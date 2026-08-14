import { extractOnboardingDocument, type PortfolioDocumentExtractPayload } from '@/api/onboardingDocumentExtract'
import { getErrorMessage } from '@/lib/errorMessage'
/**
 * Onboarding fast-track — document upload, GPT-4o extraction, and review import.
 * File bytes are stored in the landlord-onboarding-documents bucket for preview.
 */
import type { OnboardingAccountSetup, OnboardingOccupancyStatus } from '@/lib/onboarding'
import {
  type MockExtractionReview,
} from '@/lib/onboardingMockExtraction'
import {
  emptyReviewManualAccount,
  normalizeReviewManualAccount,
  type OnboardingReviewManualAccount,
} from '@/lib/onboardingReviewManual'
import {
  inferOnboardingPropertyTypeFromUnitCount,
  resolveOnboardingPropertyType,
} from '@/lib/onboarding/propertyType'
import { normalizeBuildingKey } from '@/lib/propertyHealth'
import { supabase } from '@/lib/supabase'

export type { OnboardingReviewManualAccount } from '@/lib/onboardingReviewManual'

export const LANDLORD_ONBOARDING_DOCUMENTS_BUCKET = 'landlord-onboarding-documents'

export type UploadFileStatus =
  | 'waiting'
  | 'uploading'
  | 'scanning'
  | 'extracting'
  | 'digitizing'
  | 'handwriting'
  | 'ready_for_review'
  | 'needs_attention'
  | 'failed'

export type DocumentCategoryGroup = 'property' | 'resident' | 'vendor' | 'financial'

export type OnboardingDocumentCategory =
  | 'property_deed'
  | 'property_tax'
  | 'purchase_agreement'
  | 'inspection_report'
  | 'lease_agreement'
  | 'move_in_document'
  | 'resident_roster'
  | 'vendor_contract'
  | 'vendor_invoice'
  | 'w9_form'
  | 'insurance_certificate'
  | 'rent_roll'
  | 'property_statement'
  | 'expense_report'
  | 'unknown'

export type OnboardingUploadedDocument = {
  id: string
  fileName: string
  fileType: string
  fileSize: number
  documentCategory: OnboardingDocumentCategory
  categoryGroup: DocumentCategoryGroup
  uploadStatus: UploadFileStatus
  uploadProgress: number
  extractionStatus: UploadFileStatus
  processingLabel: string | null
  errorMessage: string | null
  imageLabels: string[]
  hasHandwriting: boolean
  /** Private storage object for Org Settings preview (set after upload). */
  storageBucket?: string | null
  storagePath?: string | null
  contentType?: string | null
  /** GPT extraction from onboarding-document-extract (per file). */
  extractedPayload?: PortfolioDocumentExtractPayload | null
}

export type ExtractedLeaseInfo = {
  id: string
  residentName: string
  unit: string
  building: string
  leaseStart: string
  leaseEnd: string
  rentAmount: string
  securityDeposit: string
  sourceDocumentName: string
  confidence: number
  selected: boolean
  needsReview: boolean
}

export type ExtractedFinancialRecord = {
  id: string
  recordType: string
  description: string
  amount: string
  period: string
  sourceDocumentName: string
  confidence: number
  selected: boolean
  needsReview: boolean
}

export type ExtractedReviewItem = {
  id: string
  uploadedDocumentId: string
  sourceDocumentName: string
  dataType: string
  label: string
  value: string
  confidence: number
  sourcePage?: number
  includeInImport: boolean
  needsReview: boolean
  imageTags?: string[]
}

export type OnboardingExtractedProperty = {
  id: string
  name: string
  address: string
  /** Street line when address is a full line; city/state/zip collected manually. */
  city: string
  state: string
  zipCode: string
  propertyType: string
  unitCount: number
  unitLabels: string
  propertyManagerName: string
  propertyManagerPhone: string
  sourceDocumentName: string
  confidence: number
  selected: boolean
  needsReview: boolean
}

export type OnboardingExtractedUnit = {
  id: string
  label: string
  building: string
  sourceDocumentName: string
  confidence: number
  selected: boolean
}

export type OnboardingExtractedResident = {
  id: string
  fullName: string
  unit: string
  building: string
  phone: string
  email: string
  leaseStart: string
  leaseEnd: string
  monthlyRent: string
  rentDueDay: string
  occupancyStatus: OnboardingOccupancyStatus
  maintenanceResponsibilitiesClause: string
  sourceDocumentName: string
  confidence: number
  selected: boolean
  needsReview: boolean
}

export type OnboardingExtractedVendor = {
  id: string
  name: string
  category: string | null
  phone: string
  email: string
  preferredEmergency: boolean
  sourceDocumentName: string
  confidence: number
  selected: boolean
  needsReview: boolean
}

export type OnboardingExtractedMaintenanceIssue = {
  id: string
  unit: string
  building: string
  category: string
  description: string
  priority: string
  sourceDocumentName: string
  confidence: number
  selected: boolean
  needsReview: boolean
  imageTags?: string[]
}

export type OnboardingExtractionReview = {
  /** Manual account fields — required on Fast Track even when docs fill the portfolio. */
  account: OnboardingReviewManualAccount
  properties: OnboardingExtractedProperty[]
  units: OnboardingExtractedUnit[]
  residents: OnboardingExtractedResident[]
  leases: ExtractedLeaseInfo[]
  vendors: OnboardingExtractedVendor[]
  maintenanceIssues: OnboardingExtractedMaintenanceIssue[]
  financialRecords: ExtractedFinancialRecord[]
  needsReview: ExtractedReviewItem[]
  imageLabels: ExtractedReviewItem[]
}

export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024

export const ACCEPTED_UPLOAD_EXTENSIONS = [
  '.pdf',
  '.doc',
  '.docx',
  '.xls',
  '.xlsx',
  '.csv',
  '.jpg',
  '.jpeg',
  '.png',
  '.heic',
  '.webp',
  '.tif',
  '.tiff',
] as const

export const ACCEPTED_UPLOAD_MIME = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/csv',
  'image/jpeg',
  'image/png',
  'image/heic',
  'image/webp',
  'image/tiff',
].join(',')

export const UPLOAD_STATUS_LABELS: Record<UploadFileStatus, string> = {
  waiting: 'Waiting',
  uploading: 'Uploading',
  scanning: 'Scanning',
  extracting: 'Extracting',
  digitizing: 'Digitizing document',
  handwriting: 'Reading handwritten notes',
  ready_for_review: 'Ready for review',
  needs_attention: 'Needs attention',
  failed: 'Failed',
}

export const DOCUMENT_CATEGORY_GROUPS: {
  group: DocumentCategoryGroup
  label: string
  categories: { value: OnboardingDocumentCategory; label: string }[]
}[] = [
  {
    group: 'property',
    label: 'Property Documents',
    categories: [
      { value: 'property_deed', label: 'Property Deeds' },
      { value: 'property_tax', label: 'Property Tax Records' },
      { value: 'purchase_agreement', label: 'Purchase Agreements' },
      { value: 'inspection_report', label: 'Inspection Reports' },
    ],
  },
  {
    group: 'resident',
    label: 'Resident Documents',
    categories: [
      { value: 'lease_agreement', label: 'Lease Agreements' },
      { value: 'move_in_document', label: 'Move-In Documents' },
      { value: 'resident_roster', label: 'Resident Rosters' },
    ],
  },
  {
    group: 'vendor',
    label: 'Vendor Documents',
    categories: [
      { value: 'vendor_contract', label: 'Vendor Contracts' },
      { value: 'vendor_invoice', label: 'Invoices' },
      { value: 'w9_form', label: 'W-9 Forms' },
      { value: 'insurance_certificate', label: 'Insurance Certificates' },
    ],
  },
  {
    group: 'financial',
    label: 'Financial Documents',
    categories: [
      { value: 'rent_roll', label: 'Rent Rolls' },
      { value: 'property_statement', label: 'Property Statements' },
      { value: 'expense_report', label: 'Expense Reports' },
    ],
  },
]

const CATEGORY_GROUP_MAP: Record<OnboardingDocumentCategory, DocumentCategoryGroup> = {
  property_deed: 'property',
  property_tax: 'property',
  purchase_agreement: 'property',
  inspection_report: 'property',
  lease_agreement: 'resident',
  move_in_document: 'resident',
  resident_roster: 'resident',
  vendor_contract: 'vendor',
  vendor_invoice: 'vendor',
  w9_form: 'vendor',
  insurance_certificate: 'vendor',
  rent_roll: 'financial',
  property_statement: 'financial',
  expense_report: 'financial',
  unknown: 'property',
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

function fileExtension(fileName: string): string {
  const index = fileName.lastIndexOf('.')
  return index >= 0 ? fileName.slice(index).toLowerCase() : ''
}

function isImageExtension(ext: string): boolean {
  return ['.jpg', '.jpeg', '.png', '.heic', '.webp', '.tif', '.tiff'].includes(ext)
}

function isScannedDocument(ext: string): boolean {
  return ['.tif', '.tiff', '.pdf'].includes(ext)
}

export function isAcceptedUploadFile(file: File): { ok: true } | { ok: false; error: string } {
  if (file.size > MAX_UPLOAD_BYTES) {
    return { ok: false, error: `${file.name} is too large. Max 20MB per file.` }
  }
  const ext = fileExtension(file.name)
  if (!ACCEPTED_UPLOAD_EXTENSIONS.includes(ext as (typeof ACCEPTED_UPLOAD_EXTENSIONS)[number])) {
    return {
      ok: false,
      error: `${file.name} is not supported. Use PDF, Word, spreadsheet, or image files.`,
    }
  }
  return { ok: true }
}

export function inferDocumentCategory(fileName: string): OnboardingDocumentCategory {
  const lower = fileName.toLowerCase()
  if (/lease|rental|tenancy|occupancy.?agreement|housing.?agreement/.test(lower)) {
    return 'lease_agreement'
  }
  if (/rent.?roll|roster|tenant/.test(lower)) return 'rent_roll'
  if (/inspection|walkthrough/.test(lower)) return 'inspection_report'
  if (/invoice|bill/.test(lower)) return 'vendor_invoice'
  if (/w-?9|w9/.test(lower)) return 'w9_form'
  if (/insurance|certificate|coi/.test(lower)) return 'insurance_certificate'
  if (/deed|title/.test(lower)) return 'property_deed'
  if (/tax/.test(lower)) return 'property_tax'
  if (/purchase|closing/.test(lower)) return 'purchase_agreement'
  if (/move.?in|checklist/.test(lower)) return 'move_in_document'
  if (/vendor|contract/.test(lower)) return 'vendor_contract'
  if (/statement|p&l|profit/.test(lower)) return 'property_statement'
  if (/expense|receipt/.test(lower)) return 'expense_report'
  if (/\.(jpg|jpeg|png|heic|webp|tif|tiff)$/.test(lower)) return 'inspection_report'
  if (/\.(xls|xlsx|csv)$/.test(lower)) return 'rent_roll'
  return 'unknown'
}

export function createUploadedDocumentFromFile(file: File): OnboardingUploadedDocument {
  const documentCategory = inferDocumentCategory(file.name)
  const ext = fileExtension(file.name)
  return {
    id: `doc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    fileName: file.name,
    fileType: ext.replace('.', '') || 'file',
    fileSize: file.size,
    documentCategory,
    categoryGroup: CATEGORY_GROUP_MAP[documentCategory],
    uploadStatus: 'waiting',
    uploadProgress: 0,
    extractionStatus: 'waiting',
    processingLabel: UPLOAD_STATUS_LABELS.waiting,
    errorMessage: null,
    imageLabels: [],
    hasHandwriting: /move.?in|inspection|checklist|signed|handwritten/i.test(file.name),
    storageBucket: null,
    storagePath: null,
    contentType: file.type || null,
  }
}

function safeStorageFileName(fileName: string): string {
  const trimmed = fileName.trim() || 'document'
  return trimmed.replace(/[^\w.\- ()]+/g, '_').slice(0, 120)
}

/** Persist onboarding file bytes so Org Settings can open a signed preview later. */
export async function persistOnboardingDocumentFile(
  landlordId: string,
  docId: string,
  file: File,
): Promise<{ storageBucket: string; storagePath: string } | { error: string }> {
  if (!supabase) return { error: 'Storage unavailable' }
  if (!landlordId.trim() || !docId.trim()) return { error: 'Missing landlord or document id' }

  const storageBucket = LANDLORD_ONBOARDING_DOCUMENTS_BUCKET
  const storagePath = `${landlordId}/${docId}/${safeStorageFileName(file.name)}`
  const { error } = await supabase.storage.from(storageBucket).upload(storagePath, file, {
    contentType: file.type || 'application/octet-stream',
    upsert: true,
  })
  if (error) {
    console.warn('[onboardingDocumentUpload] storage upload failed', error.message)
    return { error: getErrorMessage(error, 'Upload failed. Please try again.') }
  }
  return { storageBucket, storagePath }
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function documentCategoryLabel(category: OnboardingDocumentCategory): string {
  for (const group of DOCUMENT_CATEGORY_GROUPS) {
    const match = group.categories.find((item) => item.value === category)
    if (match) return match.label
  }
  return 'Document'
}

async function fileToBase64(file: File): Promise<string> {
  const buffer = await file.arrayBuffer()
  const bytes = new Uint8Array(buffer)
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

/** Real document pipeline — upload progress UI, then GPT-4o extract via edge function. */
export async function runDocumentProcessing(
  doc: OnboardingUploadedDocument,
  file: File | null,
  onUpdate: (updated: OnboardingUploadedDocument) => void,
  signal?: AbortSignal,
): Promise<OnboardingUploadedDocument> {
  let current = {
    ...doc,
    uploadStatus: 'uploading' as UploadFileStatus,
    processingLabel: UPLOAD_STATUS_LABELS.uploading,
  }

  for (let progress = 0; progress <= 100; progress += 25) {
    if (signal?.aborted) return current
    current = { ...current, uploadProgress: progress }
    onUpdate(current)
    await sleep(80)
  }

  const stages: Array<{ status: UploadFileStatus; label: string; ms: number }> = [
    { status: 'digitizing', label: UPLOAD_STATUS_LABELS.digitizing, ms: 400 },
    { status: 'scanning', label: UPLOAD_STATUS_LABELS.scanning, ms: 500 },
    { status: 'extracting', label: UPLOAD_STATUS_LABELS.extracting, ms: 300 },
  ]

  for (const stage of stages) {
    if (signal?.aborted) return current
    current = {
      ...current,
      uploadStatus: stage.status,
      extractionStatus: stage.status,
      processingLabel: stage.label,
    }
    onUpdate(current)
    await sleep(stage.ms)
  }

  if (doc.hasHandwriting) {
    if (signal?.aborted) return current
    current = {
      ...current,
      uploadStatus: 'handwriting',
      extractionStatus: 'handwriting',
      processingLabel: UPLOAD_STATUS_LABELS.handwriting,
    }
    onUpdate(current)
    await sleep(400)
  }

  try {
    const fileBase64 =
      !doc.storagePath && file ? await fileToBase64(file) : undefined

    const result = await extractOnboardingDocument({
      docId: doc.id,
      fileName: doc.fileName,
      documentCategory: doc.documentCategory,
      storageBucket: doc.storageBucket,
      storagePath: doc.storagePath,
      contentType: doc.contentType,
      fileBase64,
    })

    const warning = result.extracted.warnings[0] ?? null
    const needsAttention =
      result.needsAttention ||
      doc.documentCategory === 'unknown' ||
      (!result.hasData && !warning)

    current = {
      ...current,
      extractedPayload: result.extracted,
      imageLabels: result.extracted.imageLabels,
      uploadStatus: needsAttention ? 'needs_attention' : 'ready_for_review',
      extractionStatus: needsAttention ? 'needs_attention' : 'ready_for_review',
      processingLabel:
        UPLOAD_STATUS_LABELS[needsAttention ? 'needs_attention' : 'ready_for_review'],
      uploadProgress: 100,
      errorMessage: needsAttention ? warning : null,
    }
  } catch (err) {
    current = {
      ...current,
      uploadStatus: 'failed',
      extractionStatus: 'failed',
      processingLabel: UPLOAD_STATUS_LABELS.failed,
      uploadProgress: 100,
      errorMessage: getErrorMessage(
        err,
        'Could not extract this document. Try again or use PDF, CSV, or Excel.',
      ),
    }
  }

  onUpdate(current)
  return current
}

/** @deprecated Use runDocumentProcessing — kept for tests. */
export async function runMockDocumentProcessing(
  doc: OnboardingUploadedDocument,
  onUpdate: (updated: OnboardingUploadedDocument) => void,
  signal?: AbortSignal,
): Promise<OnboardingUploadedDocument> {
  return runDocumentProcessing(doc, null, onUpdate, signal)
}

export function allDocumentsReadyForReview(docs: OnboardingUploadedDocument[]): boolean {
  if (docs.length === 0) return false
  return docs.every(
    (doc) =>
      doc.uploadStatus === 'ready_for_review' ||
      doc.uploadStatus === 'needs_attention' ||
      doc.uploadStatus === 'failed',
  )
}

export function anyDocumentProcessing(docs: OnboardingUploadedDocument[]): boolean {
  return docs.some(
    (doc) =>
      doc.uploadStatus === 'waiting' ||
      doc.uploadStatus === 'uploading' ||
      doc.uploadStatus === 'scanning' ||
      doc.uploadStatus === 'extracting' ||
      doc.uploadStatus === 'digitizing' ||
      doc.uploadStatus === 'handwriting',
  )
}

function preferFullerPersonName(primary: string, secondary: string): string {
  const left = primary.trim()
  const right = secondary.trim()
  if (!left) return right
  if (!right) return left
  const leftWords = left.split(/\s+/).filter(Boolean).length
  const rightWords = right.split(/\s+/).filter(Boolean).length
  if (rightWords > leftWords) return right
  if (leftWords > rightWords) return left
  return right.length > left.length ? right : left
}

function residentMatchKey(unit: string, building: string): string {
  return `${building.trim().toLowerCase()}|${unit.trim().toLowerCase()}`
}

function personNamesMatch(left: string, right: string): boolean {
  const a = left.trim().toLowerCase()
  const b = right.trim().toLowerCase()
  return Boolean(a && b && a === b)
}

export function formatExtractedUnitPlacement(building: string, unit: string): string {
  const buildingLabel = building.trim()
  const unitLabel = unit.trim()
  if (buildingLabel && unitLabel) return `${buildingLabel} · Unit ${unitLabel}`
  if (unitLabel) return `Unit ${unitLabel}`
  if (buildingLabel) return buildingLabel
  return 'Unit not linked'
}

function defaultExtractedBuilding(properties: OnboardingExtractedProperty[]): string {
  if (properties.length !== 1) return ''
  const property = properties[0]
  if (!property) return ''
  return property.name.trim() || property.address.trim()
}

function enrichExtractedResidentPlacement(
  residents: OnboardingExtractedResident[],
  leases: ExtractedLeaseInfo[],
  units: OnboardingExtractedUnit[],
  properties: OnboardingExtractedProperty[],
): { residents: OnboardingExtractedResident[]; leases: ExtractedLeaseInfo[] } {
  const fallbackBuilding = defaultExtractedBuilding(properties)

  const enrichedResidents = residents.map((resident) => {
    let unit = resident.unit.trim()
    let building = resident.building.trim()

    const leaseByKey = leases.find(
      (lease) =>
        (lease.unit.trim() || lease.building.trim()) &&
        residentMatchKey(lease.unit, lease.building) === residentMatchKey(resident.unit, resident.building),
    )
    const leaseByName = leases.find((lease) => personNamesMatch(lease.residentName, resident.fullName))
    const leaseMatch = leaseByKey ?? leaseByName
    if (leaseMatch) {
      unit = unit || leaseMatch.unit.trim()
      building = building || leaseMatch.building.trim()
    }

    if (unit && !building) {
      const unitRow = units.find((row) => row.label.trim().toLowerCase() === unit.toLowerCase())
      if (unitRow?.building.trim()) {
        building = unitRow.building.trim()
      }
    }

    if (!building && fallbackBuilding) {
      building = fallbackBuilding
    }

    const missingPlacement = Boolean(resident.fullName.trim() && !unit.trim())
    return {
      ...resident,
      unit,
      building,
      needsReview: resident.needsReview || missingPlacement,
    }
  })

  const enrichedLeases = leases.map((lease) => {
    let unit = lease.unit.trim()
    let building = lease.building.trim()

    const residentByKey = enrichedResidents.find(
      (resident) =>
        (resident.unit.trim() || resident.building.trim()) &&
        residentMatchKey(resident.unit, resident.building) === residentMatchKey(lease.unit, lease.building),
    )
    const residentByName = enrichedResidents.find((resident) =>
      personNamesMatch(resident.fullName, lease.residentName),
    )
    const residentMatch = residentByKey ?? residentByName
    if (residentMatch) {
      unit = unit || residentMatch.unit.trim()
      building = building || residentMatch.building.trim()
    }

    if (unit && !building) {
      const unitRow = units.find((row) => row.label.trim().toLowerCase() === unit.toLowerCase())
      if (unitRow?.building.trim()) {
        building = unitRow.building.trim()
      }
    }

    if (!building && fallbackBuilding) {
      building = fallbackBuilding
    }

    return {
      ...lease,
      unit,
      building,
      needsReview: lease.needsReview || Boolean(lease.residentName.trim() && !unit.trim()),
    }
  })

  return { residents: enrichedResidents, leases: enrichedLeases }
}

function collectDerivedUnitCandidates(
  residents: OnboardingExtractedResident[],
  leases: ExtractedLeaseInfo[],
): Array<{
  label: string
  building: string
  sourceDocumentName: string
  confidence: number
}> {
  const candidates: Array<{
    label: string
    building: string
    sourceDocumentName: string
    confidence: number
  }> = []

  for (const resident of residents) {
    const label = resident.unit.trim()
    if (!label) continue
    candidates.push({
      label,
      building: resident.building.trim(),
      sourceDocumentName: resident.sourceDocumentName,
      confidence: resident.confidence,
    })
  }

  for (const lease of leases) {
    const label = lease.unit.trim()
    if (!label) continue
    candidates.push({
      label,
      building: lease.building.trim(),
      sourceDocumentName: lease.sourceDocumentName,
      confidence: lease.confidence,
    })
  }

  return candidates
}

/** Build and enrich unit inventory from explicit unit rows plus tenant/lease placement. */
export function enrichExtractedUnits(
  units: OnboardingExtractedUnit[],
  residents: OnboardingExtractedResident[],
  leases: ExtractedLeaseInfo[],
  properties: OnboardingExtractedProperty[],
): OnboardingExtractedUnit[] {
  const fallbackBuilding = defaultExtractedBuilding(properties)
  const merged = new Map<string, OnboardingExtractedUnit>()

  const remember = (row: OnboardingExtractedUnit) => {
    const label = row.label.trim()
    if (!label) return
    const building = row.building.trim() || fallbackBuilding
    const key = residentMatchKey(label, building)
    const existing = merged.get(key)
    if (!existing) {
      merged.set(key, { ...row, label, building })
      return
    }
    merged.set(key, {
      ...existing,
      building: existing.building.trim() || building,
      confidence: Math.max(existing.confidence, row.confidence),
      selected: existing.selected || row.selected,
    })
  }

  for (const unit of units) {
    remember(unit)
  }

  let derivedIndex = 0
  for (const candidate of collectDerivedUnitCandidates(residents, leases)) {
    const building = candidate.building.trim() || fallbackBuilding
    const key = residentMatchKey(candidate.label, building)
    if (merged.has(key)) {
      const existing = merged.get(key)!
      if (!existing.building.trim() && building) {
        merged.set(key, { ...existing, building })
      }
      continue
    }

    const labelMatch = [...merged.values()].find(
      (row) => row.label.trim().toLowerCase() === candidate.label.toLowerCase(),
    )
    if (labelMatch) {
      const nextBuilding = labelMatch.building.trim() || building
      merged.delete(residentMatchKey(labelMatch.label, labelMatch.building))
      merged.set(residentMatchKey(labelMatch.label, nextBuilding), {
        ...labelMatch,
        building: nextBuilding,
        confidence: Math.max(labelMatch.confidence, candidate.confidence),
      })
      continue
    }

    derivedIndex += 1
    remember({
      id: `ext-unit-derived-${derivedIndex}`,
      label: candidate.label,
      building,
      sourceDocumentName: candidate.sourceDocumentName,
      confidence: candidate.confidence,
      selected: Boolean(candidate.label.trim()),
    })
  }

  return [...merged.values()].sort((left, right) => {
    const buildingSort = left.building.localeCompare(right.building)
    if (buildingSort !== 0) return buildingSort
    return left.label.localeCompare(right.label, undefined, { numeric: true })
  })
}

function normalizePropertyIdentityKey(name: string, address: string): string {
  const label = name.trim() || address.trim()
  return label.toLowerCase().replace(/\s+/g, ' ')
}

function looksLikeStreetAddress(value: string): boolean {
  const trimmed = value.trim()
  return /^\d+\s+\S/.test(trimmed) || /\b\d{5}(?:-\d{4})?\b/.test(trimmed)
}

function splitPropertyCandidate(building: string): { name: string; address: string } {
  const trimmed = building.trim()
  if (!trimmed) return { name: '', address: '' }
  if (looksLikeStreetAddress(trimmed)) {
    return { name: trimmed, address: trimmed }
  }
  return { name: trimmed, address: '' }
}

function propertyMatchesIdentity(
  property: OnboardingExtractedProperty,
  identityKey: string,
): boolean {
  if (!identityKey) return false
  return (
    normalizePropertyIdentityKey(property.name, property.address) === identityKey ||
    normalizePropertyIdentityKey(property.address, property.name) === identityKey
  )
}

function countUnitsForBuilding(
  building: string,
  residents: OnboardingExtractedResident[],
  leases: ExtractedLeaseInfo[],
  units: OnboardingExtractedUnit[],
): number {
  const buildingKey = normalizeBuildingKey(building).toLowerCase()
  if (!buildingKey || buildingKey === 'portfolio') return 0
  const labels = new Set<string>()
  for (const resident of residents) {
    if (normalizeBuildingKey(resident.building).toLowerCase() !== buildingKey) continue
    const label = resident.unit.trim().toLowerCase()
    if (label) labels.add(label)
  }
  for (const lease of leases) {
    if (normalizeBuildingKey(lease.building).toLowerCase() !== buildingKey) continue
    const label = lease.unit.trim().toLowerCase()
    if (label) labels.add(label)
  }
  for (const unit of units) {
    if (normalizeBuildingKey(unit.building).toLowerCase() !== buildingKey) continue
    const label = unit.label.trim().toLowerCase()
    if (label) labels.add(label)
  }
  return labels.size
}

/** Build property rows from rent-roll building names when GPT only filled tenant rows. */
export function enrichExtractedProperties(
  properties: OnboardingExtractedProperty[],
  residents: OnboardingExtractedResident[],
  leases: ExtractedLeaseInfo[],
  units: OnboardingExtractedUnit[],
): OnboardingExtractedProperty[] {
  const merged = new Map<string, OnboardingExtractedProperty>()

  const remember = (row: OnboardingExtractedProperty) => {
    const key = normalizePropertyIdentityKey(row.name, row.address)
    if (!key) return
    const existing = merged.get(key)
    if (!existing) {
      merged.set(key, row)
      return
    }
    merged.set(key, {
      ...existing,
      name: existing.name.trim() || row.name,
      address: existing.address.trim() || row.address,
      city: existing.city.trim() || row.city,
      state: existing.state.trim() || row.state,
      zipCode: existing.zipCode.trim() || row.zipCode,
      propertyType: resolveOnboardingPropertyType(existing.propertyType || row.propertyType),
      unitCount: Math.max(existing.unitCount, row.unitCount),
      confidence: Math.max(existing.confidence, row.confidence),
      selected: existing.selected && row.selected,
      needsReview: existing.needsReview || row.needsReview,
    })
  }

  for (const property of properties) {
    remember(property)
  }

  const buildingMeta = new Map<
    string,
    { building: string; sourceDocumentName: string; confidence: number }
  >()

  const noteBuilding = (building: string, sourceDocumentName: string, confidence: number) => {
    const trimmed = building.trim()
    if (!trimmed) return
    const key = normalizePropertyIdentityKey(trimmed, trimmed)
    const existing = buildingMeta.get(key)
    if (!existing || confidence > existing.confidence) {
      buildingMeta.set(key, { building: trimmed, sourceDocumentName, confidence })
    }
  }

  for (const resident of residents) {
    noteBuilding(resident.building, resident.sourceDocumentName, resident.confidence)
  }
  for (const lease of leases) {
    noteBuilding(lease.building, lease.sourceDocumentName, lease.confidence)
  }
  for (const unit of units) {
    noteBuilding(unit.building, unit.sourceDocumentName, unit.confidence)
  }

  let derivedIndex = 0
  for (const [identityKey, meta] of buildingMeta) {
    const existing = [...merged.values()].find((property) => propertyMatchesIdentity(property, identityKey))
    const unitCount = countUnitsForBuilding(meta.building, residents, leases, units)

    if (existing) {
      if (unitCount > existing.unitCount) {
        remember({ ...existing, unitCount })
      }
      continue
    }

    const { name, address } = splitPropertyCandidate(meta.building)
    if (!name && !address) continue

    derivedIndex += 1
    const needsReview = true
    remember({
      id: `ext-prop-derived-${derivedIndex}`,
      name: name || address,
      address,
      city: '',
      state: '',
      zipCode: '',
      propertyType: inferOnboardingPropertyTypeFromUnitCount(unitCount),
      unitCount,
      unitLabels: '',
      propertyManagerName: '',
      propertyManagerPhone: '',
      sourceDocumentName: meta.sourceDocumentName,
      confidence: meta.confidence,
      selected: true,
      needsReview,
    })
  }

  return [...merged.values()].sort((left, right) => left.name.localeCompare(right.name))
}

function finalizeExtractionReviewEntities(input: {
  properties: OnboardingExtractedProperty[]
  units: OnboardingExtractedUnit[]
  residents: OnboardingExtractedResident[]
  leases: ExtractedLeaseInfo[]
}): {
  properties: OnboardingExtractedProperty[]
  units: OnboardingExtractedUnit[]
  residents: OnboardingExtractedResident[]
  leases: ExtractedLeaseInfo[]
} {
  let placement = enrichExtractedResidentPlacement(
    input.residents,
    input.leases,
    input.units,
    input.properties,
  )
  let residents = enrichExtractedPersonNames(placement.residents, placement.leases)
  let leases = enrichExtractedLeaseNames(residents, placement.leases)
  let properties = enrichExtractedProperties(input.properties, residents, leases, input.units)

  placement = enrichExtractedResidentPlacement(residents, leases, input.units, properties)
  residents = placement.residents
  leases = placement.leases

  const units = enrichExtractedUnits(input.units, residents, leases, properties)
  properties = enrichExtractedProperties(properties, residents, leases, units)

  return { properties, units, residents, leases }
}

function mergeExtractedDocuments(
  documents: OnboardingUploadedDocument[],
  accountSeed?: Partial<OnboardingAccountSetup> | null,
): OnboardingExtractionReview {
  const account = emptyReviewManualAccount(accountSeed)
  const payloads = documents
    .map((doc) => ({ doc, payload: doc.extractedPayload }))
    .filter((row): row is { doc: OnboardingUploadedDocument; payload: PortfolioDocumentExtractPayload } =>
      Boolean(row.payload),
    )

  if (payloads.length === 0) {
    return emptyExtractionReview(accountSeed)
  }

  const properties: OnboardingExtractedProperty[] = []
  const units: OnboardingExtractedUnit[] = []
  const residents: OnboardingExtractedResident[] = []
  const leases: ExtractedLeaseInfo[] = []
  const vendors: OnboardingExtractedVendor[] = []
  const maintenanceIssues: OnboardingExtractedMaintenanceIssue[] = []
  const financialRecords: ExtractedFinancialRecord[] = []
  const needsReview: ExtractedReviewItem[] = []
  const imageLabels: ExtractedReviewItem[] = []

  for (const { doc, payload } of payloads) {
    const source = doc.fileName

    payload.properties.forEach((item, index) => {
      const needsReviewRow = item.confidence < 75 || !item.city || !item.state
      properties.push({
        id: `ext-prop-${doc.id}-${index}`,
        name: item.name,
        address: item.streetAddress,
        city: item.city,
        state: item.state,
        zipCode: item.zipCode,
        propertyType: resolveOnboardingPropertyType(item.propertyType),
        unitCount: item.unitCount,
        unitLabels: '',
        propertyManagerName: '',
        propertyManagerPhone: '',
        sourceDocumentName: source,
        confidence: item.confidence,
        selected: Boolean(item.name.trim() || item.streetAddress.trim()),
        needsReview: needsReviewRow,
      })
    })

    payload.units.forEach((item, index) => {
      units.push({
        id: `ext-unit-${doc.id}-${index}`,
        label: item.label,
        building: item.building,
        sourceDocumentName: source,
        confidence: item.confidence,
        selected: Boolean(item.label.trim()),
      })
    })

    payload.residents.forEach((item, index) => {
      const needsReviewRow = item.confidence < 75
      const leaseMatch = payload.leases.find(
        (lease) => residentMatchKey(lease.unit, lease.building) === residentMatchKey(item.unit, item.building),
      )
      const fullName = preferFullerPersonName(item.fullName, leaseMatch?.residentName ?? '')
      residents.push({
        id: `ext-res-${doc.id}-${index}`,
        fullName,
        unit: item.unit,
        building: item.building,
        phone: item.phone,
        email: item.email,
        leaseStart: item.leaseStart,
        leaseEnd: item.leaseEnd,
        monthlyRent: item.monthlyRent,
        rentDueDay: '',
        occupancyStatus: 'active',
        maintenanceResponsibilitiesClause: '',
        sourceDocumentName: source,
        confidence: item.confidence,
        selected: Boolean(fullName.trim()),
        needsReview: needsReviewRow,
      })
    })

    payload.leases.forEach((item, index) => {
      const residentMatch = payload.residents.find(
        (resident) =>
          residentMatchKey(resident.unit, resident.building) === residentMatchKey(item.unit, item.building),
      )
      const residentName = preferFullerPersonName(item.residentName, residentMatch?.fullName ?? '')
      leases.push({
        id: `ext-lease-${doc.id}-${index}`,
        residentName,
        unit: item.unit,
        building: item.building,
        leaseStart: item.leaseStart,
        leaseEnd: item.leaseEnd,
        rentAmount: item.rentAmount,
        securityDeposit: item.securityDeposit,
        sourceDocumentName: source,
        confidence: item.confidence,
        selected: Boolean(residentName.trim()),
        needsReview: item.confidence < 75,
      })
    })

    for (const [index, item] of payload.leases.entries()) {
      const alreadyResident = residents.some(
        (resident) =>
          personNamesMatch(resident.fullName, item.residentName) ||
          (item.unit.trim() &&
            residentMatchKey(resident.unit, resident.building) ===
              residentMatchKey(item.unit, item.building)),
      )
      if (!item.residentName.trim() || alreadyResident) continue
      residents.push({
        id: `ext-res-lease-${doc.id}-${index}`,
        fullName: item.residentName,
        unit: item.unit,
        building: item.building,
        phone: '',
        email: '',
        leaseStart: item.leaseStart,
        leaseEnd: item.leaseEnd,
        monthlyRent: item.rentAmount,
        rentDueDay: '',
        occupancyStatus: 'active',
        maintenanceResponsibilitiesClause: '',
        sourceDocumentName: source,
        confidence: item.confidence,
        selected: true,
        needsReview: item.confidence < 75 || !item.unit.trim(),
      })
    }

    payload.vendors.forEach((item, index) => {
      vendors.push({
        id: `ext-vendor-${doc.id}-${index}`,
        name: item.name,
        category: item.category || null,
        phone: item.phone,
        email: item.email,
        preferredEmergency: false,
        sourceDocumentName: source,
        confidence: item.confidence,
        selected: item.confidence >= 70,
        needsReview: item.confidence < 75,
      })
    })

    payload.maintenanceIssues.forEach((item, index) => {
      maintenanceIssues.push({
        id: `ext-maint-${doc.id}-${index}`,
        unit: item.unit,
        building: item.building,
        category: item.category,
        description: item.description,
        priority: item.priority,
        sourceDocumentName: source,
        confidence: item.confidence,
        selected: item.confidence >= 70,
        needsReview: item.confidence < 75,
        imageTags: doc.imageLabels,
      })
    })

    payload.financialRecords.forEach((item, index) => {
      financialRecords.push({
        id: `ext-fin-${doc.id}-${index}`,
        recordType: item.recordType,
        description: item.description,
        amount: item.amount,
        period: item.period,
        sourceDocumentName: source,
        confidence: item.confidence,
        selected: item.confidence >= 70,
        needsReview: item.confidence < 75,
      })
    })

    payload.warnings.forEach((warning, index) => {
      needsReview.push({
        id: `ext-warn-${doc.id}-${index}`,
        uploadedDocumentId: doc.id,
        sourceDocumentName: source,
        dataType: 'warning',
        label: 'Extraction note',
        value: warning,
        confidence: 100,
        includeInImport: false,
        needsReview: true,
      })
    })

    payload.imageLabels.forEach((label, index) => {
      imageLabels.push({
        id: `ext-img-${doc.id}-${index}`,
        uploadedDocumentId: doc.id,
        sourceDocumentName: source,
        dataType: 'image_label',
        label: 'Photo label',
        value: label,
        confidence: 80,
        includeInImport: true,
        needsReview: false,
      })
    })
  }

  const finalized = finalizeExtractionReviewEntities({ properties, units, residents, leases })

  return {
    account,
    properties: finalized.properties,
    units: finalized.units,
    residents: finalized.residents,
    leases: finalized.leases,
    vendors,
    maintenanceIssues,
    financialRecords,
    needsReview,
    imageLabels,
  }
}

function parseUploadedDocumentIdFromExtractedId(id: string): string {
  const match = id.match(/^ext-(?:prop|res|unit|lease|vendor|maint|fin)-([^-]+)-\d+$/)
  return match?.[1] ?? ''
}

function reviewItemFromExtractedRow(input: {
  id: string
  dataType: string
  label: string
  value: string
  sourceDocumentName: string
  confidence: number
  selected: boolean
}): ExtractedReviewItem {
  return {
    id: input.id,
    uploadedDocumentId: parseUploadedDocumentIdFromExtractedId(input.id),
    sourceDocumentName: input.sourceDocumentName,
    dataType: input.dataType,
    label: input.label,
    value: input.value,
    confidence: input.confidence,
    includeInImport: input.selected,
    needsReview: true,
  }
}

/** Build review-section rows from extracted entities flagged during merge/enrichment. */
export function buildFlaggedExtractionReviewItems(
  review: Pick<
    OnboardingExtractionReview,
    | 'properties'
    | 'units'
    | 'residents'
    | 'leases'
    | 'vendors'
    | 'maintenanceIssues'
    | 'financialRecords'
  >,
): ExtractedReviewItem[] {
  const items: ExtractedReviewItem[] = []

  for (const property of review.properties) {
    if (!property.needsReview) continue
    items.push(
      reviewItemFromExtractedRow({
        id: property.id,
        dataType: 'flagged_property',
        label: 'Property',
        value: [property.name, property.address, property.city, property.state]
          .filter(Boolean)
          .join(', '),
        sourceDocumentName: property.sourceDocumentName,
        confidence: property.confidence,
        selected: property.selected,
      }),
    )
  }

  for (const unit of review.units) {
    if (unit.confidence >= 75 && unit.label.trim()) continue
    items.push(
      reviewItemFromExtractedRow({
        id: unit.id,
        dataType: 'flagged_unit',
        label: 'Unit',
        value: formatExtractedUnitPlacement(unit.building, unit.label),
        sourceDocumentName: unit.sourceDocumentName,
        confidence: unit.confidence,
        selected: unit.selected,
      }),
    )
  }

  for (const resident of review.residents) {
    if (!resident.needsReview) continue
    items.push(
      reviewItemFromExtractedRow({
        id: resident.id,
        dataType: 'flagged_resident',
        label: 'Resident',
        value: [resident.fullName, formatExtractedUnitPlacement(resident.building, resident.unit)]
          .filter(Boolean)
          .join(' · '),
        sourceDocumentName: resident.sourceDocumentName,
        confidence: resident.confidence,
        selected: resident.selected,
      }),
    )
  }

  for (const lease of review.leases) {
    if (!lease.needsReview) continue
    items.push(
      reviewItemFromExtractedRow({
        id: lease.id,
        dataType: 'flagged_lease',
        label: 'Lease',
        value: [lease.residentName, formatExtractedUnitPlacement(lease.building, lease.unit), lease.rentAmount]
          .filter(Boolean)
          .join(' · '),
        sourceDocumentName: lease.sourceDocumentName,
        confidence: lease.confidence,
        selected: lease.selected,
      }),
    )
  }

  for (const vendor of review.vendors) {
    if (!vendor.needsReview) continue
    items.push(
      reviewItemFromExtractedRow({
        id: vendor.id,
        dataType: 'flagged_vendor',
        label: 'Vendor',
        value: [vendor.name, vendor.category, vendor.phone, vendor.email].filter(Boolean).join(' · '),
        sourceDocumentName: vendor.sourceDocumentName,
        confidence: vendor.confidence,
        selected: vendor.selected,
      }),
    )
  }

  for (const issue of review.maintenanceIssues) {
    if (!issue.needsReview) continue
    items.push(
      reviewItemFromExtractedRow({
        id: issue.id,
        dataType: 'flagged_maintenance',
        label: 'Maintenance issue',
        value: [issue.description, formatExtractedUnitPlacement(issue.building, issue.unit)].filter(Boolean).join(' · '),
        sourceDocumentName: issue.sourceDocumentName,
        confidence: issue.confidence,
        selected: issue.selected,
      }),
    )
  }

  for (const record of review.financialRecords) {
    if (!record.needsReview) continue
    items.push(
      reviewItemFromExtractedRow({
        id: record.id,
        dataType: 'flagged_financial',
        label: 'Financial record',
        value: [record.recordType, record.description, record.amount, record.period]
          .filter(Boolean)
          .join(' · '),
        sourceDocumentName: record.sourceDocumentName,
        confidence: record.confidence,
        selected: record.selected,
      }),
    )
  }

  return items
}

export function listNeedsReviewSectionItems(review: OnboardingExtractionReview): ExtractedReviewItem[] {
  return [...review.needsReview, ...buildFlaggedExtractionReviewItems(review), ...review.imageLabels]
}

function toggleReviewEntitySelected(
  review: OnboardingExtractionReview,
  itemId: string,
): OnboardingExtractionReview {
  const toggle = <T extends { id: string; selected: boolean }>(items: T[]) =>
    items.map((row) => (row.id === itemId ? { ...row, selected: !row.selected } : row))

  return {
    ...review,
    properties: toggle(review.properties),
    units: toggle(review.units),
    residents: toggle(review.residents),
    leases: toggle(review.leases),
    vendors: toggle(review.vendors),
    maintenanceIssues: toggle(review.maintenanceIssues),
    financialRecords: toggle(review.financialRecords),
  }
}

export function toggleExtractionReviewItem(
  review: OnboardingExtractionReview,
  itemId: string,
): OnboardingExtractionReview {
  if (buildFlaggedExtractionReviewItems(review).some((item) => item.id === itemId)) {
    return toggleReviewEntitySelected(review, itemId)
  }

  if (review.needsReview.some((row) => row.id === itemId)) {
    return {
      ...review,
      needsReview: review.needsReview.map((row) =>
        row.id === itemId ? { ...row, includeInImport: !row.includeInImport } : row,
      ),
    }
  }

  return {
    ...review,
    imageLabels: review.imageLabels.map((row) =>
      row.id === itemId ? { ...row, includeInImport: !row.includeInImport } : row,
    ),
  }
}

function enrichExtractedPersonNames(
  residents: OnboardingExtractedResident[],
  leases: ExtractedLeaseInfo[],
): OnboardingExtractedResident[] {
  return residents.map((resident) => {
    const leaseMatch = leases.find(
      (lease) =>
        residentMatchKey(lease.unit, lease.building) === residentMatchKey(resident.unit, resident.building),
    )
    return {
      ...resident,
      fullName: preferFullerPersonName(resident.fullName, leaseMatch?.residentName ?? ''),
    }
  })
}

function enrichExtractedLeaseNames(
  residents: OnboardingExtractedResident[],
  leases: ExtractedLeaseInfo[],
): ExtractedLeaseInfo[] {
  return leases.map((lease) => {
    const residentMatch = residents.find(
      (resident) =>
        residentMatchKey(resident.unit, resident.building) === residentMatchKey(lease.unit, lease.building),
    )
    return {
      ...lease,
      residentName: preferFullerPersonName(lease.residentName, residentMatch?.fullName ?? ''),
    }
  })
}

/** Build extraction review from per-document GPT payloads (no demo/mock filler). */
export function buildOnboardingExtractionReview(
  documents: OnboardingUploadedDocument[],
  accountSeed?: Partial<OnboardingAccountSetup> | null,
): OnboardingExtractionReview {
  if (documents.length === 0) {
    return emptyExtractionReview(accountSeed)
  }
  return mergeExtractedDocuments(documents, accountSeed)
}

export function emptyExtractionReview(
  accountSeed?: Partial<OnboardingAccountSetup> | null,
): OnboardingExtractionReview {
  return {
    account: emptyReviewManualAccount(accountSeed),
    properties: [],
    units: [],
    residents: [],
    leases: [],
    vendors: [],
    maintenanceIssues: [],
    financialRecords: [],
    needsReview: [],
    imageLabels: [],
  }
}

/** Ensure older persisted reviews still have account + new entity fields. */
export function normalizeExtractionReview(
  review: OnboardingExtractionReview | null | undefined,
  accountSeed?: Partial<OnboardingAccountSetup> | null,
): OnboardingExtractionReview {
  if (!review) return emptyExtractionReview(accountSeed)
  const normalizedLeases = (review.leases ?? []).map((item) => ({ ...item }))
  const normalizedUnits = review.units ?? []
  const normalizedProperties = (review.properties ?? []).map((item) => ({
    ...item,
    city: item.city ?? '',
    state: item.state ?? '',
    zipCode: item.zipCode ?? '',
    propertyType: resolveOnboardingPropertyType(item.propertyType),
    propertyManagerName: item.propertyManagerName ?? '',
    propertyManagerPhone: item.propertyManagerPhone ?? '',
  }))
  const normalizedResidents = (review.residents ?? []).map((item) => ({
    ...item,
    monthlyRent: item.monthlyRent ?? '',
    rentDueDay: item.rentDueDay ?? '',
    occupancyStatus: item.occupancyStatus ?? 'active',
    maintenanceResponsibilitiesClause: item.maintenanceResponsibilitiesClause ?? '',
  }))
  const finalized = finalizeExtractionReviewEntities({
    properties: normalizedProperties,
    units: normalizedUnits,
    residents: normalizedResidents,
    leases: normalizedLeases,
  })
  return {
    account: normalizeReviewManualAccount(review.account ?? accountSeed),
    properties: finalized.properties,
    units: finalized.units,
    residents: finalized.residents,
    leases: finalized.leases,
    vendors: (review.vendors ?? []).map((item) => ({
      ...item,
      preferredEmergency: Boolean(item.preferredEmergency),
    })),
    maintenanceIssues: review.maintenanceIssues ?? [],
    financialRecords: review.financialRecords ?? [],
    needsReview: review.needsReview ?? [],
    imageLabels: review.imageLabels ?? [],
  }
}

export function toMockExtractionReview(review: OnboardingExtractionReview): MockExtractionReview {
  return {
    properties: review.properties
      .filter((item) => item.selected)
      .map((item) => ({
        id: item.id,
        name: item.name,
        address: [item.address, item.city, item.state, item.zipCode].filter(Boolean).join(', '),
        unitCount: item.unitCount,
        selected: true,
      })),
    units: review.units
      .filter((item) => item.selected)
      .map((item) => ({
        id: item.id,
        label: item.label,
        building: item.building,
        selected: true,
      })),
    residents: review.residents
      .filter((item) => item.selected)
      .map((item) => ({
        id: item.id,
        fullName: item.fullName,
        unit: item.unit,
        building: item.building,
        phone: item.phone,
        email: item.email,
        leaseStart: item.leaseStart,
        leaseEnd: item.leaseEnd,
        selected: true,
        monthlyRent: item.monthlyRent,
        rentDueDay: item.rentDueDay,
        occupancyStatus: item.occupancyStatus,
        maintenanceResponsibilitiesClause: item.maintenanceResponsibilitiesClause,
      })),
    vendors: review.vendors
      .filter((item) => item.selected)
      .map((item) => ({
        id: item.id,
        name: item.name,
        category: item.category,
        phone: item.phone,
        email: item.email,
        selected: true,
        preferredEmergency: item.preferredEmergency,
      })),
    maintenanceIssues: review.maintenanceIssues
      .filter((item) => item.selected)
      .map((item) => ({
        id: item.id,
        unit: item.unit,
        building: item.building,
        category: item.category,
        description: item.description,
        priority: item.priority,
        selected: true,
      })),
    leases: review.leases
      .filter((item) => item.selected)
      .map((item) => ({
        id: item.id,
        residentName: item.residentName,
        unit: item.unit,
        building: item.building,
        leaseStart: item.leaseStart,
        leaseEnd: item.leaseEnd,
        rentAmount: item.rentAmount,
        selected: true,
      })),
  }
}

export function countSelectedInReview(review: OnboardingExtractionReview): number {
  return (
    review.properties.filter((i) => i.selected).length +
    review.units.filter((i) => i.selected).length +
    review.residents.filter((i) => i.selected).length +
    review.leases.filter((i) => i.selected).length +
    review.vendors.filter((i) => i.selected).length +
    review.maintenanceIssues.filter((i) => i.selected).length +
    review.financialRecords.filter((i) => i.selected).length +
    review.needsReview.filter((i) => i.includeInImport).length +
    review.imageLabels.filter((i) => i.includeInImport).length
  )
}

export type OnboardingReviewSelectionLog = {
  selected: {
    properties: number
    units: number
    residents: number
    leases: number
    vendors: number
    maintenanceIssues: number
    financialRecords: number
    needsReview: number
    imageLabels: number
    total: number
  }
  skipped: {
    properties: number
    units: number
    residents: number
    leases: number
    vendors: number
    maintenanceIssues: number
    financialRecords: number
    needsReview: number
    imageLabels: number
    total: number
  }
  selectedIds: {
    properties: string[]
    units: string[]
    residents: string[]
    leases: string[]
    vendors: string[]
    maintenanceIssues: string[]
    financialRecords: string[]
  }
  skippedIds: {
    properties: string[]
    units: string[]
    residents: string[]
    leases: string[]
    vendors: string[]
    maintenanceIssues: string[]
    financialRecords: string[]
  }
}

function countPair(items: Array<{ selected: boolean }>): { selected: number; skipped: number } {
  let selected = 0
  let skipped = 0
  for (const item of items) {
    if (item.selected) selected += 1
    else skipped += 1
  }
  return { selected, skipped }
}

function idsBySelection<T extends { id: string; selected: boolean }>(
  items: T[],
): { selectedIds: string[]; skippedIds: string[] } {
  const selectedIds: string[] = []
  const skippedIds: string[] = []
  for (const item of items) {
    if (item.selected) selectedIds.push(item.id)
    else skippedIds.push(item.id)
  }
  return { selectedIds, skippedIds }
}

/** Snapshot of what Continue will import vs leave out. */
export function summarizeReviewSelections(
  review: OnboardingExtractionReview,
): OnboardingReviewSelectionLog {
  const properties = countPair(review.properties)
  const units = countPair(review.units)
  const residents = countPair(review.residents)
  const leases = countPair(review.leases)
  const vendors = countPair(review.vendors)
  const maintenanceIssues = countPair(review.maintenanceIssues)
  const financialRecords = countPair(review.financialRecords)
  const needsReviewSelected = review.needsReview.filter((i) => i.includeInImport).length
  const needsReviewSkipped = review.needsReview.length - needsReviewSelected
  const imageLabelsSelected = review.imageLabels.filter((i) => i.includeInImport).length
  const imageLabelsSkipped = review.imageLabels.length - imageLabelsSelected

  const propIds = idsBySelection(review.properties)
  const unitIds = idsBySelection(review.units)
  const residentIds = idsBySelection(review.residents)
  const leaseIds = idsBySelection(review.leases)
  const vendorIds = idsBySelection(review.vendors)
  const issueIds = idsBySelection(review.maintenanceIssues)
  const financialIds = idsBySelection(review.financialRecords)

  const selectedTotal =
    properties.selected +
    units.selected +
    residents.selected +
    leases.selected +
    vendors.selected +
    maintenanceIssues.selected +
    financialRecords.selected +
    needsReviewSelected +
    imageLabelsSelected
  const skippedTotal =
    properties.skipped +
    units.skipped +
    residents.skipped +
    leases.skipped +
    vendors.skipped +
    maintenanceIssues.skipped +
    financialRecords.skipped +
    needsReviewSkipped +
    imageLabelsSkipped

  return {
    selected: {
      properties: properties.selected,
      units: units.selected,
      residents: residents.selected,
      leases: leases.selected,
      vendors: vendors.selected,
      maintenanceIssues: maintenanceIssues.selected,
      financialRecords: financialRecords.selected,
      needsReview: needsReviewSelected,
      imageLabels: imageLabelsSelected,
      total: selectedTotal,
    },
    skipped: {
      properties: properties.skipped,
      units: units.skipped,
      residents: residents.skipped,
      leases: leases.skipped,
      vendors: vendors.skipped,
      maintenanceIssues: maintenanceIssues.skipped,
      financialRecords: financialRecords.skipped,
      needsReview: needsReviewSkipped,
      imageLabels: imageLabelsSkipped,
      total: skippedTotal,
    },
    selectedIds: {
      properties: propIds.selectedIds,
      units: unitIds.selectedIds,
      residents: residentIds.selectedIds,
      leases: leaseIds.selectedIds,
      vendors: vendorIds.selectedIds,
      maintenanceIssues: issueIds.selectedIds,
      financialRecords: financialIds.selectedIds,
    },
    skippedIds: {
      properties: propIds.skippedIds,
      units: unitIds.skippedIds,
      residents: residentIds.skippedIds,
      leases: leaseIds.skippedIds,
      vendors: vendorIds.skippedIds,
      maintenanceIssues: issueIds.skippedIds,
      financialRecords: financialIds.skippedIds,
    },
  }
}

export function hasExtractionReviewData(review: OnboardingExtractionReview): boolean {
  return (
    Boolean(review.account?.companyName?.trim()) ||
    Boolean(review.account?.contactName?.trim()) ||
    review.properties.length > 0 ||
    review.units.length > 0 ||
    review.residents.length > 0 ||
    review.leases.length > 0 ||
    review.vendors.length > 0 ||
    review.maintenanceIssues.length > 0 ||
    review.financialRecords.length > 0 ||
    review.needsReview.length > 0 ||
    review.imageLabels.length > 0
  )
}

export function setAllReviewSelections(
  review: OnboardingExtractionReview,
  selected: boolean,
): OnboardingExtractionReview {
  const mapSelected = <T extends { selected: boolean }>(items: T[]) =>
    items.map((item) => ({ ...item, selected }))
  return {
    account: review.account ?? emptyReviewManualAccount(),
    properties: mapSelected(review.properties),
    units: mapSelected(review.units),
    residents: mapSelected(review.residents),
    leases: mapSelected(review.leases),
    vendors: mapSelected(review.vendors),
    maintenanceIssues: mapSelected(review.maintenanceIssues),
    financialRecords: mapSelected(review.financialRecords),
    needsReview: review.needsReview.map((item) => ({ ...item, includeInImport: selected })),
    imageLabels: review.imageLabels.map((item) => ({ ...item, includeInImport: selected })),
  }
}
