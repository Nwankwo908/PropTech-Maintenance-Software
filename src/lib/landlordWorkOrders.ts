function text(value: unknown): string {
  if (value == null) return ''
  return String(value).trim()
}

function truthy(value: unknown): boolean {
  return value === true || value === 'true' || value === 't' || value === 1 || value === '1'
}

function metadataOf(row: Record<string, unknown>): Record<string, unknown> | null {
  const meta = row.metadata
  if (meta && typeof meta === 'object' && !Array.isArray(meta)) {
    return meta as Record<string, unknown>
  }
  return null
}

/**
 * Home Check photo round that does not authorize a repair.
 * Repair follow-ups stay on Work Orders.
 */
export function isHomeCheckObservation(row: Record<string, unknown>): boolean {
  if (truthy(row.observation_only)) return true
  const meta = metadataOf(row)
  if (meta && truthy(meta.observation_only)) return true
  const description = text(row.description)
  if (/observation only/i.test(description) && /no repair/i.test(description)) return true
  const source = text(meta?.source || row.source).toLowerCase()
  const trigger = text(row.trigger_type).toLowerCase()
  const fromHomeCheck = source === 'home_check' || trigger === 'home_check'
  return fromHomeCheck && meta?.repair_authorized === false
}

/** Landlord work lists omit observation-only Home Checks. */
export function isLandlordFacingMaintenanceRequest(row: Record<string, unknown>): boolean {
  return !isHomeCheckObservation(row)
}
