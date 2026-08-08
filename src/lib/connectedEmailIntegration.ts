export type EmailConfidenceLevel = 'high' | 'medium'

export type EmailDocumentCategory =
  | 'lease'
  | 'invoice'
  | 'inspection'
  | 'insurance'
  | 'vendor'
  | 'rent_roll'

export type EmailDocumentStatus = 'ready' | 'needs_review'

export type DiscoveredDocumentBucket = {
  id: string
  label: string
  count: number
  confidence: EmailConfidenceLevel
}

export type RecentlyDiscoveredDocument = {
  id: string
  name: string
  category: string
  property: string
  dateLabel: string
  confidencePercent: number
  status: EmailDocumentStatus
}

export type RecommendedAction = {
  id: string
  title: string
  detail: string
}

export type EmailActivityItem = {
  id: string
  dayLabel: string
  message: string
}

export const EMAIL_DISCOVERY_CATEGORIES = [
  {
    id: 'property',
    title: 'Property documents',
    icon: 'property',
    items: ['Property deeds', 'Tax records', 'Purchase agreements', 'Insurance policies'],
  },
  {
    id: 'resident',
    title: 'Resident documents',
    icon: 'resident',
    items: ['Lease agreements', 'Move-in documents', 'Resident rosters', 'Renewal notices'],
  },
  {
    id: 'vendor',
    title: 'Vendor documents',
    icon: 'vendor',
    items: ['Vendor contracts', 'Invoices', 'W-9 forms', 'COI certificates'],
  },
  {
    id: 'financial',
    title: 'Financial documents',
    icon: 'financial',
    items: ['Rent rolls', 'Property statements', 'Expense reports', 'Bank reconciliations'],
  },
] as const

export const EMAIL_PRIVACY_POINTS = [
  'Ulo only searches for property-related emails',
  'Nothing is imported without your approval',
  'You can disconnect or pause scanning anytime',
  'Credentials are encrypted and never shared',
]

export const EMAIL_AUTOMATION_TOGGLES = [
  { id: 'new_lease', label: 'New lease found', defaultOn: true },
  { id: 'vendor_invoice', label: 'Vendor invoice received', defaultOn: true },
  { id: 'inspection_report', label: 'Inspection report detected', defaultOn: true },
  { id: 'insurance_expiry', label: 'Insurance document expires', defaultOn: true },
  { id: 'rent_roll', label: 'Rent roll updated', defaultOn: false },
] as const

export function getDiscoveredDocumentBuckets(): DiscoveredDocumentBucket[] {
  return []
}

export function getRecentlyDiscoveredDocuments(): RecentlyDiscoveredDocument[] {
  return []
}

export function getEmailRecommendedActions(): RecommendedAction[] {
  return []
}

export function getEmailActivityFeed(): EmailActivityItem[] {
  return []
}

export function getConnectedEmailAccount() {
  return {
    provider: 'Not connected',
    email: '',
    lastSyncLabel: '—',
    connected: false,
  }
}
