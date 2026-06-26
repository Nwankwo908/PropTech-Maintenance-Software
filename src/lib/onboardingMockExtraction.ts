/**
 * Mock AI document extraction for onboarding — deterministic demo data until real OCR is wired.
 */
import type { OnboardingProperty } from '@/lib/landlordOnboarding'

export type DocumentCategory =
  | 'lease_agreements'
  | 'rent_roll'
  | 'inspection_report'
  | 'vendor_invoice'
  | 'insurance_certificate'
  | 'maintenance_history'

export type UploadedOnboardingDoc = {
  id: string
  fileName: string
  category: DocumentCategory
}

export type ExtractedProperty = {
  id: string
  name: string
  address: string
  unitCount: number
  selected: boolean
}

export type ExtractedUnit = {
  id: string
  label: string
  building: string
  selected: boolean
}

export type ExtractedResident = {
  id: string
  fullName: string
  unit: string
  building: string
  phone: string
  email: string
  leaseStart: string
  leaseEnd: string
  selected: boolean
}

export type ExtractedVendor = {
  id: string
  name: string
  category: string | null
  phone: string
  email: string
  selected: boolean
}

export type ExtractedMaintenanceIssue = {
  id: string
  unit: string
  building: string
  category: string
  description: string
  priority: string
  selected: boolean
}

export type ExtractedLease = {
  id: string
  residentName: string
  unit: string
  building: string
  leaseStart: string
  leaseEnd: string
  rentAmount?: string
  selected: boolean
}

export type MockExtractionReview = {
  properties: ExtractedProperty[]
  units: ExtractedUnit[]
  residents: ExtractedResident[]
  vendors: ExtractedVendor[]
  maintenanceIssues: ExtractedMaintenanceIssue[]
  leases: ExtractedLease[]
}

const CATEGORY_LABELS: Record<DocumentCategory, string> = {
  lease_agreements: 'Lease agreements',
  rent_roll: 'Rent roll / tenant spreadsheet',
  inspection_report: 'Inspection report',
  vendor_invoice: 'Vendor invoice',
  insurance_certificate: 'Insurance certificate',
  maintenance_history: 'Maintenance history',
}

export function documentCategoryLabel(category: DocumentCategory): string {
  return CATEGORY_LABELS[category]
}

export const DOCUMENT_CATEGORIES: { value: DocumentCategory; label: string }[] = (
  Object.entries(CATEGORY_LABELS) as [DocumentCategory, string][]
).map(([value, label]) => ({ value, label }))

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

function formatAddress(p: OnboardingProperty): string {
  return [p.streetAddress, p.city, p.state, p.zipCode].filter(Boolean).join(', ')
}

function primaryProperty(properties: OnboardingProperty[]): OnboardingProperty | null {
  return properties[0] ?? null
}

/** Build mock extraction results from manual property setup + uploaded doc categories. */
export function buildMockExtractionReview(
  properties: OnboardingProperty[],
  uploadedDocs: UploadedOnboardingDoc[],
): MockExtractionReview {
  const primary = primaryProperty(properties)
  const building = primary?.name?.trim() || 'Sunset Apartments'
  const address = primary ? formatAddress(primary) : '1200 Maple Ave, Newark, NJ 07102'
  const unitCount = primary?.unitCount ?? 4

  const categories = new Set(uploadedDocs.map((d) => d.category))
  const hasRentRoll = categories.has('rent_roll') || categories.has('lease_agreements')
  const hasInspection = categories.has('inspection_report') || categories.has('maintenance_history')
  const hasVendorDoc = categories.has('vendor_invoice')

  const extractedProperties: ExtractedProperty[] = [
    {
      id: 'ext-prop-1',
      name: building,
      address,
      unitCount,
      selected: true,
    },
  ]

  if (categories.has('insurance_certificate') && properties.length <= 1) {
    extractedProperties.push({
      id: 'ext-prop-2',
      name: `${building} — Garage annex`,
      address: address.replace(/\d+/, (n) => String(Number(n) + 2)),
      unitCount: 2,
      selected: false,
    })
  }

  const units: ExtractedUnit[] = []
  for (let i = 1; i <= unitCount; i++) {
    units.push({
      id: `ext-unit-${i}`,
      label: String(100 + i),
      building,
      selected: true,
    })
  }

  const residents: ExtractedResident[] = hasRentRoll
    ? [
        {
          id: 'ext-res-1',
          fullName: 'Jordan Walker',
          unit: '101',
          building,
          phone: '+15555550101',
          email: 'jordan.walker@example.com',
          leaseStart: '2024-03-01',
          leaseEnd: '2026-02-28',
          selected: true,
        },
        {
          id: 'ext-res-2',
          fullName: 'Bianca Silva',
          unit: '102',
          building,
          phone: '+15555550102',
          email: 'bianca.silva@example.com',
          leaseStart: '2023-11-15',
          leaseEnd: '2025-11-14',
          selected: true,
        },
        {
          id: 'ext-res-3',
          fullName: 'Marco Alvarez',
          unit: '103',
          building,
          phone: '+15555550103',
          email: 'marco.alvarez@example.com',
          leaseStart: '2025-01-01',
          leaseEnd: '2026-12-31',
          selected: categories.has('lease_agreements'),
        },
      ]
    : []

  const vendors: ExtractedVendor[] = hasVendorDoc
    ? [
        {
          id: 'ext-vendor-1',
          name: 'Apex Plumbing Co',
          category: 'plumbing',
          phone: '+15555610001',
          email: 'dispatch@apexplumbing.example.com',
          selected: true,
        },
        {
          id: 'ext-vendor-2',
          name: 'Summit HVAC',
          category: null,
          phone: '+15555610003',
          email: 'service@summithvac.example.com',
          selected: true,
        },
      ]
    : hasInspection
      ? [
          {
            id: 'ext-vendor-3',
            name: 'Brightline Electrical',
            category: 'electrical',
            phone: '+15555610004',
            email: 'crew@brightline.example.com',
            selected: false,
          },
        ]
      : []

  const maintenanceIssues: ExtractedMaintenanceIssue[] = hasInspection
    ? [
        {
          id: 'ext-issue-1',
          unit: '102',
          building,
          category: 'hvac',
          description: 'AC condenser rust noted — recommend service before summer.',
          priority: 'normal',
          selected: true,
        },
        {
          id: 'ext-issue-2',
          unit: '104',
          building,
          category: 'plumbing',
          description: 'Minor leak under kitchen sink — slow drip at supply line.',
          priority: 'high',
          selected: true,
        },
      ]
    : []

  return {
    properties: extractedProperties,
    units,
    residents,
    vendors,
    maintenanceIssues,
    leases: [],
  }
}

export function selectAllExtraction<T extends { selected: boolean }>(items: T[]): T[] {
  return items.map((item) => ({ ...item, selected: true }))
}

export function deselectAllExtraction<T extends { selected: boolean }>(items: T[]): T[] {
  return items.map((item) => ({ ...item, selected: false }))
}

export function countSelected<T extends { selected: boolean }>(items: T[]): number {
  return items.filter((i) => i.selected).length
}
