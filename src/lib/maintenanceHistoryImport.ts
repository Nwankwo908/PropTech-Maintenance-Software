/**
 * Maintenance History import — upload invoices/receipts/work orders,
 * AI-extract structured records (mock for day one), landlord review, then save.
 */
import { getActiveLandlordId } from '@/lib/activeLandlord'

export const MAINTENANCE_HISTORY_MAX_BYTES = 10 * 1024 * 1024

export const MAINTENANCE_HISTORY_ACCEPT =
  '.pdf,.jpg,.jpeg,.png,.csv,application/pdf,image/jpeg,image/png,text/csv'

const ACCEPTED_EXT = /\.(pdf|jpe?g|png|csv)$/i

export const MAINTENANCE_TRADE_CATEGORIES = [
  'Appliance Repair',
  'Carpentry',
  'Cleaning',
  'Electrical',
  'Flooring',
  'General / Handyman',
  'HVAC',
  'Landscaping',
  'Locksmith',
  'Painting',
  'Pest Control',
  'Plumbing',
  'Roofing',
  'Windows',
  'Other',
] as const

export type MaintenanceTradeCategory = (typeof MAINTENANCE_TRADE_CATEGORIES)[number]

export type MaintenanceHistoryFileStatus =
  | 'uploading'
  | 'processing'
  | 'ready_for_review'
  | 'needs_attention'
  | 'failed'

export type ExtractedField<T = string> = {
  value: T
  confidence: number
  sourceText?: string | null
}

export type MaintenanceHistoryRecord = {
  id: string
  sourceDocumentId: string
  sourceFileName: string
  vendorName: ExtractedField
  vendorPhone: ExtractedField
  vendorEmail: ExtractedField
  tradeCategory: ExtractedField<MaintenanceTradeCategory>
  serviceDate: ExtractedField
  invoiceNumber: ExtractedField
  totalAmount: ExtractedField
  laborCost: ExtractedField
  partsCost: ExtractedField
  issueType: ExtractedField
  workPerformed: ExtractedField
  propertyName: ExtractedField
  buildingName: ExtractedField
  unitLabel: ExtractedField
  assetInvolved: ExtractedField
  paymentStatus: ExtractedField
  warrantyInfo: ExtractedField
  notes: ExtractedField
  /** Landlord approved this record into operational history. */
  approved: boolean
}

export type MaintenanceHistoryDocument = {
  id: string
  fileName: string
  fileSize: number
  fileType: string
  status: MaintenanceHistoryFileStatus
  uploadedAt: string
  records: MaintenanceHistoryRecord[]
  error?: string
}

export type MaintenanceHistoryFinding = {
  id: string
  text: string
}

export type MaintenanceHistoryInsight = {
  id: string
  label: string
  detail: string
}

export type MaintenanceHistoryScope = {
  landlordId?: string
  building?: string | null
}

export type MaintenanceHistoryImportStep =
  | 'empty'
  | 'upload'
  | 'processing'
  | 'review'
  | 'insights'

function landlordKey(scope: MaintenanceHistoryScope): string {
  return scope.landlordId?.trim() || getActiveLandlordId()
}

function buildingSlug(scope: MaintenanceHistoryScope): string {
  return (scope.building ?? '').trim().toLowerCase().replace(/\s+/g, '-') || 'portfolio'
}

function docsStorageKey(scope: MaintenanceHistoryScope): string {
  return `ulo.maintenanceHistory.docs.${landlordKey(scope)}.${buildingSlug(scope)}`
}

function approvedStorageKey(scope: MaintenanceHistoryScope): string {
  return `ulo.maintenanceHistory.approved.${landlordKey(scope)}.${buildingSlug(scope)}`
}

