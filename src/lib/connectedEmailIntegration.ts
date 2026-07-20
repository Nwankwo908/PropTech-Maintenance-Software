import { isDemoAccountActive } from '@/lib/activeLandlord'

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

export const CONNECTED_EMAIL_ACCOUNT = {
  provider: 'Google Workspace',
  email: 'ops@ulohome.com',
  lastSyncLabel: 'Today · 9:42 AM',
  connected: true,
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

export const DISCOVERED_DOCUMENT_BUCKETS: DiscoveredDocumentBucket[] = [
  { id: 'leases', label: 'Lease agreements', count: 18, confidence: 'high' },
  { id: 'invoices', label: 'Vendor invoices', count: 14, confidence: 'high' },
  { id: 'inspections', label: 'Inspection reports', count: 9, confidence: 'medium' },
  { id: 'insurance', label: 'Insurance documents', count: 6, confidence: 'high' },
  { id: 'rent_rolls', label: 'Rent rolls', count: 5, confidence: 'medium' },
  { id: 'other', label: 'Other property files', count: 25, confidence: 'medium' },
]

export const RECENTLY_DISCOVERED_DOCUMENTS: RecentlyDiscoveredDocument[] = [
  {
    id: '1',
    name: 'Lease_Unit204.pdf',
    category: 'Lease agreement',
    property: 'Oakwood Apartments',
    dateLabel: 'Jul 15',
    confidencePercent: 99,
    status: 'ready',
  },
  {
    id: '2',
    name: 'HVAC_Invoice_March.pdf',
    category: 'Vendor invoice',
    property: 'Maple Court',
    dateLabel: 'Jul 14',
    confidencePercent: 96,
    status: 'ready',
  },
  {
    id: '3',
    name: 'Inspection_Report_BldgA.pdf',
    category: 'Inspection report',
    property: 'Riverfront Lofts',
    dateLabel: 'Jul 13',
    confidencePercent: 88,
    status: 'needs_review',
  },
  {
    id: '4',
    name: 'COI_2026.pdf',
    category: 'Insurance certificate',
    property: 'Portfolio-wide',
    dateLabel: 'Jul 12',
    confidencePercent: 94,
    status: 'ready',
  },
  {
    id: '5',
    name: 'RentRoll_June.xlsx',
    category: 'Rent roll',
    property: 'Oakwood Apartments',
    dateLabel: 'Jul 11',
    confidencePercent: 91,
    status: 'needs_review',
  },
]

export const EMAIL_RECOMMENDED_ACTIONS: RecommendedAction[] = [
  {
    id: 'residents',
    title: 'Create 12 resident profiles',
    detail: 'Ulo matched lease PDFs to vacant unit records.',
  },
  {
    id: 'vendors',
    title: 'Import 5 vendors',
    detail: 'New W-9 and invoice senders detected this week.',
  },
  {
    id: 'insurance',
    title: 'Renew 2 insurance policies',
    detail: 'Expiration dates found in attached certificates.',
  },
  {
    id: 'inspections',
    title: 'Schedule 3 follow-up inspections',
    detail: 'Open findings were flagged in recent reports.',
  },
]

export const EMAIL_PRIVACY_POINTS = [
  'Ulo only searches for property-related emails',
  'Nothing is imported without your approval',
  'You can disconnect or pause scanning anytime',
  'Credentials are encrypted and never shared',
]

export const EMAIL_ACTIVITY_FEED: EmailActivityItem[] = [
  { id: '1', dayLabel: 'Today', message: 'Found 4 lease agreements in ops@ulohome.com' },
  { id: '2', dayLabel: 'Today', message: 'Synced 22 attachments from the last 90 days' },
  { id: '3', dayLabel: 'Yesterday', message: 'Flagged 2 insurance documents expiring soon' },
  { id: '4', dayLabel: 'Yesterday', message: 'Suggested 5 vendor imports for review' },
]

export const EMAIL_AUTOMATION_TOGGLES = [
  { id: 'new_lease', label: 'New lease found', defaultOn: true },
  { id: 'vendor_invoice', label: 'Vendor invoice received', defaultOn: true },
  { id: 'inspection_report', label: 'Inspection report detected', defaultOn: true },
  { id: 'insurance_expiry', label: 'Insurance document expires', defaultOn: true },
  { id: 'rent_roll', label: 'Rent roll updated', defaultOn: false },
] as const

/** Showcase discovery panels — demo account only. */
export function getDiscoveredDocumentBuckets(): DiscoveredDocumentBucket[] {
  return isDemoAccountActive() ? DISCOVERED_DOCUMENT_BUCKETS : []
}

export function getRecentlyDiscoveredDocuments(): RecentlyDiscoveredDocument[] {
  return isDemoAccountActive() ? RECENTLY_DISCOVERED_DOCUMENTS : []
}

export function getEmailRecommendedActions(): RecommendedAction[] {
  return isDemoAccountActive() ? EMAIL_RECOMMENDED_ACTIONS : []
}

export function getEmailActivityFeed(): EmailActivityItem[] {
  return isDemoAccountActive() ? EMAIL_ACTIVITY_FEED : []
}

export function getConnectedEmailAccount() {
  if (isDemoAccountActive()) return CONNECTED_EMAIL_ACCOUNT
  return {
    provider: 'Not connected',
    email: '',
    lastSyncLabel: '—',
    connected: false,
  }
}
