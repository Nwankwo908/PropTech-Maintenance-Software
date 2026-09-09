import {
  asTrimmed,
  clampConfidence,
  cleanExtractedName,
  parseIsoDate,
  parseMoney,
  readField,
  uniqueNames,
} from './parse.ts'
import type { RentRollExtract, RentRollUnitRow, RentRollUnitStatus } from './types.ts'

const SKIP_ROW =
  /\b(subtotal|sub-total|building total|property total|grand total|occupancy summary|summary|footer|total units|totals?)\b/i

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function parseStatus(value: unknown): RentRollUnitStatus | null {
  const text = asTrimmed(value).toLowerCase()
  if (!text) return null
  if (/\bvacant\b/.test(text)) return 'vacant'
  if (/\bnotice\b/.test(text)) return 'notice'
  if (/\bmodel\b/.test(text)) return 'model'
  if (/\b(offline|down|out of service)\b/.test(text)) return 'offline'
  if (/\b(occupied|current|leased)\b/.test(text)) return 'occupied'
  return 'other'
}

function looksLikeSkipRow(row: Record<string, unknown>, unit: string | null, tenants: string[]): boolean {
  const blob = [
    unit ?? '',
    tenants.join(' '),
    asTrimmed(readField(row, ['label', 'description', 'rowType', 'row_type', 'notes'])),
    asTrimmed(readField(row, ['unit', 'unitNumber', 'status'])),
  ].join(' ')
  return SKIP_ROW.test(blob)
}

function normalizeRow(raw: unknown): RentRollUnitRow | null {
  const row = asRecord(raw)
  const unit = cleanExtractedName(
    readField(row, ['unit', 'unit_number', 'unitNumber', 'apt', 'apartment', 'suite', 'label']),
  )
  const tenantsFromArray = uniqueNames(
    readField(row, ['tenant_names', 'tenantNames', 'tenants', 'occupants']),
  )
  const tenants =
    tenantsFromArray.length > 0
      ? tenantsFromArray
      : uniqueNames(
          readField(row, ['tenant', 'resident', 'occupant', 'lease_name', 'resident_name', 'fullName']),
        )
  if (looksLikeSkipRow(row, unit, tenants)) {
    return {
      unit,
      tenant_names: [],
      lease_start: null,
      lease_end: null,
      monthly_rent: null,
      status: null,
      confidence: clampConfidence(row.confidence),
      skipReason: 'summary_or_total_row',
    }
  }

  const status = parseStatus(readField(row, ['status', 'occupancy', 'unit_status', 'unitStatus']))
  const occupiedLike = status == null || status === 'occupied' || status === 'notice'
  return {
    unit,
    tenant_names: occupiedLike ? tenants : [],
    lease_start: parseIsoDate(readField(row, ['lease_start', 'leaseStart', 'start_date', 'move_in', 'lease_from'])),
    lease_end: parseIsoDate(readField(row, ['lease_end', 'leaseEnd', 'end_date', 'expiration', 'lease_to'])),
    monthly_rent: parseMoney(
      readField(row, ['monthly_rent', 'monthlyRent', 'rent', 'current_rent', 'scheduled_rent', 'gross_rent']),
    ),
    status: status ?? (tenants.length > 0 ? 'occupied' : null),
    confidence: clampConfidence(row.confidence),
    skipReason: null,
  }
}

export function normalizeRentRollExtract(raw: unknown): RentRollExtract {
  const root = asRecord(raw)
  const rowsSource = Array.isArray(root.rows)
    ? root.rows
    : Array.isArray(root.units)
      ? root.units
      : Array.isArray(raw)
        ? raw
        : []
  return {
    property_name: cleanExtractedName(root.property_name ?? root.propertyName ?? root.building),
    property_address: cleanExtractedName(root.property_address ?? root.propertyAddress ?? root.address),
    rows: rowsSource.map(normalizeRow).filter((row): row is RentRollUnitRow => Boolean(row)),
    warnings: uniqueNames(root.warnings),
  }
}

export function validateRentRollExtract(extract: RentRollExtract): RentRollExtract {
  const warnings = [...extract.warnings]
  const rows = extract.rows.map((row) => {
    if (row.skipReason) return row
    if (!row.unit) {
      return {
        ...row,
        skipReason: 'missing_unit',
        tenant_names: row.tenant_names,
      }
    }
    if (
      (row.status === 'vacant' || row.status === 'model' || row.status === 'offline') &&
      row.tenant_names.length > 0
    ) {
      warnings.push('Ignored invented or leftover tenant names on a vacant, model, or offline unit.')
      return { ...row, tenant_names: [] }
    }
    return row
  })
  return { ...extract, rows, warnings }
}