export function formatHistoryFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function formatHistoryUploadDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export function isAcceptedMaintenanceHistoryFile(file: File): boolean {
  if (ACCEPTED_EXT.test(file.name)) return true
  const type = file.type.toLowerCase()
  return (
    type === 'application/pdf' ||
    type === 'image/jpeg' ||
    type === 'image/png' ||
    type === 'text/csv'
  )
}

export function isCsvMaintenanceHistoryFile(file: File): boolean {
  return /\.csv$/i.test(file.name) || file.type.toLowerCase() === 'text/csv'
}

export function fileTypeLabel(fileName: string): string {
  const ext = fileName.split('.').pop()?.toUpperCase() || 'FILE'
  if (ext === 'JPEG') return 'JPG'
  return ext
}

export function statusLabel(status: MaintenanceHistoryFileStatus): string {
  switch (status) {
    case 'uploading':
      return 'Uploading'
    case 'processing':
      return 'Processing'
    case 'ready_for_review':
      return 'Ready for Review'
    case 'needs_attention':
      return 'Needs Attention'
    case 'failed':
      return 'Failed'
    default:
      return status
  }
}

function hashSeed(value: string): number {
  let h = 0
  for (let i = 0; i < value.length; i += 1) h = (h * 31 + value.charCodeAt(i)) >>> 0
  return h
}

function field<T>(value: T, confidence: number, sourceText?: string | null): ExtractedField<T> {
  return { value, confidence, sourceText: sourceText ?? null }
}

function emptyField(confidence = 0): ExtractedField {
  return field('', confidence, null)
}

const TRADE_ALIASES: Array<{ match: RegExp; category: MaintenanceTradeCategory }> = [
  { match: /applianc/i, category: 'Appliance Repair' },
  { match: /carpent|cabinet|door\s*frame/i, category: 'Carpentry' },
  { match: /clean|janitor/i, category: 'Cleaning' },
  { match: /electr|outlet|wiring/i, category: 'Electrical' },
  { match: /floor|carpet|tile/i, category: 'Flooring' },
  { match: /handyman|general\s*repair/i, category: 'General / Handyman' },
  { match: /hvac|air\s*cond|furnace|heat\s*pump/i, category: 'HVAC' },
  { match: /landscap|lawn|garden/i, category: 'Landscaping' },
  { match: /lock|key/i, category: 'Locksmith' },
  { match: /paint/i, category: 'Painting' },
  { match: /pest|extermin/i, category: 'Pest Control' },
  { match: /plumb|pipe|drain|water\s*heater|faucet/i, category: 'Plumbing' },
  { match: /roof/i, category: 'Roofing' },
  { match: /window|glass/i, category: 'Windows' },
]

export function normalizeTradeCategory(raw: string): MaintenanceTradeCategory {
  const trimmed = raw.trim()
  const exact = MAINTENANCE_TRADE_CATEGORIES.find(
    (c) => c.toLowerCase() === trimmed.toLowerCase(),
  )
  if (exact) return exact
  for (const alias of TRADE_ALIASES) {
    if (alias.match.test(trimmed)) return alias.category
  }
  return 'Other'
}

type SampleJob = {
  vendorName: string
  vendorPhone: string
  vendorEmail: string
  trade: MaintenanceTradeCategory
  issueType: string
  workPerformed: string
  asset: string
  total: number
  labor: number
  parts: number
  monthsAgo: number
  paymentStatus: string
  warranty: string
}

