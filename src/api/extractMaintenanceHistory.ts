/**
 * POST extract-maintenance-history — OCR/LLM extract for PDF/image invoices.
 * Auth: VITE_ADMIN_REASSIGN_SECRET (same as other admin Edge calls).
 */
import {
  adminEdgeInvokeHeaders,
  fetchAdminEdgeFunction,
  formatAdminEdgeUnauthorizedError,
  getAdminEdgeSecret,
} from '@/lib/adminEdgeAuth'

export type ExtractedMaintenanceHistoryJob = {
  vendorName: string
  vendorPhone: string
  vendorEmail: string
  tradeCategory: string
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

export type ExtractMaintenanceHistoryResult = {
  ok: true
  records: ExtractedMaintenanceHistoryJob[]
  warnings: string[]
  method: string
}

function resolveExtractMaintenanceHistoryUrl(): string | null {
  const explicit = import.meta.env.VITE_EXTRACT_MAINTENANCE_HISTORY_URL?.trim()
  if (explicit) return explicit

  const reassign = import.meta.env.VITE_ADMIN_REASSIGN_URL?.trim()
  if (reassign) {
    return reassign.replace(/admin-reassign-vendor\/?$/, 'extract-maintenance-history')
  }

  const base = import.meta.env.VITE_SUPABASE_URL?.trim()?.replace(/\/$/, '')
  if (!base) return null
  return `${base}/functions/v1/extract-maintenance-history`
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('Could not read this file.'))
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : ''
      const base64 = result.includes(',') ? result.slice(result.indexOf(',') + 1) : result
      if (!base64) {
        reject(new Error('Could not encode this file.'))
        return
      }
      resolve(base64)
    }
    reader.readAsDataURL(file)
  })
}

function asString(row: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const value = row[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
    if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  }
  return ''
}

function asJob(raw: unknown): ExtractedMaintenanceHistoryJob | null {
  if (!raw || typeof raw !== 'object') return null
  const row = raw as Record<string, unknown>
  const confidenceRaw = row.confidence
  const confidence =
    typeof confidenceRaw === 'number' && Number.isFinite(confidenceRaw)
      ? Math.min(1, Math.max(0, confidenceRaw > 1 ? confidenceRaw / 100 : confidenceRaw))
      : 0.8

  const vendorName = asString(row, 'vendorName', 'vendor')
  const workPerformed = asString(row, 'workPerformed', 'description', 'work')
  const issueType = asString(row, 'issueType', 'issue')
  const totalAmount = asString(row, 'totalAmount', 'amount', 'total')
  if (!vendorName && !workPerformed && !issueType && !totalAmount) return null

  return {
    vendorName,
    vendorPhone: asString(row, 'vendorPhone', 'phone'),
    vendorEmail: asString(row, 'vendorEmail', 'email'),
    tradeCategory: asString(row, 'tradeCategory', 'trade', 'category') || 'Other',
    serviceDate: asString(row, 'serviceDate', 'date'),
    invoiceNumber: asString(row, 'invoiceNumber', 'invoice'),
    totalAmount,
    laborCost: asString(row, 'laborCost', 'labor'),
    partsCost: asString(row, 'partsCost', 'parts', 'materials'),
    issueType,
    workPerformed,
    unitLabel: asString(row, 'unitLabel', 'unit'),
    assetInvolved: asString(row, 'assetInvolved', 'asset', 'equipment'),
    paymentStatus: asString(row, 'paymentStatus', 'payment', 'status'),
    warrantyInfo: asString(row, 'warrantyInfo', 'warranty'),
    notes: asString(row, 'notes'),
    confidence,
  }
}

export async function extractMaintenanceHistoryFromFile(input: {
  file: File
  buildingName?: string
}): Promise<ExtractMaintenanceHistoryResult> {
  const url = resolveExtractMaintenanceHistoryUrl()
  const secret = getAdminEdgeSecret()
  if (!url || !secret) {
    throw new Error(
      'Maintenance history extract is not configured (missing admin Edge URL or VITE_ADMIN_REASSIGN_SECRET).',
    )
  }

  const fileBase64 = await fileToBase64(input.file)
  const res = await fetchAdminEdgeFunction(url, {
    method: 'POST',
    headers: adminEdgeInvokeHeaders(secret),
    body: JSON.stringify({
      fileName: input.file.name,
      contentType: input.file.type || 'application/octet-stream',
      buildingName: input.buildingName?.trim() || undefined,
      fileBase64,
    }),
  })

  const payload = (await res.json().catch(() => ({}))) as {
    error?: string
    ok?: boolean
    records?: unknown
    warnings?: unknown
    method?: unknown
  }

  if (res.status === 401) {
    throw new Error(
      formatAdminEdgeUnauthorizedError('Maintenance history extract'),
    )
  }

  if (!res.ok || !payload.ok) {
    throw new Error(
      typeof payload.error === 'string' && payload.error.trim()
        ? payload.error
        : `Could not extract maintenance history (${res.status}).`,
    )
  }

  const records = Array.isArray(payload.records)
    ? payload.records
        .map(asJob)
        .filter((row): row is ExtractedMaintenanceHistoryJob => row != null)
    : []

  return {
    ok: true,
    records,
    warnings: Array.isArray(payload.warnings)
      ? payload.warnings.filter(
          (w): w is string => typeof w === 'string' && w.trim().length > 0,
        )
      : [],
    method: typeof payload.method === 'string' ? payload.method : 'unknown',
  }
}
