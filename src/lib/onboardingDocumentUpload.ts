/**
 * New Landlord onboarding — bulk document upload, mock OCR pipeline, and extraction review.
 * V1 uses client-side mock processing until real document AI is wired.
 */
import type { MockExtractionReview } from '@/lib/onboardingMockExtraction'

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
  propertyType: string
  unitCount: number
  unitLabels: string
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
  }
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

/** Document upload review: never invent portfolio entities.
 * Real OCR can replace this later; until then New Landlord only keeps what the user enters. */
export function buildOnboardingExtractionReview(
  documents: OnboardingUploadedDocument[],
): OnboardingExtractionReview {
  void documents
  return emptyExtractionReview()
}

export function emptyExtractionReview(): OnboardingExtractionReview {
  return {
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

export function toMockExtractionReview(review: OnboardingExtractionReview): MockExtractionReview {
  return {
    properties: review.properties
      .filter((item) => item.selected)
      .map((item) => ({
        id: item.id,
        name: item.name,
        address: item.address,
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

export function hasExtractionReviewData(review: OnboardingExtractionReview): boolean {
  return (
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