const SAMPLE_JOBS: SampleJob[] = [
  {
    vendorName: 'Flex Plumbing',
    vendorPhone: '(404) 555-0182',
    vendorEmail: 'dispatch@flexplumbing.example',
    trade: 'Plumbing',
    issueType: 'Plumbing repair',
    workPerformed: 'Repaired leaking supply line under kitchen sink and replaced shutoff valve.',
    asset: 'Kitchen sink supply line',
    total: 450,
    labor: 320,
    parts: 130,
    monthsAgo: 6,
    paymentStatus: 'Paid',
    warranty: '90-day parts and labor',
  },
  {
    vendorName: 'Cool Air Co',
    vendorPhone: '(678) 555-0144',
    vendorEmail: 'service@coolair.example',
    trade: 'HVAC',
    issueType: 'HVAC service',
    workPerformed: 'Seasonal tune-up, filter replacement, and refrigerant check.',
    asset: 'Central HVAC unit',
    total: 200,
    labor: 160,
    parts: 40,
    monthsAgo: 4,
    paymentStatus: 'Paid',
    warranty: '30-day service warranty',
  },
  {
    vendorName: 'Flex Plumbing',
    vendorPhone: '(404) 555-0182',
    vendorEmail: 'dispatch@flexplumbing.example',
    trade: 'Plumbing',
    issueType: 'Water heater replacement',
    workPerformed: 'Removed failed 40-gal unit and installed new electric water heater.',
    asset: 'Water heater',
    total: 1200,
    labor: 450,
    parts: 750,
    monthsAgo: 58,
    paymentStatus: 'Paid',
    warranty: '6-year tank warranty',
  },
  {
    vendorName: 'ABC Roofing',
    vendorPhone: '(770) 555-0199',
    vendorEmail: 'jobs@abcroofing.example',
    trade: 'Roofing',
    issueType: 'Roof patch',
    workPerformed: 'Patched storm-damaged shingles on south slope and sealed flashing.',
    asset: 'Roof — south slope',
    total: 800,
    labor: 520,
    parts: 280,
    monthsAgo: 72,
    paymentStatus: 'Paid',
    warranty: '1-year workmanship',
  },
  {
    vendorName: 'Bright Electric LLC',
    vendorPhone: '(404) 555-0171',
    vendorEmail: 'office@brightelectric.example',
    trade: 'Electrical',
    issueType: 'Electrical repair',
    workPerformed: 'Replaced failed GFCI outlets in bathrooms and tested circuit.',
    asset: 'Bathroom GFCI outlets',
    total: 325,
    labor: 250,
    parts: 75,
    monthsAgo: 14,
    paymentStatus: 'Paid',
    warranty: '1-year parts',
  },
]

function money(n: number): string {
  return `$${n.toLocaleString('en-US')}`
}

function isoDateDaysAgo(days: number): string {
  const d = new Date()
  d.setHours(12, 0, 0, 0)
  d.setDate(d.getDate() - days)
  return d.toISOString().slice(0, 10)
}

function formatDisplayDate(isoDate: string): string {
  const d = new Date(`${isoDate}T12:00:00`)
  if (Number.isNaN(d.getTime())) return isoDate
  return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
}

