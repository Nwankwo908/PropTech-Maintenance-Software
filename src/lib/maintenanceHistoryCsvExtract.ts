/**
 * Parse maintenance history CSV files into plain job rows (no mock data).
 */
import {
  MAINTENANCE_TRADE_CATEGORIES,
  normalizeTradeCategory,
  type MaintenanceTradeCategory,
} from '@/lib/maintenanceHistoryImport'

export type MaintenanceHistoryCsvJob = {
  vendorName: string
  vendorPhone: string
  vendorEmail: string
  tradeCategory: MaintenanceTradeCategory
  serviceDate: string
  invoiceNumber: string
  totalAmount: string
  laborCost: string
  partsCost: string
  issueType: string
  workPerformed: string
  unitLabel: string
  assetInvolved: string
  paymentStatus: string
  warrantyInfo: string
  notes: string
  confidence: number
}

function normalizeHeader(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[_/]+/g, ' ')
    .replace(/\s+/g, ' ')
}

const HEADER_ALIASES: Record<string, keyof MaintenanceHistoryCsvJob | 'skip'> = {
  vendor: 'vendorName',
  'vendor name': 'vendorName',
  vendorname: 'vendorName',
  company: 'vendorName',
  contractor: 'vendorName',
  phone: 'vendorPhone',
  'vendor phone': 'vendorPhone',
  email: 'vendorEmail',
  'vendor email': 'vendorEmail',
  trade: 'tradeCategory',
  category: 'tradeCategory',
  'trade category': 'tradeCategory',
  date: 'serviceDate',
  'service date': 'serviceDate',
  'work date': 'serviceDate',
  completed: 'serviceDate',
  invoice: 'invoiceNumber',
  'invoice number': 'invoiceNumber',
  'invoice #': 'invoiceNumber',
  amount: 'totalAmount',
  total: 'totalAmount',
  'total amount': 'totalAmount',
  cost: 'totalAmount',
  labor: 'laborCost',
  'labor cost': 'laborCost',
  parts: 'partsCost',
  materials: 'partsCost',
  'parts cost': 'partsCost',
  issue: 'issueType',
  'issue type': 'issueType',
  problem: 'issueType',
  work: 'workPerformed',
  description: 'workPerformed',
  'work performed': 'workPerformed',
  'work description': 'workPerformed',
  unit: 'unitLabel',
  'unit label': 'unitLabel',
  'unit number': 'unitLabel',
  asset: 'assetInvolved',
  equipment: 'assetInvolved',
  'asset involved': 'assetInvolved',
  payment: 'paymentStatus',
  'payment status': 'paymentStatus',
  warranty: 'warrantyInfo',
  'warranty info': 'warrantyInfo',
  notes: 'notes',
  note: 'notes',
  comments: 'notes',
}

function splitCsvLine(line: string): string[] {
  const cells: string[] = []
  let current = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i]!
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"'
        i += 1
      } else {
        inQuotes = !inQuotes
      }
      continue
    }
    if (ch === ',' && !inQuotes) {
      cells.push(current.trim())
      current = ''
      continue
    }
    current += ch
  }
  cells.push(current.trim())
  return cells
}

function parseCsvRows(text: string): string[][] {
  const normalized = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const lines = normalized.split('\n').filter((line) => line.trim().length > 0)
  return lines.map(splitCsvLine)
}

function moneyish(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return ''
  if (/^\$/.test(trimmed)) return trimmed
  const n = Number(trimmed.replace(/,/g, ''))
  if (Number.isFinite(n)) {
    return `$${n.toLocaleString('en-US', { maximumFractionDigits: 2 })}`
  }
  return trimmed
}

function dateish(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return ''
  const iso = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`
  const parsed = Date.parse(trimmed)
  if (!Number.isNaN(parsed)) {
    return new Date(parsed).toISOString().slice(0, 10)
  }
  return trimmed
}

/**
 * Parse a maintenance history CSV into job rows.
 * Throws when headers cannot be mapped or no data rows are found.
 */
export function parseMaintenanceHistoryCsv(text: string): MaintenanceHistoryCsvJob[] {
  const rows = parseCsvRows(text)
  if (rows.length < 2) {
    throw new Error('CSV needs a header row and at least one data row.')
  }

  const headerCells = rows[0]!.map(normalizeHeader)
  const columnMap: Array<keyof MaintenanceHistoryCsvJob | null> = headerCells.map((header) => {
    const mapped = HEADER_ALIASES[header]
    if (!mapped || mapped === 'skip') return null
    return mapped
  })

  if (
    !columnMap.some(
      (key) => key === 'vendorName' || key === 'workPerformed' || key === 'issueType',
    )
  ) {
    throw new Error(
      'CSV headers must include a vendor, work description, or issue column.',
    )
  }

  const jobs: MaintenanceHistoryCsvJob[] = []
  for (let r = 1; r < rows.length; r += 1) {
    const cells = rows[r]!
    const draft: MaintenanceHistoryCsvJob = {
      vendorName: '',
      vendorPhone: '',
      vendorEmail: '',
      tradeCategory: 'Other',
      serviceDate: '',
      invoiceNumber: '',
      totalAmount: '',
      laborCost: '',
      partsCost: '',
      issueType: '',
      workPerformed: '',
      unitLabel: '',
      assetInvolved: '',
      paymentStatus: '',
      warrantyInfo: '',
      notes: '',
      confidence: 0.96,
    }

    columnMap.forEach((key, index) => {
      if (!key) return
      const value = (cells[index] ?? '').trim()
      if (!value) return
      if (key === 'tradeCategory') {
        draft.tradeCategory = normalizeTradeCategory(value)
        return
      }
      if (key === 'totalAmount' || key === 'laborCost' || key === 'partsCost') {
        draft[key] = moneyish(value)
        return
      }
      if (key === 'serviceDate') {
        draft.serviceDate = dateish(value)
        return
      }
      draft[key] = value
    })

    if (
      !draft.vendorName &&
      !draft.workPerformed &&
      !draft.issueType &&
      !draft.totalAmount
    ) {
      continue
    }
    if (!(MAINTENANCE_TRADE_CATEGORIES as readonly string[]).includes(draft.tradeCategory)) {
      draft.tradeCategory = normalizeTradeCategory(draft.tradeCategory)
    }
    jobs.push(draft)
  }

  if (jobs.length === 0) {
    throw new Error('No maintenance rows found in this CSV.')
  }
  return jobs
}
