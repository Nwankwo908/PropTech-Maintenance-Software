/** SMS identity upgrade rules — roster vendors must not stay stuck as blank tenants. */

export type SmsIdentityKindFields = {
  identity_type: string
  resident_id?: string | null
  vendor_id?: string | null
}

export function isUnlinkedResidentSmsIdentity(
  identity: SmsIdentityKindFields,
): boolean {
  return identity.identity_type === "resident" && !identity.resident_id?.trim()
}

export function isLinkedResidentSmsIdentity(
  identity: SmsIdentityKindFields,
): boolean {
  return identity.identity_type === "resident" && Boolean(identity.resident_id?.trim())
}

/**
 * True when an existing identity may be rewritten as this landlord's vendor.
 * Blank tenant rows (resident, no resident_id) and unknown rows must upgrade.
 * Linked residents are left alone on inbound self-heal; outbound job SMS may still
 * call this with nextType vendor after an explicit vendor send.
 */
export function smsIdentityAllowsTypePatch(
  existing: SmsIdentityKindFields,
  nextType: "resident" | "vendor" | "landlord",
): boolean {
  if (existing.identity_type === "unknown") return true
  if (existing.identity_type === nextType) return true
  if (nextType === "vendor" && isUnlinkedResidentSmsIdentity(existing)) return true
  return false
}

/** Inbound: do not trust a resident label with no roster person — keep resolving. */
export function smsIdentityIsFullyResolved(
  identity: SmsIdentityKindFields,
): boolean {
  if (identity.identity_type === "unknown") return false
  if (isUnlinkedResidentSmsIdentity(identity)) return false
  if (identity.identity_type === "vendor" && !identity.vendor_id?.trim()) return false
  return true
}
