import {
  clampConfidence,
  cleanExtractedName,
  parseIsoDate,
  parseMoney,
  uniqueNames,
} from './parse.ts'
import type { LeaseExtract } from './types.ts'

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function namesFrom(root: Record<string, unknown>, keys: string[]): string[] {
  for (const key of keys) {
    if (key in root) return uniqueNames(root[key])
  }
  return []
}

export function normalizeLeaseExtract(raw: unknown): LeaseExtract {
  const root = asRecord(raw)
  const tenant_names = namesFrom(root, ['tenant_names', 'tenantNames', 'tenants', 'lessees'])
  const singleTenant = cleanExtractedName(root.tenant_name ?? root.tenant ?? root.lessee)
  return {
    landlord_name: cleanExtractedName(root.landlord_name ?? root.landlord ?? root.lessor),
    tenant_names: tenant_names.length > 0 ? tenant_names : singleTenant ? [singleTenant] : [],
    guarantor_names: namesFrom(root, ['guarantor_names', 'guarantorNames', 'guarantors', 'cosigners', 'co_signers']),
    property_manager_name: cleanExtractedName(
      root.property_manager_name ?? root.property_manager ?? root.leasing_agent ?? root.agent,
    ),
    property_address: cleanExtractedName(root.property_address ?? root.premises ?? root.address),
    unit: cleanExtractedName(root.unit ?? root.apartment ?? root.apt),
    lease_start: parseIsoDate(root.lease_start ?? root.leaseStart ?? root.start_date),
    lease_end: parseIsoDate(root.lease_end ?? root.leaseEnd ?? root.end_date),
    monthly_rent: parseMoney(root.monthly_rent ?? root.monthlyRent ?? root.rent),
    security_deposit: parseMoney(root.security_deposit ?? root.securityDeposit ?? root.deposit),
    confidence: clampConfidence(root.confidence),
    warnings: uniqueNames(root.warnings),
  }
}

export function validateLeaseExtract(extract: LeaseExtract): LeaseExtract {
  const guarantors = extract.guarantor_names.filter(
    (name) => !extract.tenant_names.some((tenant) => tenant.toLowerCase() === name.toLowerCase()),
  )
  const manager =
    extract.property_manager_name &&
    extract.landlord_name &&
    extract.property_manager_name.toLowerCase() === extract.landlord_name.toLowerCase()
      ? null
      : extract.property_manager_name
  const warnings = [...extract.warnings]
  if (extract.property_manager_name && !manager) {
    warnings.push('Property manager name matched landlord and was kept only as landlord / lessor.')
  }
  return {
    ...extract,
    guarantor_names: guarantors,
    property_manager_name: manager,
    warnings,
  }
}

/** Prefer signature spelling when both refer to the same tenant. */
export function preferSignatureTenantName(opening: string, signature: string): string {
  const a = opening.trim()
  const b = signature.trim()
  if (!b) return a
  if (!a) return b
  const norm = (value: string) =>
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim()
      .split(' ')
      .filter(Boolean)
      .sort()
      .join(' ')
  if (norm(a) === norm(b) || norm(a).includes(norm(b)) || norm(b).includes(norm(a))) {
    return b
  }
  return a
}
