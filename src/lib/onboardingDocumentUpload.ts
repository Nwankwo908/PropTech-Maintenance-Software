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
  mergeReviewManualAccount,
  usableOnboardingCompanyName,
  type OnboardingReviewManualAccount,
} from '@/lib/onboardingReviewManual'
import {
  inferOnboardingPropertyTypeFromUnitCount,
  resolveOnboardingPropertyType,
} from '@/lib/onboarding/propertyType'
import { normalizeBuildingKey, normalizeUnitLabel } from '@/lib/propertyHealth'
import { collectExtractedUnitLabels, extractedPlacesOverlap } from '@/lib/onboarding/persist/properties'
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

/** Status/error leftovers the model sometimes writes into extracted fields. */
export function isOnboardingExtractJunkValue(value: string): boolean {
  const lower = value.trim().toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ')
  if (!lower) return true
  if (
    Object.values(UPLOAD_STATUS_LABELS).some((label) => label.toLowerCase() === lower)
  ) {
    return true
  }
  return /^(needs attention|needs review|failed|error|n\/a|na|none|null|undefined|unknown|string|number|boolean|extraction note|not available|not found|not provided|not specified|unable to extract|unable to read|could not extract|could not read|see warning|see warnings)$/.test(
    lower,
  )
}

function cleanOnboardingExtractText(value: string | null | undefined): string {
  const text = (value ?? '').trim()
  return isOnboardingExtractJunkValue(text) ? '' : text
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

/** Portfolio extraction role for a single uploaded file (classified before merge). */
export type OnboardingDocumentExtractRole = 'rent_roll' | 'lease_agreement' | 'unknown'

export function resolvedDocumentCategory(doc: OnboardingUploadedDocument): OnboardingDocumentCategory {
  if (doc.documentCategory !== 'unknown') return doc.documentCategory
  return inferDocumentCategory(doc.fileName)
}

/** Classify each upload before extracting/merging portfolio records. */
export function classifyOnboardingDocumentExtractRole(
  doc: OnboardingUploadedDocument,
): OnboardingDocumentExtractRole {
  const category = resolvedDocumentCategory(doc)
  if (category === 'rent_roll' || category === 'resident_roster') return 'rent_roll'
  if (category === 'lease_agreement' || category === 'move_in_document') {
    return 'lease_agreement'
  }
  return 'unknown'
}

export function documentIsRentRoll(doc: OnboardingUploadedDocument): boolean {
  return classifyOnboardingDocumentExtractRole(doc) === 'rent_roll'
}

export function documentIsLeaseInventory(doc: OnboardingUploadedDocument): boolean {
  return classifyOnboardingDocumentExtractRole(doc) === 'lease_agreement'
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

/** Clamp per-file progress; stay below 100 until the document finishes. */
export function clampDocumentUploadProgress(progress: number): number {
  if (!Number.isFinite(progress)) return 0
  return Math.min(100, Math.max(0, Math.round(progress)))
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
    uploadProgress: clampDocumentUploadProgress(doc.uploadProgress || 8),
  }
  onUpdate(current)

  // Upload phase only — leave headroom for digitize / scan / extract.
  for (const progress of [14, 20, 28]) {
    if (signal?.aborted) return current
    current = { ...current, uploadProgress: progress }
    onUpdate(current)
    await sleep(80)
  }

  const stages: Array<{
    status: UploadFileStatus
    label: string
    ms: number
    progress: number
  }> = [
    {
      status: 'digitizing',
      label: UPLOAD_STATUS_LABELS.digitizing,
      ms: 400,
      progress: 42,
    },
    {
      status: 'scanning',
      label: UPLOAD_STATUS_LABELS.scanning,
      ms: 500,
      progress: 58,
    },
    {
      status: 'extracting',
      label: UPLOAD_STATUS_LABELS.extracting,
      ms: 300,
      progress: 72,
    },
  ]

  for (const stage of stages) {
    if (signal?.aborted) return current
    current = {
      ...current,
      uploadStatus: stage.status,
      extractionStatus: stage.status,
      processingLabel: stage.label,
      uploadProgress: stage.progress,
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
      uploadProgress: 80,
    }
    onUpdate(current)
    await sleep(400)
  }

  // Hold under 100% while the extract edge call runs (often the longest wait).
  current = {
    ...current,
    uploadStatus: 'extracting',
    extractionStatus: 'extracting',
    processingLabel: UPLOAD_STATUS_LABELS.extracting,
    uploadProgress: 88,
  }
  onUpdate(current)

  try {
    const fileBase64 =
      file && (file.size <= 4 * 1024 * 1024 || !doc.storagePath)
        ? await fileToBase64(file)
        : undefined

    const result = await extractOnboardingDocument({
      docId: doc.id,
      fileName: doc.fileName,
      documentCategory: doc.documentCategory,
      storageBucket: doc.storageBucket,
      storagePath: doc.storagePath,
      contentType: doc.contentType,
      fileBase64,
    })

    const warning =
      result.extracted.warnings
        .map((item) => cleanOnboardingExtractText(item))
        .find(Boolean) ?? null
    const needsAttention = !result.hasData

    current = {
      ...current,
      extractedPayload: result.extracted,
      imageLabels: result.extracted.imageLabels.filter(
        (label) => !isOnboardingExtractJunkValue(label),
      ),
    uploadStatus: needsAttention ? 'needs_attention' : 'ready_for_review',
    extractionStatus: needsAttention ? 'needs_attention' : 'ready_for_review',
      processingLabel:
        UPLOAD_STATUS_LABELS[needsAttention ? 'needs_attention' : 'ready_for_review'],
    uploadProgress: 100,
      errorMessage: needsAttention
        ? warning ||
          'We couldn’t find property, tenant, or lease details in this file.'
        : null,
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

export function isOnboardingDocumentProcessing(doc: OnboardingUploadedDocument): boolean {
  return (
      doc.uploadStatus === 'waiting' ||
      doc.uploadStatus === 'uploading' ||
      doc.uploadStatus === 'scanning' ||
      doc.uploadStatus === 'extracting' ||
      doc.uploadStatus === 'digitizing' ||
    doc.uploadStatus === 'handwriting'
  )
}

export function anyDocumentProcessing(docs: OnboardingUploadedDocument[]): boolean {
  return docs.some(isOnboardingDocumentProcessing)
}

/** Failed or empty extracts can be retried without re-uploading. */
export function canRetryOnboardingDocumentExtract(doc: OnboardingUploadedDocument): boolean {
  return doc.uploadStatus === 'failed' || doc.uploadStatus === 'needs_attention'
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

function extractedUnitMatchKey(unit: string, building: string): string {
  return `${normalizeBuildingKey(building).toLowerCase()}|${normalizeUnitLabel(unit)}`
}

function normalizeExtractedUnitKey(unit: string): string {
  return normalizeUnitLabel(unit)
}

function normalizePersonNameKey(name: string): string {
  let text = name
    .trim()
    .toLowerCase()
    .replace(/[.'’]/g, '')
    .replace(/,/g, ' ')
    .replace(/\b(jr|sr|ii|iii|iv|esq)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (name.includes(',')) {
    const [last, ...rest] = name
      .split(',')
      .map((part) => part.trim().toLowerCase().replace(/[.'’]/g, ''))
    const first = rest.join(' ').replace(/\b(jr|sr|ii|iii|iv|esq)\b/g, '').trim()
    if (first && last) text = `${first} ${last}`.replace(/\s+/g, ' ').trim()
  }
  return text
}

function personNameParts(name: string): { first: string; last: string } {
  const parts = normalizePersonNameKey(name).split(' ').filter(Boolean)
  if (parts.length === 0) return { first: '', last: '' }
  if (parts.length === 1) return { first: parts[0] ?? '', last: '' }
  return { first: parts[0] ?? '', last: parts[parts.length - 1] ?? '' }
}

function personGivenNamesMatch(left: string, right: string): boolean {
  if (!left || !right) return false
  if (left === right) return true
  if (left.length === 1) return right.startsWith(left)
  if (right.length === 1) return left.startsWith(right)
  if (left.length >= 3 && right.startsWith(left)) return true
  if (right.length >= 3 && left.startsWith(right)) return true
  return false
}

function personNamesMatch(left: string, right: string): boolean {
  const aKey = normalizePersonNameKey(left)
  const bKey = normalizePersonNameKey(right)
  if (!aKey || !bKey) return false
  if (aKey === bKey) return true
  const a = personNameParts(left)
  const b = personNameParts(right)
  if (!a.first || !b.first || !a.last || !b.last) return false
  if (personGivenNamesMatch(a.first, b.first) && a.last === b.last) return true
  // Rent rolls often list LAST FIRST without a comma.
  return a.first === b.last && a.last === b.first
}

function digitsOnlyPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '')
  if (digits.length === 11 && digits.startsWith('1')) return digits.slice(1)
  return digits
}

function extractedBuildingLabel(building: string): string {
  return building.trim().toLowerCase()
}

function extractedBuildingsCompatible(left: string, right: string): boolean {
  const buildingLeft = extractedBuildingLabel(left)
  const buildingRight = extractedBuildingLabel(right)
  if (!buildingLeft || !buildingRight) return true
  if (buildingLeft === buildingRight) return true
  return extractedPlacesOverlap(left, right)
}

export function extractedResidentIdentityMatch(
  left: Pick<OnboardingExtractedResident, 'fullName' | 'unit' | 'building' | 'phone' | 'email'>,
  right: Pick<OnboardingExtractedResident, 'fullName' | 'unit' | 'building' | 'phone' | 'email'>,
): boolean {
  const nameMatch = personNamesMatch(left.fullName, right.fullName)
  const unitLeft = normalizeExtractedUnitKey(left.unit)
  const unitRight = normalizeExtractedUnitKey(right.unit)
  const unitMatch = Boolean(unitLeft && unitRight && unitLeft === unitRight)
  const buildingCompatible = extractedBuildingsCompatible(left.building, right.building)
  const phoneLeft = digitsOnlyPhone(left.phone)
  const phoneRight = digitsOnlyPhone(right.phone)
  const phoneMatch = Boolean(phoneLeft.length >= 10 && phoneLeft === phoneRight)
  const emailLeft = left.email.trim().toLowerCase()
  const emailRight = right.email.trim().toLowerCase()
  const emailMatch = Boolean(emailLeft && emailRight && emailLeft === emailRight)

  if ((phoneMatch || emailMatch) && (nameMatch || !left.fullName.trim() || !right.fullName.trim())) {
    return true
  }
  // Same person on a rent roll and a lease — building text rarely matches across those docs.
  if (nameMatch && unitMatch && buildingCompatible) return true
  if (nameMatch && buildingCompatible && (!unitLeft || !unitRight)) return true
  // Same unit with one blank name can fill placement — never treat two different names as one person.
  if (
    unitMatch &&
    buildingCompatible &&
    (!left.fullName.trim() || !right.fullName.trim())
  ) {
    return true
  }
  return false
}

function joinExtractedSourceNames(left: string, right: string): string {
  const parts = [...new Set(
    [left, right]
      .flatMap((value) => value.split(' · '))
      .map((value) => value.trim())
      .filter(Boolean),
  )]
  return parts.join(' · ')
}

function mergeExtractedResidentRow(
  primary: OnboardingExtractedResident,
  extra: OnboardingExtractedResident,
): OnboardingExtractedResident {
  const fullName = preferFullerPersonName(primary.fullName, extra.fullName)
  const unit = primary.unit.trim() || extra.unit.trim()
  const building = primary.building.trim() || extra.building.trim()
  const confidence = Math.max(primary.confidence, extra.confidence)
    return {
    ...primary,
    fullName,
    unit,
    building,
    phone: primary.phone.trim() || extra.phone.trim(),
    email: primary.email.trim() || extra.email.trim(),
    leaseStart: primary.leaseStart.trim() || extra.leaseStart.trim(),
    leaseEnd: primary.leaseEnd.trim() || extra.leaseEnd.trim(),
    monthlyRent: primary.monthlyRent.trim() || extra.monthlyRent.trim(),
    sourceDocumentName: joinExtractedSourceNames(
      primary.sourceDocumentName,
      extra.sourceDocumentName,
    ),
    confidence,
    selected: primary.selected || extra.selected,
    needsReview: confidence < 75 || Boolean(fullName.trim() && !unit.trim()),
  }
}

export function dedupeOnboardingExtractedResidents(
  residents: OnboardingExtractedResident[],
): OnboardingExtractedResident[] {
  const merged: OnboardingExtractedResident[] = []
  for (const row of residents) {
    const index = merged.findIndex((existing) => extractedResidentIdentityMatch(existing, row))
    if (index === -1) {
      merged.push(row)
      continue
    }
    const current = merged[index]
    if (!current) continue
    merged[index] = mergeExtractedResidentRow(current, row)
  }
  return merged
}

function leaseDateKey(value: string): string {
  return value.trim().slice(0, 10)
}

/** Same lease agreement when unit matches and dates are compatible (co-tenants share one row). */
export function extractedLeaseAgreementMatch(
  left: Pick<ExtractedLeaseInfo, 'unit' | 'building' | 'leaseStart' | 'leaseEnd'>,
  right: Pick<ExtractedLeaseInfo, 'unit' | 'building' | 'leaseStart' | 'leaseEnd'>,
): boolean {
  const unitLeft = normalizeExtractedUnitKey(left.unit)
  const unitRight = normalizeExtractedUnitKey(right.unit)
  if (!unitLeft || !unitRight || unitLeft !== unitRight) return false
  if (!extractedBuildingsCompatible(left.building, right.building)) return false

  const startLeft = leaseDateKey(left.leaseStart)
  const startRight = leaseDateKey(right.leaseStart)
  const endLeft = leaseDateKey(left.leaseEnd)
  const endRight = leaseDateKey(right.leaseEnd)

  // Missing dates on either side — same unit is enough for one agreement row.
  if (!startLeft || !startRight) return true
  if (startLeft === startRight) return true
  if (endLeft && endRight && endLeft === endRight) return true
  return false
}

function scoreExtractedLeaseRow(row: ExtractedLeaseInfo): number {
  let score = row.confidence
  if (row.unit.trim()) score += 20
  if (row.residentName.trim() && !looksLikeExtractedCompanyName(row.residentName)) score += 35
  if (looksLikeExtractedCompanyName(row.residentName)) score -= 40
  if (row.leaseStart.trim() && row.leaseEnd.trim()) score += 10
  if (row.rentAmount.trim()) score += 5
  score += Math.min(row.residentName.trim().split(/\s+/).filter(Boolean).length, 4) * 2
  return score
}

function pickBetterLeaseRow(
  primary: ExtractedLeaseInfo,
  extra: ExtractedLeaseInfo,
): ExtractedLeaseInfo {
  const preferExtra = scoreExtractedLeaseRow(extra) > scoreExtractedLeaseRow(primary)
  return preferExtra
    ? mergeExtractedLeaseRow(extra, primary)
    : mergeExtractedLeaseRow(primary, extra)
}

function mergeExtractedLeaseRow(primary: ExtractedLeaseInfo, extra: ExtractedLeaseInfo): ExtractedLeaseInfo {
  const primaryIsCompany = looksLikeExtractedCompanyName(primary.residentName)
  const extraIsCompany = looksLikeExtractedCompanyName(extra.residentName)
  const residentName =
    primaryIsCompany && !extraIsCompany
      ? extra.residentName.trim() || primary.residentName
      : extraIsCompany && !primaryIsCompany
        ? primary.residentName.trim() || extra.residentName
        : preferFullerPersonName(primary.residentName, extra.residentName)
  const unit = primary.unit.trim() || extra.unit.trim()
  const confidence = Math.max(primary.confidence, extra.confidence)
  return {
    ...primary,
    residentName,
    unit,
    building: primary.building.trim() || extra.building.trim(),
    leaseStart: primary.leaseStart.trim() || extra.leaseStart.trim(),
    leaseEnd: primary.leaseEnd.trim() || extra.leaseEnd.trim(),
    rentAmount: primary.rentAmount.trim() || extra.rentAmount.trim(),
    securityDeposit: primary.securityDeposit.trim() || extra.securityDeposit.trim(),
    sourceDocumentName: joinExtractedSourceNames(
      primary.sourceDocumentName,
      extra.sourceDocumentName,
    ),
    confidence,
    selected: primary.selected || extra.selected,
    needsReview: confidence < 75 || Boolean(residentName.trim() && !unit.trim()),
  }
}

/**
 * One lease PDF often returns tenant + co-tenant (or landlord) as separate lease rows.
 * Collapse to one agreement per file when units agree (or are missing).
 */
export function collapseLeasesFromSingleAgreement(
  leases: ExtractedLeaseInfo[],
): ExtractedLeaseInfo[] {
  if (leases.length <= 1) return leases

  const people = leases.filter((row) => !looksLikeExtractedCompanyName(row.residentName))
  const pool = people.length > 0 ? people : leases
  const unitKeys = [
    ...new Set(
      pool
        .map((row) => normalizeExtractedUnitKey(row.unit))
        .filter(Boolean),
    ),
  ]

  // Typical lease PDF: one unit (or blank units) → one agreement row.
  if (unitKeys.length <= 1) {
    return [pool.reduce((best, row) => pickBetterLeaseRow(best, row))]
  }

  const byUnit = new Map<string, ExtractedLeaseInfo>()
  const noUnit: ExtractedLeaseInfo[] = []

  for (const row of pool) {
    const key = normalizeExtractedUnitKey(row.unit)
    if (!key) {
      noUnit.push(row)
      continue
    }
    const existing = byUnit.get(key)
    byUnit.set(key, existing ? pickBetterLeaseRow(existing, row) : row)
  }

  const result = [...byUnit.values()]
  for (const orphan of noUnit) {
    if (result.length === 1 && result[0]) {
      result[0] = pickBetterLeaseRow(result[0], orphan)
    }
  }
  return result
}

/** Collapse multi-party rows that still share one lease PDF source name. */
export function collapseLeasesBySourceDocument(
  leases: ExtractedLeaseInfo[],
): ExtractedLeaseInfo[] {
  const groups = new Map<string, ExtractedLeaseInfo[]>()
  const passthrough: ExtractedLeaseInfo[] = []

  for (const row of leases) {
    const sources = row.sourceDocumentName
      .split(' · ')
      .map((part) => part.trim())
      .filter(Boolean)
    const only = sources.length === 1 ? sources[0] : null
    if (only && /\.(pdf|docx?|png|jpe?g|heic|webp|tif{1,2})$/i.test(only)) {
      const key = only.toLowerCase()
      const list = groups.get(key) ?? []
      list.push(row)
      groups.set(key, list)
      continue
    }
    passthrough.push(row)
  }

  return [
    ...[...groups.values()].flatMap((group) => collapseLeasesFromSingleAgreement(group)),
    ...passthrough,
  ]
}

function leaseSourceDocumentsOverlap(left: string, right: string): boolean {
  const leftParts = new Set(
    left
      .split(' · ')
      .map((part) => part.trim().toLowerCase())
      .filter(Boolean),
  )
  if (leftParts.size === 0) return false
  for (const part of right.split(' · ')) {
    const key = part.trim().toLowerCase()
    if (key && leftParts.has(key)) return true
  }
  return false
}

export function dedupeOnboardingExtractedLeases(leases: ExtractedLeaseInfo[]): ExtractedLeaseInfo[] {
  const merged: ExtractedLeaseInfo[] = []
  for (const row of collapseLeasesBySourceDocument(leases)) {
    if (looksLikeExtractedCompanyName(row.residentName) && !row.unit.trim()) {
      continue
    }
    const index = merged.findIndex((existing) => {
      const identity = extractedResidentIdentityMatch(
        {
          fullName: existing.residentName,
          unit: existing.unit,
          building: existing.building,
          phone: '',
          email: '',
        },
        {
          fullName: row.residentName,
          unit: row.unit,
          building: row.building,
          phone: '',
          email: '',
        },
      )
      if (identity) return true
      // Co-tenants on the same lease PDF → one row. Do not merge different people
      // who only share a unit across separate documents.
      return (
        leaseSourceDocumentsOverlap(existing.sourceDocumentName, row.sourceDocumentName) &&
        extractedLeaseAgreementMatch(existing, row)
      )
    })
    if (index === -1) {
      merged.push(row)
      continue
    }
    const current = merged[index]
    if (!current) continue
    merged[index] = pickBetterLeaseRow(current, row)
  }
  return merged
}

function parseExtractedRentAmount(value: string): number | null {
  const cleaned = value.replace(/[^0-9.]/g, '')
  if (!cleaned) return null
  const amount = Number.parseFloat(cleaned)
  return Number.isFinite(amount) ? amount : null
}

function rentAmountsConflict(left: string, right: string): boolean {
  const a = parseExtractedRentAmount(left)
  const b = parseExtractedRentAmount(right)
  if (a == null || b == null) return false
  return Math.abs(a - b) >= 0.01
}

function fillExtractedResidentsFromLeases(
  residents: OnboardingExtractedResident[],
  leases: ExtractedLeaseInfo[],
): {
  residents: OnboardingExtractedResident[]
  conflicts: ExtractedReviewItem[]
  unmatchedLeases: ExtractedLeaseInfo[]
} {
  const matchedLeaseIds = new Set<string>()
  const conflicts: ExtractedReviewItem[] = []

  const nextResidents = residents.map((resident) => {
    const lease = leases.find((row) =>
      extractedResidentIdentityMatch(resident, {
        fullName: row.residentName,
        unit: row.unit,
        building: row.building,
        phone: '',
        email: '',
      }),
    )
    if (!lease) return resident
    matchedLeaseIds.add(lease.id)

    const fullName = preferFullerPersonName(resident.fullName, lease.residentName)
    const unit = resident.unit.trim() || lease.unit.trim()
    const rentConflict =
      Boolean(resident.monthlyRent.trim()) &&
      Boolean(lease.rentAmount.trim()) &&
      rentAmountsConflict(resident.monthlyRent, lease.rentAmount)

    if (rentConflict) {
      conflicts.push({
        id: `ext-conflict-rent-${resident.id}-${lease.id}`,
        uploadedDocumentId: parseUploadedDocumentIdFromExtractedId(lease.id),
        sourceDocumentName: joinExtractedSourceNames(
          resident.sourceDocumentName,
          lease.sourceDocumentName,
        ),
        dataType: 'rent_amount_conflict',
        label: 'Rent amount differs',
        value: `Rent Roll: ${resident.monthlyRent.trim()} · Lease: ${lease.rentAmount.trim()}`,
        confidence: Math.min(resident.confidence, lease.confidence),
        includeInImport: false,
        needsReview: true,
      })
    }

    return {
      ...resident,
      fullName,
      unit,
      building: resident.building.trim() || lease.building.trim(),
      leaseStart: resident.leaseStart.trim() || lease.leaseStart.trim(),
      leaseEnd: resident.leaseEnd.trim() || lease.leaseEnd.trim(),
      // Keep rent-roll rent when values conflict; only enrich when missing.
      monthlyRent: rentConflict
        ? resident.monthlyRent.trim()
        : resident.monthlyRent.trim() || lease.rentAmount.trim(),
      needsReview:
        resident.needsReview ||
        rentConflict ||
        resident.confidence < 75 ||
        Boolean(fullName.trim() && !unit.trim()),
    }
  })

  const unmatchedLeases = leases
    .filter((lease) => !matchedLeaseIds.has(lease.id))
    .map((lease) => ({
      ...lease,
      needsReview: true,
      selected: false,
    }))

  return {
    residents: nextResidents,
    conflicts,
    unmatchedLeases,
  }
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

function canonicalExtractedBuilding(
  building: string,
  properties: OnboardingExtractedProperty[],
): string {
  const trimmed = building.trim()
  if (!trimmed || properties.length === 0) return trimmed
  const matches = properties.filter(
    (property) =>
      extractedPlacesOverlap(trimmed, property.name) ||
      extractedPlacesOverlap(trimmed, property.address),
  )
  if (matches.length !== 1) return trimmed
  return matches[0]?.name.trim() || matches[0]?.address.trim() || trimmed
}

function uniqueUnitBuildingForLabel(unit: string, units: OnboardingExtractedUnit[]): string {
  const unitKey = normalizeUnitLabel(unit)
  if (!unitKey) return ''
  const matches = units.filter((row) => normalizeUnitLabel(row.label) === unitKey && row.building.trim())
  if (matches.length !== 1) return ''
  return matches[0]?.building.trim() ?? ''
}

function leaseResidentPlacementMatch(
  lease: Pick<ExtractedLeaseInfo, 'residentName' | 'unit' | 'building'>,
  resident: Pick<OnboardingExtractedResident, 'fullName' | 'unit' | 'building'>,
): boolean {
  return extractedResidentIdentityMatch(
    {
      fullName: lease.residentName,
      unit: lease.unit,
      building: lease.building,
      phone: '',
      email: '',
    },
    {
      fullName: resident.fullName,
      unit: resident.unit,
      building: resident.building,
      phone: '',
      email: '',
    },
  )
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

    // Require identity (name + unit/building) — never steal another tenant's lease by unit alone.
    const leaseMatch = leases.find((lease) => leaseResidentPlacementMatch(lease, resident))
    if (leaseMatch) {
      unit = unit || leaseMatch.unit.trim()
      building = building || leaseMatch.building.trim()
    }

    if (unit && !building) {
      building = uniqueUnitBuildingForLabel(unit, units)
    }

    if (!building && fallbackBuilding) {
      building = fallbackBuilding
    }
    building = canonicalExtractedBuilding(building, properties)

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

    const residentMatch = enrichedResidents.find((resident) =>
      leaseResidentPlacementMatch(lease, resident),
    )
    if (residentMatch) {
      unit = unit || residentMatch.unit.trim()
      building = building || residentMatch.building.trim()
    }

    if (unit && !building) {
      building = uniqueUnitBuildingForLabel(unit, units)
    }

    if (!building && fallbackBuilding) {
      building = fallbackBuilding
    }
    building = canonicalExtractedBuilding(building, properties)

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
  options?: { includeLeaseUnits?: boolean },
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

  // Lease agreements enrich matched residents — they must not invent new units.
  if (options?.includeLeaseUnits) {
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
  }

  return candidates
}

/** Build and enrich unit inventory from explicit unit rows plus tenant/lease placement. */
export function enrichExtractedUnits(
  units: OnboardingExtractedUnit[],
  residents: OnboardingExtractedResident[],
  leases: ExtractedLeaseInfo[],
  properties: OnboardingExtractedProperty[],
  options?: { includeLeaseDerivedUnits?: boolean },
): OnboardingExtractedUnit[] {
  const fallbackBuilding = defaultExtractedBuilding(properties)
  const merged = new Map<string, OnboardingExtractedUnit>()

  const remember = (row: OnboardingExtractedUnit) => {
    const label = row.label.trim()
    if (!label) return
    const building = row.building.trim() || fallbackBuilding
    const key = extractedUnitMatchKey(label, building)
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
  for (const candidate of collectDerivedUnitCandidates(residents, leases, {
    includeLeaseUnits: options?.includeLeaseDerivedUnits === true,
  })) {
    const building = candidate.building.trim() || fallbackBuilding
    const key = extractedUnitMatchKey(candidate.label, building)
    if (merged.has(key)) {
      const existing = merged.get(key)!
      if (!existing.building.trim() && building) {
        merged.set(key, { ...existing, building })
      }
      continue
    }

    const compatible = [...merged.values()].find(
      (row) =>
        normalizeUnitLabel(row.label) === normalizeUnitLabel(candidate.label) &&
        extractedUnitBuildingsMatch(row.building, building),
    )
    if (compatible) {
      const nextBuilding = compatible.building.trim() || building
      merged.delete(extractedUnitMatchKey(compatible.label, compatible.building))
      merged.set(extractedUnitMatchKey(compatible.label, nextBuilding), {
        ...compatible,
        building: nextBuilding,
        confidence: Math.max(compatible.confidence, candidate.confidence),
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

  return collapseExtractedUnits([...merged.values()]).sort((left, right) => {
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

function preferExtractedPropertyName(primary: string, extra: string): string {
  const a = primary.trim()
  const b = extra.trim()
  if (!a) return b
  if (!b) return a
  if (looksLikeStreetAddress(a) && !looksLikeStreetAddress(b)) return b
  if (looksLikeStreetAddress(b) && !looksLikeStreetAddress(a)) return a
  return a.length >= b.length ? a : b
}

function preferExtractedPropertyAddress(primary: string, extra: string): string {
  const a = primary.trim()
  const b = extra.trim()
  if (!a) return b
  if (!b) return a
  if (looksLikeStreetAddress(a) && !looksLikeStreetAddress(b)) return a
  if (looksLikeStreetAddress(b) && !looksLikeStreetAddress(a)) return b
  return a.length >= b.length ? a : b
}

function extractedPropertyRowsMatch(
  left: Pick<OnboardingExtractedProperty, 'name' | 'address'>,
  right: Pick<OnboardingExtractedProperty, 'name' | 'address'>,
): boolean {
  return (
    extractedPlacesOverlap(left.name, right.name) ||
    extractedPlacesOverlap(left.name, right.address) ||
    extractedPlacesOverlap(left.address, right.name) ||
    extractedPlacesOverlap(left.address, right.address)
  )
}

function mergeExtractedPropertyRow(
  primary: OnboardingExtractedProperty,
  extra: OnboardingExtractedProperty,
): OnboardingExtractedProperty {
  const name = preferExtractedPropertyName(primary.name, extra.name)
  const address = preferExtractedPropertyAddress(primary.address, extra.address)
  return {
    ...primary,
    name,
    address,
    city: primary.city.trim() || extra.city.trim(),
    state: primary.state.trim() || extra.state.trim(),
    zipCode: primary.zipCode.trim() || extra.zipCode.trim(),
    propertyType: resolveOnboardingPropertyType(primary.propertyType || extra.propertyType),
    unitCount: Math.max(primary.unitCount, extra.unitCount),
    sourceDocumentName: joinExtractedSourceNames(primary.sourceDocumentName, extra.sourceDocumentName),
    confidence: Math.max(primary.confidence, extra.confidence),
    selected: primary.selected || extra.selected,
    needsReview: primary.needsReview || extra.needsReview,
  }
}

function collapseExtractedProperties(
  rows: OnboardingExtractedProperty[],
): OnboardingExtractedProperty[] {
  const merged: OnboardingExtractedProperty[] = []
  for (const row of rows) {
    const index = merged.findIndex((existing) => extractedPropertyRowsMatch(existing, row))
    if (index === -1) {
      merged.push(row)
      continue
    }
    const current = merged[index]
    if (!current) continue
    merged[index] = mergeExtractedPropertyRow(current, row)
  }
  return merged
}

function extractedUnitBuildingsMatch(left: string, right: string): boolean {
  const a = left.trim()
  const b = right.trim()
  if (!a && !b) return true
  // Same unit number at two named buildings must stay two units.
  if (!a || !b) return false
  return extractedPlacesOverlap(a, b)
}

function collapseExtractedUnits(rows: OnboardingExtractedUnit[]): OnboardingExtractedUnit[] {
  const merged: OnboardingExtractedUnit[] = []
  for (const row of rows) {
    const index = merged.findIndex(
      (existing) =>
        normalizeUnitLabel(existing.label) === normalizeUnitLabel(row.label) &&
        extractedUnitBuildingsMatch(existing.building, row.building),
    )
    if (index === -1) {
      merged.push(row)
      continue
    }
    const current = merged[index]
    if (!current) continue
    merged[index] = {
      ...current,
      label: current.label.trim() || row.label.trim(),
      building: current.building.trim() || row.building.trim(),
      sourceDocumentName: joinExtractedSourceNames(current.sourceDocumentName, row.sourceDocumentName),
      confidence: Math.max(current.confidence, row.confidence),
      selected: current.selected || row.selected,
    }
  }
  return merged
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
  otherPropertyNames: string[] = [],
): number {
  return collectExtractedUnitLabels({
    propertyName: building,
    otherPropertyNames,
    units,
    residents,
    leases,
  }).length
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
    const match = [...merged.values()].find((existing) => extractedPropertyRowsMatch(existing, row))
    if (!match) {
      const key = normalizePropertyIdentityKey(row.name, row.address)
      if (!key) return
      merged.set(key, row)
      return
    }
    const key =
      [...merged.entries()].find(([, value]) => value === match)?.[0] ??
      normalizePropertyIdentityKey(match.name, match.address)
    merged.set(key, mergeExtractedPropertyRow(match, row))
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
  // Lease buildings enrich matched residents — do not invent portfolio properties from leases alone.
  for (const unit of units) {
    noteBuilding(unit.building, unit.sourceDocumentName, unit.confidence)
  }

  let derivedIndex = 0
  for (const [identityKey, meta] of buildingMeta) {
    const existing = [...merged.values()].find(
      (property) =>
        propertyMatchesIdentity(property, identityKey) ||
        extractedPlacesOverlap(property.name, meta.building) ||
        extractedPlacesOverlap(property.address, meta.building),
    )
    const otherPropertyNames = [
      ...[...merged.values()].map((property) => property.name),
      existing?.name ?? '',
      meta.building,
    ].filter(Boolean)
    const unitCount = countUnitsForBuilding(
      existing?.name || meta.building,
      residents,
      leases,
      units,
      otherPropertyNames,
    )

    if (existing) {
      if (unitCount > existing.unitCount) {
        remember({ ...existing, unitCount })
      }
      continue
    }

    const { name, address } = splitPropertyCandidate(meta.building)
    if (!name && !address) continue

    const namedInventory = [...merged.values()].filter((row) => !looksLikeStreetAddress(row.name))
    if (namedInventory.length > 0 && looksLikeStreetAddress(meta.building)) {
      continue
    }

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

  return collapseExtractedProperties([...merged.values()]).sort((left, right) =>
    left.name.localeCompare(right.name),
  )
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
  conflicts: ExtractedReviewItem[]
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

  const units = enrichExtractedUnits(input.units, residents, leases, properties, {
    includeLeaseDerivedUnits: false,
  })
  properties = enrichExtractedProperties(properties, residents, leases, units)
  leases = dedupeOnboardingExtractedLeases(leases)
  const filled = fillExtractedResidentsFromLeases(
    dedupeOnboardingExtractedResidents(residents),
    leases,
  )
  residents = filled.residents
  leases = leases.map((lease) => {
    const unmatched = filled.unmatchedLeases.find((row) => row.id === lease.id)
    return unmatched ?? lease
  })

  const propertyNames = properties.map((property) => property.name)
  properties = properties.map((property) => {
    const labels = collectExtractedUnitLabels({
      propertyName: property.name,
      otherPropertyNames: propertyNames,
      units,
      residents,
      leases,
    })
    return {
      ...property,
      unitCount: labels.length > 0 ? labels.length : Math.max(property.unitCount || 0, 1),
    }
  })

  return {
    properties,
    units,
    residents,
    leases,
    conflicts: [
      ...filled.conflicts,
      ...filled.unmatchedLeases.map((lease) => ({
        id: `ext-unmatched-lease-${lease.id}`,
        uploadedDocumentId: parseUploadedDocumentIdFromExtractedId(lease.id),
        sourceDocumentName: lease.sourceDocumentName,
        dataType: 'unmatched_lease',
        label: 'Lease tenant not on rent roll',
        value: [lease.residentName, formatExtractedUnitPlacement(lease.building, lease.unit)]
          .filter(Boolean)
          .join(' · '),
        confidence: lease.confidence,
        includeInImport: false,
        needsReview: true,
      })),
    ],
  }
}

const MANAGEMENT_COMPANY_HINT =
  /\b(llc|l\.l\.c|inc|incorporated|llp|lp|corp|corporation|management|properties|property management|rentals|holdings|group|partners|associates|realty|real estate)\b/i

export function looksLikeExtractedCompanyName(name: string): boolean {
  const usable = usableOnboardingCompanyName(name)
  if (!usable) return false
  if (looksLikeStreetAddress(usable)) return false
  return MANAGEMENT_COMPANY_HINT.test(usable)
}

function mostFrequentName(names: string[]): string {
  const counts = new Map<string, { value: string; count: number }>()
  for (const raw of names) {
    const key = raw.trim().toLowerCase()
    if (!key) continue
    const current = counts.get(key)
    if (current) current.count += 1
    else counts.set(key, { value: raw.trim(), count: 1 })
  }
  let best = ''
  let bestCount = 0
  for (const row of counts.values()) {
    if (row.count > bestCount) {
      best = row.value
      bestCount = row.count
    }
  }
  return best
}

function payloadAccountField(
  payload: PortfolioDocumentExtractPayload,
  key: 'companyName' | 'contactName' | 'email' | 'phone',
): string {
  const account = payload.account
  if (!account) return ''
  const value = account[key]
  return typeof value === 'string' ? value.trim() : ''
}

/** Landlord / management company from extract payloads, never a tenant name. */
export function collectExtractedAccount(
  payloads: PortfolioDocumentExtractPayload[],
  residentNames: string[] = [],
): OnboardingReviewManualAccount {
  const blocked = new Set(
    residentNames.map((name) => name.trim().toLowerCase()).filter(Boolean),
  )
  const companyFromAccount: string[] = []
  const companyFromProperties: string[] = []
  const contacts: string[] = []
  const emails: string[] = []
  const phones: string[] = []

  for (const payload of payloads) {
    const company = usableOnboardingCompanyName(payloadAccountField(payload, 'companyName'))
    if (company && !blocked.has(company.toLowerCase())) companyFromAccount.push(company)

    const contact = payloadAccountField(payload, 'contactName')
    if (contact && !blocked.has(contact.toLowerCase())) contacts.push(contact)
    const email = payloadAccountField(payload, 'email')
    if (email && !blocked.has(email.toLowerCase())) emails.push(email)
    const phone = payloadAccountField(payload, 'phone')
    if (phone) phones.push(phone)

    for (const property of payload.properties ?? []) {
      const name = usableOnboardingCompanyName(property.name)
      if (name && looksLikeExtractedCompanyName(name) && !blocked.has(name.toLowerCase())) {
        companyFromProperties.push(name)
      }
    }
  }

  return {
    companyName: mostFrequentName(companyFromAccount) || mostFrequentName(companyFromProperties),
    contactName: mostFrequentName(contacts),
    email: mostFrequentName(emails),
    phone: mostFrequentName(phones),
    backupContactName: '',
    backupContactPhone: '',
    smsConsentAcceptedAt: null,
  }
}

function inferredCompanyFromReviewProperties(
  review: Pick<OnboardingExtractionReview, 'properties' | 'residents'>,
): string {
  const blocked = new Set(
    review.residents.map((row) => row.fullName.trim().toLowerCase()).filter(Boolean),
  )
  return mostFrequentName(
    review.properties
      .map((property) => usableOnboardingCompanyName(property.name))
      .filter((name) => looksLikeExtractedCompanyName(name) && !blocked.has(name.toLowerCase())),
  )
}

/** Fill blank Fast Track company/contact fields from extract payloads, profile seed, or company-like property names. */
export function fillExtractionReviewAccount(
  review: OnboardingExtractionReview,
  documents: OnboardingUploadedDocument[] = [],
  accountSeed?: Partial<OnboardingAccountSetup> | null,
): OnboardingExtractionReview {
  const fromDocs = collectExtractedAccount(
    documents
      .map((doc) => doc.extractedPayload)
      .filter((payload): payload is PortfolioDocumentExtractPayload => Boolean(payload)),
    review.residents.map((row) => row.fullName),
  )
  const account = mergeReviewManualAccount(
    mergeReviewManualAccount(review.account, accountSeed),
    mergeReviewManualAccount(fromDocs, {
      ...emptyReviewManualAccount(),
      companyName: inferredCompanyFromReviewProperties(review),
    }),
  )
  if (
    account.companyName === (review.account?.companyName ?? '') &&
    account.contactName === (review.account?.contactName ?? '') &&
    account.email === (review.account?.email ?? '') &&
    account.phone === (review.account?.phone ?? '') &&
    account.backupContactName === (review.account?.backupContactName ?? '') &&
    account.backupContactPhone === (review.account?.backupContactPhone ?? '') &&
    account.smsConsentAcceptedAt === (review.account?.smsConsentAcceptedAt ?? null)
  ) {
    return review
  }
  return { ...review, account }
}

function mergeExtractedDocuments(
  documents: OnboardingUploadedDocument[],
  accountSeed?: Partial<OnboardingAccountSetup> | null,
): OnboardingExtractionReview {
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

  // Process rent rolls first so the portfolio exists before lease enrichment.
  const orderedPayloads = [
    ...payloads.filter(({ doc }) => documentIsRentRoll(doc)),
    ...payloads.filter(({ doc }) => !documentIsRentRoll(doc) && !documentIsLeaseInventory(doc)),
    ...payloads.filter(({ doc }) => documentIsLeaseInventory(doc)),
  ]

  for (const { doc, payload } of orderedPayloads) {
    const source = doc.fileName
    const extractRole = classifyOnboardingDocumentExtractRole(doc)
    const isRentRoll = extractRole === 'rent_roll'
    const isLease = extractRole === 'lease_agreement'

    if (extractRole === 'unknown') {
      needsReview.push({
        id: `ext-warn-unknown-${doc.id}`,
        uploadedDocumentId: doc.id,
        sourceDocumentName: source,
        dataType: 'unknown_document_type',
        label: 'Document type unclear',
        value:
          'Could not tell whether this file is a rent roll or a lease. Review it before importing portfolio data.',
        confidence: 100,
        includeInImport: false,
        needsReview: true,
      })
      // Unknown docs may still contribute vendors / maintenance / financial notes below.
    }

    // Rent roll = source of truth for Properties, Units, and Residents.
    // Lease agreements never independently create those entities.
    if (isRentRoll) {
      payload.properties.forEach((item, index) => {
        const name = cleanOnboardingExtractText(item.name)
        const address = cleanOnboardingExtractText(item.streetAddress)
        if (!name && !address) return
        const needsReviewRow = item.confidence < 75 || !item.city || !item.state
        properties.push({
          id: `ext-prop-${doc.id}-${index}`,
          name: name || address,
          address,
          city: cleanOnboardingExtractText(item.city),
          state: cleanOnboardingExtractText(item.state),
          zipCode: cleanOnboardingExtractText(item.zipCode),
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
        const label = cleanOnboardingExtractText(item.label)
        const building = cleanOnboardingExtractText(item.building)
        if (!label && !building) return
        units.push({
          id: `ext-unit-${doc.id}-${index}`,
          label,
          building,
          sourceDocumentName: source,
          confidence: item.confidence,
          selected: Boolean(item.label.trim()),
        })
      })

      payload.residents.forEach((item, index) => {
        const needsReviewRow = item.confidence < 75
        const leaseMatch = payload.leases.find((lease) =>
          leaseResidentPlacementMatch(
            {
              residentName: cleanOnboardingExtractText(lease.residentName),
              unit: cleanOnboardingExtractText(lease.unit),
              building: cleanOnboardingExtractText(lease.building),
            },
            {
              fullName: cleanOnboardingExtractText(item.fullName),
              unit: cleanOnboardingExtractText(item.unit),
              building: cleanOnboardingExtractText(item.building),
            },
          ),
        )
        const fullName = cleanOnboardingExtractText(
          leaseMatch
            ? preferFullerPersonName(item.fullName, leaseMatch.residentName)
            : item.fullName,
        )
        if (!fullName) return
        residents.push({
          id: `ext-res-${doc.id}-${index}`,
          fullName,
          unit: cleanOnboardingExtractText(item.unit),
          building: cleanOnboardingExtractText(item.building),
          phone: cleanOnboardingExtractText(item.phone),
          email: cleanOnboardingExtractText(item.email),
          leaseStart: cleanOnboardingExtractText(item.leaseStart),
          leaseEnd: cleanOnboardingExtractText(item.leaseEnd),
          monthlyRent: cleanOnboardingExtractText(item.monthlyRent),
      rentDueDay: '',
          occupancyStatus: 'active',
      maintenanceResponsibilitiesClause: '',
          sourceDocumentName: source,
          confidence: item.confidence,
          selected: Boolean(fullName.trim()),
          needsReview: needsReviewRow,
        })
      })
    }

    // Lease Information Found = lease agreements only (enrichment, never roster minting).
    if (isLease) {
      const leaseRowsFromDoc: ExtractedLeaseInfo[] = []
      payload.leases.forEach((item, index) => {
        const residentMatch = payload.residents.find((resident) => {
          const fullName = cleanOnboardingExtractText(resident.fullName)
          // Never let junk/blank resident rows steal the lease tenant name by unit alone.
          if (!fullName) return false
          return leaseResidentPlacementMatch(
            {
              residentName: cleanOnboardingExtractText(item.residentName),
              unit: cleanOnboardingExtractText(item.unit),
              building: cleanOnboardingExtractText(item.building),
            },
            {
              fullName,
              unit: cleanOnboardingExtractText(resident.unit),
              building: cleanOnboardingExtractText(resident.building),
            },
          )
        })
        const residentName = cleanOnboardingExtractText(
          residentMatch
            ? preferFullerPersonName(
                item.residentName,
                cleanOnboardingExtractText(residentMatch.fullName),
              )
            : item.residentName,
        )
        if (!residentName) return
        leaseRowsFromDoc.push({
          id: `ext-lease-${doc.id}-${index}`,
          residentName,
          unit: cleanOnboardingExtractText(item.unit),
          building: cleanOnboardingExtractText(item.building),
          leaseStart: cleanOnboardingExtractText(item.leaseStart),
          leaseEnd: cleanOnboardingExtractText(item.leaseEnd),
          rentAmount: cleanOnboardingExtractText(item.rentAmount),
          securityDeposit: cleanOnboardingExtractText(item.securityDeposit),
          sourceDocumentName: source,
          confidence: item.confidence,
          selected: Boolean(residentName.trim()),
          needsReview: item.confidence < 75,
        })
      })
      leases.push(...collapseLeasesFromSingleAgreement(leaseRowsFromDoc))
    }

    payload.vendors.forEach((item, index) => {
      const name = cleanOnboardingExtractText(item.name)
      if (!name) return
      vendors.push({
        id: `ext-vendor-${doc.id}-${index}`,
        name,
        category: cleanOnboardingExtractText(item.category) || null,
        phone: cleanOnboardingExtractText(item.phone),
        email: cleanOnboardingExtractText(item.email),
      preferredEmergency: false,
        sourceDocumentName: source,
        confidence: item.confidence,
        selected: item.confidence >= 70,
        needsReview: item.confidence < 75,
      })
    })

    payload.maintenanceIssues.forEach((item, index) => {
      const description = cleanOnboardingExtractText(item.description)
      if (!description) return
      maintenanceIssues.push({
        id: `ext-maint-${doc.id}-${index}`,
        unit: cleanOnboardingExtractText(item.unit),
        building: cleanOnboardingExtractText(item.building),
        category: cleanOnboardingExtractText(item.category),
        description,
      priority: item.priority,
        sourceDocumentName: source,
        confidence: item.confidence,
        selected: item.confidence >= 70,
        needsReview: item.confidence < 75,
        imageTags: doc.imageLabels,
      })
    })

    payload.financialRecords.forEach((item, index) => {
      const description = cleanOnboardingExtractText(item.description)
      if (!description) return
      financialRecords.push({
        id: `ext-fin-${doc.id}-${index}`,
        recordType: cleanOnboardingExtractText(item.recordType),
        description,
        amount: cleanOnboardingExtractText(item.amount),
        period: cleanOnboardingExtractText(item.period),
        sourceDocumentName: source,
        confidence: item.confidence,
        selected: item.confidence >= 70,
        needsReview: item.confidence < 75,
      })
    })

    payload.warnings.forEach((warning, index) => {
      const value = cleanOnboardingExtractText(warning)
      if (!value) return
      needsReview.push({
        id: `ext-warn-${doc.id}-${index}`,
        uploadedDocumentId: doc.id,
        sourceDocumentName: source,
        dataType: 'warning',
        label: 'Extraction note',
        value,
        confidence: 100,
        includeInImport: false,
        needsReview: true,
      })
    })

    payload.imageLabels.forEach((label, index) => {
      const value = cleanOnboardingExtractText(label)
      if (!value) return
      imageLabels.push({
        id: `ext-img-${doc.id}-${index}`,
        uploadedDocumentId: doc.id,
        sourceDocumentName: source,
        dataType: 'image_label',
        label: 'Photo label',
        value,
      confidence: 80,
        includeInImport: true,
      needsReview: false,
      })
    })
  }

  const finalized = finalizeExtractionReviewEntities({ properties, units, residents, leases })
  const extractedAccount = collectExtractedAccount(
    payloads.map((row) => row.payload),
    finalized.residents.map((row) => row.fullName),
  )

  return {
    account: mergeReviewManualAccount(accountSeed, extractedAccount),
    properties: finalized.properties,
    units: finalized.units,
    residents: finalized.residents,
    leases: finalized.leases,
    vendors,
    maintenanceIssues,
    financialRecords,
    needsReview: [...needsReview, ...finalized.conflicts],
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
    const leaseMatch = leases.find((lease) => leaseResidentPlacementMatch(lease, resident))
    if (!leaseMatch) return resident
    return {
      ...resident,
      fullName: preferFullerPersonName(resident.fullName, leaseMatch.residentName),
    }
  })
}

function enrichExtractedLeaseNames(
  residents: OnboardingExtractedResident[],
  leases: ExtractedLeaseInfo[],
): ExtractedLeaseInfo[] {
  return leases.map((lease) => {
    const residentMatch = residents.find((resident) =>
      leaseResidentPlacementMatch(lease, resident),
    )
    if (!residentMatch) return lease
    return {
      ...lease,
      residentName: preferFullerPersonName(lease.residentName, residentMatch.fullName),
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
  const normalizedLeases = (review.leases ?? [])
    .map((item) => ({
      ...item,
      residentName: cleanOnboardingExtractText(item.residentName),
      unit: cleanOnboardingExtractText(item.unit),
      building: cleanOnboardingExtractText(item.building),
      rentAmount: cleanOnboardingExtractText(item.rentAmount),
      securityDeposit: cleanOnboardingExtractText(item.securityDeposit),
    }))
    .filter((item) => item.residentName.trim())
  const normalizedUnits = (review.units ?? [])
    .map((item) => ({
      ...item,
      label: cleanOnboardingExtractText(item.label),
      building: cleanOnboardingExtractText(item.building),
    }))
    .filter((item) => item.label.trim() || item.building.trim())
  const normalizedProperties = (review.properties ?? [])
    .map((item) => ({
      ...item,
      name: cleanOnboardingExtractText(item.name),
      address: cleanOnboardingExtractText(item.address),
      city: cleanOnboardingExtractText(item.city ?? ''),
      state: cleanOnboardingExtractText(item.state ?? ''),
      zipCode: cleanOnboardingExtractText(item.zipCode ?? ''),
      propertyType: resolveOnboardingPropertyType(item.propertyType),
      propertyManagerName: item.propertyManagerName ?? '',
      propertyManagerPhone: item.propertyManagerPhone ?? '',
    }))
    .filter((item) => item.name.trim() || item.address.trim())
  const normalizedResidents = (review.residents ?? [])
    .map((item) => ({
      ...item,
      fullName: cleanOnboardingExtractText(item.fullName),
      unit: cleanOnboardingExtractText(item.unit),
      building: cleanOnboardingExtractText(item.building),
      monthlyRent: cleanOnboardingExtractText(item.monthlyRent ?? ''),
      rentDueDay: item.rentDueDay ?? '',
      occupancyStatus: item.occupancyStatus ?? 'active',
      maintenanceResponsibilitiesClause: item.maintenanceResponsibilitiesClause ?? '',
    }))
    .filter((item) => item.fullName.trim())
  const finalized = finalizeExtractionReviewEntities({
    properties: normalizedProperties,
    units: normalizedUnits,
    residents: normalizedResidents,
    leases: normalizedLeases,
  })
  return fillExtractionReviewAccount(
    {
      account: mergeReviewManualAccount(review.account, accountSeed),
      properties: finalized.properties,
      units: finalized.units,
      residents: finalized.residents,
      leases: finalized.leases,
      vendors: (review.vendors ?? [])
        .map((item) => ({
      ...item,
          name: cleanOnboardingExtractText(item.name),
      preferredEmergency: Boolean(item.preferredEmergency),
        }))
        .filter((item) => item.name.trim()),
      maintenanceIssues: (review.maintenanceIssues ?? []).filter(
        (item) => !isOnboardingExtractJunkValue(item.description),
      ),
      financialRecords: (review.financialRecords ?? []).filter(
        (item) => !isOnboardingExtractJunkValue(item.description),
      ),
      needsReview: [
        ...(review.needsReview ?? []).filter(
          (item) => !isOnboardingExtractJunkValue(item.value),
        ),
        ...finalized.conflicts,
      ],
      imageLabels: (review.imageLabels ?? []).filter(
        (item) => !isOnboardingExtractJunkValue(item.value),
      ),
    },
    [],
    accountSeed,
  )
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