export function createMaintenanceHistoryDocument(file: File): MaintenanceHistoryDocument {
  return {
    id: `mh-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    fileName: file.name,
    fileSize: file.size,
    fileType: fileTypeLabel(file.name),
    status: 'uploading',
    uploadedAt: new Date().toISOString(),
    records: [],
  }
}


export type MaintenanceHistoryPlainJob = {
  vendorName?: string
  vendorPhone?: string
  vendorEmail?: string
  tradeCategory?: string
  serviceDate?: string
  invoiceNumber?: string
  totalAmount?: string
  laborCost?: string
  partsCost?: string
  issueType?: string
  workPerformed?: string
  unitLabel?: string
  assetInvolved?: string
  paymentStatus?: string
  warrantyInfo?: string
  notes?: string
  confidence?: number
}

/** Build review records from real CSV / Edge extract jobs (no sample filler). */
export function recordsFromPlainJobs(
  doc: MaintenanceHistoryDocument,
  building: string,
  jobs: MaintenanceHistoryPlainJob[],
): MaintenanceHistoryRecord[] {
  const property = building.trim() || 'Property'
  return jobs.map((job, i) => {
    const confidence = Math.min(
      1,
      Math.max(0, typeof job.confidence === 'number' ? job.confidence : 0.85),
    )
    const f = (value: string, floor = confidence) =>
      field((value ?? '').trim(), value?.trim() ? floor : 0, value?.trim() || null)
    return {
      id: `mhr-${doc.id}-${i}`,
      sourceDocumentId: doc.id,
      sourceFileName: doc.fileName,
      vendorName: f(job.vendorName ?? ''),
      vendorPhone: f(job.vendorPhone ?? '', Math.min(confidence, 0.9)),
      vendorEmail: f(job.vendorEmail ?? '', Math.min(confidence, 0.88)),
      tradeCategory: field(
        normalizeTradeCategory(job.tradeCategory ?? 'Other'),
        job.tradeCategory?.trim() ? confidence : 0.4,
        job.tradeCategory ?? null,
      ),
      serviceDate: f(job.serviceDate ?? ''),
      invoiceNumber: f(job.invoiceNumber ?? '', Math.min(confidence, 0.9)),
      totalAmount: f(job.totalAmount ?? ''),
      laborCost: f(job.laborCost ?? '', Math.min(confidence, 0.85)),
      partsCost: f(job.partsCost ?? '', Math.min(confidence, 0.85)),
      issueType: f(job.issueType ?? ''),
      workPerformed: f(job.workPerformed ?? ''),
      propertyName: f(property, 0.7),
      buildingName: f(building.trim(), 0.72),
      unitLabel: f(job.unitLabel ?? ''),
      assetInvolved: f(job.assetInvolved ?? ''),
      paymentStatus: f(job.paymentStatus ?? ''),
      warrantyInfo: f(job.warrantyInfo ?? ''),
      notes: f(job.notes ?? '', Math.min(confidence, 0.8)),
      approved: false,
    }
  })
}

/** @deprecated Demo-only mock extract. Prefer recordsFromPlainJobs + real file extract. */
export function simulateMaintenanceHistoryExtract(
  doc: MaintenanceHistoryDocument,
  building: string,
): MaintenanceHistoryRecord[] {
  const seed = hashSeed(doc.fileName.toLowerCase() + doc.id)
  const isCsv = /\.csv$/i.test(doc.fileName)
  const count = isCsv ? 3 + (seed % 2) : 1 + (seed % 2)
  const needsAttention = seed % 11 === 0
  const records: MaintenanceHistoryRecord[] = []

  for (let i = 0; i < count; i += 1) {
    const job = SAMPLE_JOBS[(seed + i) % SAMPLE_JOBS.length]!
    const serviceIso = isoDateDaysAgo(job.monthsAgo * 30 + (seed % 12))
    const invoiceNum = `INV-${(10000 + ((seed + i * 13) % 90000)).toString()}`
    const unit = `Unit ${100 + ((seed + i) % 40)}`
    const lowConfidence = needsAttention && i === 0

    records.push({
      id: `mhr-${doc.id}-${i}`,
      sourceDocumentId: doc.id,
      sourceFileName: doc.fileName,
      vendorName: field(
        job.vendorName,
        lowConfidence ? 0.62 : 0.94 + ((seed % 5) / 100),
        `${job.vendorName} LLC`,
      ),
      vendorPhone: field(job.vendorPhone, 0.88, job.vendorPhone),
      vendorEmail: field(job.vendorEmail, 0.81, job.vendorEmail),
      tradeCategory: field(
        normalizeTradeCategory(job.trade),
        0.91,
        job.trade,
      ),
      serviceDate: field(serviceIso, 0.9, formatDisplayDate(serviceIso)),
      invoiceNumber: field(invoiceNum, 0.86, invoiceNum),
      totalAmount: field(money(job.total), 0.95, money(job.total)),
      laborCost: field(money(job.labor), 0.78, money(job.labor)),
      partsCost: field(money(job.parts), 0.76, money(job.parts)),
      issueType: field(job.issueType, 0.89, job.issueType),
      workPerformed: field(job.workPerformed, 0.84, job.workPerformed),
      propertyName: field(building || 'Property', 0.7, building || null),
      buildingName: field(building || '', 0.72, building || null),
      unitLabel: field(unit, lowConfidence ? 0.48 : 0.8, unit),
      assetInvolved: field(job.asset, 0.83, job.asset),
      paymentStatus: field(job.paymentStatus, 0.87, job.paymentStatus),
      warrantyInfo: field(job.warranty, 0.74, job.warranty),
      notes: lowConfidence
        ? field('Unit number unclear on scan — please confirm.', 0.55, null)
        : emptyField(0),
      approved: false,
    })
  }

  return records
}

export function shouldMarkNeedsAttention(records: MaintenanceHistoryRecord[]): boolean {
  return records.some((r) =>
    [
      r.vendorName,
      r.tradeCategory,
      r.serviceDate,
      r.totalAmount,
      r.unitLabel,
    ].some((f) => f.confidence < 0.7),
  )
}

export function loadMaintenanceHistoryDocuments(
  scope: MaintenanceHistoryScope = {},
): MaintenanceHistoryDocument[] {
  try {
    const raw = window.localStorage.getItem(docsStorageKey(scope))
    if (!raw) {
      // Migrate legacy key shape if present
      const legacy = window.localStorage.getItem(
        `ulo.maintenanceHistory.${landlordKey(scope)}.${buildingSlug(scope)}`,
      )
      if (!legacy) return []
      const parsed = JSON.parse(legacy) as unknown
      if (!Array.isArray(parsed)) return []
      return migrateLegacyDocuments(parsed)
    }
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isDocumentRow).map(normalizeDocument)
  } catch {
    return []
  }
}

function isDocumentRow(row: unknown): row is MaintenanceHistoryDocument {
  return (
    row != null &&
    typeof row === 'object' &&
    typeof (row as MaintenanceHistoryDocument).id === 'string' &&
    typeof (row as MaintenanceHistoryDocument).fileName === 'string'
  )
}

function migrateLegacyDocuments(parsed: unknown[]): MaintenanceHistoryDocument[] {
  return parsed.filter(isDocumentRow).map((row) => {
    const legacy = row as MaintenanceHistoryDocument & {
      extracted?: Array<{
        vendorName?: string
        tradeCategory?: string
        dateLabel?: string
        amountLabel?: string
        issueType?: string
      }>
      status?: string
    }
    const status = mapLegacyStatus(legacy.status)
    const records =
      Array.isArray(legacy.records) && legacy.records.length > 0
        ? legacy.records
        : (legacy.extracted ?? []).map((ex, i) =>
            legacyExtractToRecord(legacy, ex, i),
          )
    return normalizeDocument({
      ...legacy,
      status,
      records,
    })
  })
}

function mapLegacyStatus(status: string | undefined): MaintenanceHistoryFileStatus {
  switch (status) {
    case 'ready':
    case 'ready_for_review':
      return 'ready_for_review'
    case 'extracting':
    case 'processing':
      return 'processing'
    case 'failed':
      return 'failed'
    case 'needs_attention':
      return 'needs_attention'
    case 'uploading':
      return 'uploading'
    default:
      return 'ready_for_review'
  }
}

function legacyExtractToRecord(
  doc: { id: string; fileName: string },
  ex: {
    vendorName?: string
    tradeCategory?: string
    dateLabel?: string
    amountLabel?: string
    issueType?: string
  },
  index: number,
): MaintenanceHistoryRecord {
  return {
    id: `mhr-legacy-${doc.id}-${index}`,
    sourceDocumentId: doc.id,
    sourceFileName: doc.fileName,
    vendorName: field(ex.vendorName ?? '', 0.85),
    vendorPhone: emptyField(),
    vendorEmail: emptyField(),
    tradeCategory: field(normalizeTradeCategory(ex.tradeCategory ?? 'Other'), 0.8),
    serviceDate: field(ex.dateLabel ?? '', 0.8),
    invoiceNumber: emptyField(),
    totalAmount: field(ex.amountLabel ?? '', 0.85),
    laborCost: emptyField(),
    partsCost: emptyField(),
    issueType: field(ex.issueType ?? '', 0.8),
    workPerformed: emptyField(),
    propertyName: emptyField(),
    buildingName: emptyField(),
    unitLabel: emptyField(),
    assetInvolved: emptyField(),
    paymentStatus: emptyField(),
    warrantyInfo: emptyField(),
    notes: emptyField(),
    approved: false,
  }
}

function normalizeDocument(row: MaintenanceHistoryDocument): MaintenanceHistoryDocument {
  return {
    ...row,
    status: mapLegacyStatus(row.status),
    records: Array.isArray(row.records) ? row.records : [],
  }
}

export function saveMaintenanceHistoryDocuments(
  docs: MaintenanceHistoryDocument[],
  scope: MaintenanceHistoryScope = {},
): void {
  try {
    window.localStorage.setItem(docsStorageKey(scope), JSON.stringify(docs))
  } catch {
    // private mode / quota
  }
}

export function loadApprovedMaintenanceRecords(
  scope: MaintenanceHistoryScope = {},
): MaintenanceHistoryRecord[] {
  try {
    const raw = window.localStorage.getItem(approvedStorageKey(scope))
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (row): row is MaintenanceHistoryRecord =>
        row != null &&
        typeof row === 'object' &&
        typeof (row as MaintenanceHistoryRecord).id === 'string',
    )
  } catch {
    return []
  }
}

export function saveApprovedMaintenanceRecords(
  records: MaintenanceHistoryRecord[],
  scope: MaintenanceHistoryScope = {},
): void {
  try {
    window.localStorage.setItem(approvedStorageKey(scope), JSON.stringify(records))
  } catch {
    // private mode / quota
  }
}

export function listPendingReviewRecords(
  docs: MaintenanceHistoryDocument[],
): MaintenanceHistoryRecord[] {
  return docs
    .filter((d) => d.status === 'ready_for_review' || d.status === 'needs_attention')
    .flatMap((d) => d.records.filter((r) => !r.approved))
}

export function deriveImportStep(
  docs: MaintenanceHistoryDocument[],
  approved: MaintenanceHistoryRecord[],
): MaintenanceHistoryImportStep {
  if (docs.some((d) => d.status === 'uploading' || d.status === 'processing')) {
    return 'processing'
  }
  if (listPendingReviewRecords(docs).length > 0) return 'review'
  if (approved.length > 0 || docs.length > 0) return 'insights'
  return 'empty'
}

export function buildMaintenanceHistoryFindings(
  records: MaintenanceHistoryRecord[],
): MaintenanceHistoryFinding[] {
  if (records.length === 0) return []

  const findings: MaintenanceHistoryFinding[] = []
  const vendorCounts = new Map<string, number>()
  const tradeCounts = new Map<string, number>()

  for (const row of records) {
    const vendor = row.vendorName.value.trim()
    const trade = row.tradeCategory.value
    if (vendor) vendorCounts.set(vendor, (vendorCounts.get(vendor) ?? 0) + 1)
    if (trade) tradeCounts.set(trade, (tradeCounts.get(trade) ?? 0) + 1)
  }

  const roof = records.find((r) => /roof/i.test(r.issueType.value) || r.tradeCategory.value === 'Roofing')
  if (roof) {
    const yearMatch = roof.serviceDate.value.match(/\b(19|20)\d{2}\b/)
    findings.push({
      id: 'roof',
      text: yearMatch
        ? `Roof work recorded in ${yearMatch[0]}`
        : `Roof work on file (${formatDisplayDate(roof.serviceDate.value) || roof.serviceDate.value})`,
    })
  }

  const hvac = records.find((r) => r.tradeCategory.value === 'HVAC')
  if (hvac) {
    findings.push({
      id: 'hvac',
      text: `HVAC serviced ${formatDisplayDate(hvac.serviceDate.value) || hvac.serviceDate.value}`,
    })
  }

  const waterHeater = records.find((r) => /water\s*heater/i.test(r.issueType.value + r.assetInvolved.value))
  if (waterHeater) {
    const yearMatch = waterHeater.serviceDate.value.match(/\b(19|20)\d{2}\b/)
    const year = yearMatch ? Number(yearMatch[0]) : null
    const age =
      year != null && Number.isFinite(year)
        ? Math.max(1, new Date().getFullYear() - year)
        : 8
    findings.push({
      id: 'water-heater',
      text: `Water heater estimated age: ${age} years`,
    })
  }

  const plumbingCount = tradeCounts.get('Plumbing') ?? 0
  if (plumbingCount >= 2) {
    findings.push({
      id: 'plumbing-recurring',
      text: `${plumbingCount === 2 ? 'Two' : plumbingCount} recurring plumbing repairs`,
    })
  } else {
    const recurring = [...tradeCounts.entries()]
      .filter(([, count]) => count >= 2)
      .sort((a, b) => b[1] - a[1])[0]
    if (recurring) {
      findings.push({
        id: 'recurring',
        text: `${recurring[1]} recurring ${recurring[0].toLowerCase()} jobs`,
      })
    }
  }

  const topVendor = [...vendorCounts.entries()].sort((a, b) => b[1] - a[1])[0]
  if (topVendor) {
    findings.push({
      id: 'top-vendor',
      text: `Top vendor: ${topVendor[0]} (${topVendor[1]} job${topVendor[1] === 1 ? '' : 's'})`,
    })
  }

  if (findings.length === 0) {
    findings.push({
      id: 'events',
      text: `${records.length} maintenance event${records.length === 1 ? '' : 's'} ready from uploaded files`,
    })
  }

  return findings.slice(0, 5)
}

export function buildMaintenanceHistoryInsights(
  records: MaintenanceHistoryRecord[],
): MaintenanceHistoryInsight[] {
  return buildMaintenanceHistoryFindings(records).map((finding) => ({
    id: finding.id,
    label: 'Finding',
    detail: finding.text,
  }))
}

export function updateRecordField(
  record: MaintenanceHistoryRecord,
  key: keyof Pick<
    MaintenanceHistoryRecord,
    | 'vendorName'
    | 'vendorPhone'
    | 'vendorEmail'
    | 'tradeCategory'
    | 'serviceDate'
    | 'invoiceNumber'
    | 'totalAmount'
    | 'laborCost'
    | 'partsCost'
    | 'issueType'
    | 'workPerformed'
    | 'unitLabel'
    | 'assetInvolved'
    | 'paymentStatus'
    | 'warrantyInfo'
    | 'notes'
  >,
  value: string,
): MaintenanceHistoryRecord {
  if (key === 'tradeCategory') {
    return {
      ...record,
      tradeCategory: {
        value: normalizeTradeCategory(value),
        confidence: 1,
        sourceText: value,
      },
    }
  }
  return {
    ...record,
    [key]: {
      ...record[key],
      value,
      confidence: 1,
    },
  }
}

/** @deprecated Prefer timeline from approved records. */
export type MaintenanceHistoryExtractedRow = {
  vendorName: string
  tradeCategory: string
  dateLabel: string
  amountLabel: string
  issueType: string
}

export function recordToTimelineRow(record: MaintenanceHistoryRecord): MaintenanceHistoryExtractedRow {
  return {
    vendorName: record.vendorName.value,
    tradeCategory: record.tradeCategory.value,
    dateLabel: formatDisplayDate(record.serviceDate.value) || record.serviceDate.value,
    amountLabel: record.totalAmount.value,
    issueType: record.issueType.value || record.tradeCategory.value,
  }
}
