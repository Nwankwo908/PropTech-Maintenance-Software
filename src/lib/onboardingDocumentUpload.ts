import { getErrorMessage } from '@/lib/errorMessage'
/**
 * New Landlord onboarding — bulk document upload, mock OCR pipeline, and extraction review.
 * V1 uses client-side mock processing until real document AI is wired.
 * File bytes are stored in the landlord-onboarding-documents bucket for later preview.
 */
import type { OnboardingAccountSetup, OnboardingOccupancyStatus } from '@/lib/onboarding'
import {
  buildMockExtractionReview,
  type DocumentCategory,
  type MockExtractionReview,
  type UploadedOnboardingDoc,
} from '@/lib/onboardingMockExtraction'
import {
  emptyReviewManualAccount,
  normalizeReviewManualAccount,
  type OnboardingReviewManualAccount,
} from '@/lib/onboardingReviewManual'
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
  if (/lease|rental/.test(lower)) return 'lease_agreement'
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
    imageLabels: isImageExtension(ext)
      ? ['Water damage', 'Roof issue', 'HVAC unit', 'Kitchen appliance', 'Electrical panel'].slice(
          0,
          2 + (file.name.length % 3),
        )
      : [],
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

/** Mock async pipeline — digitizing, scanning, OCR, optional handwriting pass. */
export async function runMockDocumentProcessing(
  doc: OnboardingUploadedDocument,
  onUpdate: (updated: OnboardingUploadedDocument) => void,
  signal?: AbortSignal,
): Promise<OnboardingUploadedDocument> {
  let current = { ...doc, uploadStatus: 'uploading' as UploadFileStatus, processingLabel: UPLOAD_STATUS_LABELS.uploading }

  for (let progress = 0; progress <= 100; progress += 20) {
    if (signal?.aborted) return current
    current = { ...current, uploadProgress: progress }
    onUpdate(current)
    await sleep(120)
  }

  const stages: Array<{ status: UploadFileStatus; label: string; ms: number }> = [
    { status: 'digitizing', label: UPLOAD_STATUS_LABELS.digitizing, ms: 650 },
    { status: 'scanning', label: UPLOAD_STATUS_LABELS.scanning, ms: isScannedDocument(`.${doc.fileType}`) ? 750 : 450 },
    { status: 'extracting', label: UPLOAD_STATUS_LABELS.extracting, ms: 800 },
  ]

  if (doc.hasHandwriting) {
    stages.push({ status: 'handwriting', label: UPLOAD_STATUS_LABELS.handwriting, ms: 600 })
  }

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

  const needsAttention = doc.documentCategory === 'unknown'
  current = {
    ...current,
    uploadStatus: needsAttention ? 'needs_attention' : 'ready_for_review',
    extractionStatus: needsAttention ? 'needs_attention' : 'ready_for_review',
    processingLabel: UPLOAD_STATUS_LABELS[needsAttention ? 'needs_attention' : 'ready_for_review'],
    uploadProgress: 100,
  }
  onUpdate(current)
  return current
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

function mapUploadCategoryToMock(category: OnboardingDocumentCategory): DocumentCategory {
  switch (category) {
    case 'lease_agreement':
    case 'move_in_document':
      return 'lease_agreements'
    case 'resident_roster':
    case 'rent_roll':
      return 'rent_roll'
    case 'inspection_report':
      return 'inspection_report'
    case 'vendor_invoice':
    case 'vendor_contract':
    case 'w9_form':
      return 'vendor_invoice'
    case 'insurance_certificate':
      return 'insurance_certificate'
    case 'expense_report':
    case 'property_statement':
      return 'maintenance_history'
    default:
      return 'lease_agreements'
  }
}

function parseAddressParts(address: string): { street: string; city: string; state: string; zipCode: string } {
  const parts = address.split(',').map((part) => part.trim()).filter(Boolean)
  if (parts.length >= 3) {
    const stateZip = parts[parts.length - 1] ?? ''
    const stateZipMatch = stateZip.match(/^([A-Za-z]{2})\s+(\d{5}(?:-\d{4})?)$/)
    return {
      street: parts[0] ?? '',
      city: parts[parts.length - 2] ?? '',
      state: stateZipMatch?.[1]?.toUpperCase() ?? stateZip.slice(0, 2).toUpperCase(),
      zipCode: stateZipMatch?.[2] ?? '',
    }
  }
  return { street: address.trim(), city: '', state: '', zipCode: '' }
}

/** Build extraction review from uploaded docs (mock OCR) + empty manual account seed. */
export function buildOnboardingExtractionReview(
  documents: OnboardingUploadedDocument[],
  accountSeed?: Partial<OnboardingAccountSetup> | null,
): OnboardingExtractionReview {
  const account = emptyReviewManualAccount(accountSeed)
  if (documents.length === 0) {
    return emptyExtractionReview(accountSeed)
  }

  const mockDocs: UploadedOnboardingDoc[] = documents.map((doc) => ({
    id: doc.id,
    fileName: doc.fileName,
    category: mapUploadCategoryToMock(doc.documentCategory),
  }))
  const mock = buildMockExtractionReview([], mockDocs)
  const sourceName = documents[0]?.fileName ?? 'Uploaded document'

  return {
    account,
    properties: mock.properties.map((item) => {
      const parts = parseAddressParts(item.address)
      return {
        id: item.id,
        name: item.name,
        address: parts.street || item.address,
        city: parts.city,
        state: parts.state,
        zipCode: parts.zipCode,
        propertyType: 'multifamily',
        unitCount: item.unitCount,
        unitLabels: Array.from({ length: item.unitCount }, (_, i) => String(101 + i)).join(', '),
        propertyManagerName: '',
        propertyManagerPhone: '',
        sourceDocumentName: sourceName,
        confidence: 86,
        selected: item.selected,
        needsReview: !parts.city || !parts.state || !parts.zipCode,
      }
    }),
    units: mock.units.map((item) => ({
      id: item.id,
      label: item.label,
      building: item.building,
      sourceDocumentName: sourceName,
      confidence: 90,
      selected: item.selected,
    })),
    residents: mock.residents.map((item) => ({
      id: item.id,
      fullName: item.fullName,
      unit: item.unit,
      building: item.building,
      phone: item.phone,
      email: item.email,
      leaseStart: item.leaseStart,
      leaseEnd: item.leaseEnd,
      monthlyRent: '',
      rentDueDay: '',
      occupancyStatus: 'active' as const,
      maintenanceResponsibilitiesClause: '',
      sourceDocumentName: sourceName,
      confidence: 84,
      selected: item.selected,
      needsReview: true,
    })),
    leases: mock.leases.map((item) => ({
      id: item.id,
      residentName: item.residentName,
      unit: item.unit,
      building: item.building,
      leaseStart: item.leaseStart,
      leaseEnd: item.leaseEnd,
      rentAmount: item.rentAmount ?? '',
      securityDeposit: '',
      sourceDocumentName: sourceName,
      confidence: 82,
      selected: item.selected,
      needsReview: false,
    })),
    vendors: mock.vendors.map((item) => ({
      id: item.id,
      name: item.name,
      category: item.category,
      phone: item.phone,
      email: item.email,
      preferredEmergency: false,
      sourceDocumentName: sourceName,
      confidence: 83,
      selected: item.selected,
      needsReview: false,
    })),
    maintenanceIssues: mock.maintenanceIssues.map((item) => ({
      id: item.id,
      unit: item.unit,
      building: item.building,
      category: item.category,
      description: item.description,
      priority: item.priority,
      sourceDocumentName: sourceName,
      confidence: 80,
      selected: item.selected,
      needsReview: false,
    })),
    financialRecords: [],
    needsReview: [],
    imageLabels: [],
  }
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
  return {
    account: normalizeReviewManualAccount(review.account ?? accountSeed),
    properties: (review.properties ?? []).map((item) => ({
      ...item,
      city: item.city ?? '',
      state: item.state ?? '',
      zipCode: item.zipCode ?? '',
      propertyType: item.propertyType || 'multifamily',
      propertyManagerName: item.propertyManagerName ?? '',
      propertyManagerPhone: item.propertyManagerPhone ?? '',
    })),
    units: review.units ?? [],
    residents: (review.residents ?? []).map((item) => ({
      ...item,
      monthlyRent: item.monthlyRent ?? '',
      rentDueDay: item.rentDueDay ?? '',
      occupancyStatus: item.occupancyStatus ?? 'active',
      maintenanceResponsibilitiesClause: item.maintenanceResponsibilitiesClause ?? '',
    })),
    leases: review.leases ?? [],
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
