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
 * No linked person/vendor — label alone (including blank "resident") is not trusted.
 * These rows may be corrected to a better-evidenced type.
 */
export function isUnresolvedSmsIdentity(
  identity: SmsIdentityKindFields,
): boolean {
  if (identity.identity_type === "unknown") return true
  if (isUnlinkedResidentSmsIdentity(identity)) return true
  if (identity.identity_type === "vendor" && !identity.vendor_id?.trim()) {
    return true
  }
  if (
    identity.identity_type === "landlord" &&
    !identity.resident_id?.trim() &&
    !identity.vendor_id?.trim()
  ) {
    // Landlord rows intentionally have no resident/vendor link.
    return false
  }
  return false
}

/**
 * True when an existing identity may be rewritten as nextType.
 * Unresolved rows (unknown, blank resident, vendor without vendor_id) may move
 * to any better-evidenced type — not only literally `unknown` → landlord.
 * Linked residents stay protected from casual inbound self-heal.
 */
export function smsIdentityAllowsTypePatch(
  existing: SmsIdentityKindFields,
  nextType: "resident" | "vendor" | "landlord",
): boolean {
  if (existing.identity_type === nextType) return true
  if (isUnresolvedSmsIdentity(existing)) return true
  if (nextType === "vendor" && isUnlinkedResidentSmsIdentity(existing)) {
    return true
  }
  return false
}

/** Inbound: do not trust a resident label with no roster person — keep resolving. */
export function smsIdentityIsFullyResolved(
  identity: SmsIdentityKindFields,
): boolean {
  if (identity.identity_type === "unknown") return false
  if (isUnlinkedResidentSmsIdentity(identity)) return false
  if (identity.identity_type === "vendor" && !identity.vendor_id?.trim()) {
    return false
  }
  return true
}
