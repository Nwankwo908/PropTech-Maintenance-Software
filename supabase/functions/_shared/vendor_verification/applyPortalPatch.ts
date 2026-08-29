/**
 * Map public verification-form patches onto vendor_verifications columns.
 */
export function applyVerificationPortalPatch(
  patch: Record<string, unknown>,
  existingProgress: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  const update: Record<string, unknown> = {}
  if (typeof patch.businessName === "string") {
    update.business_name = patch.businessName.trim() || null
  }
  if (typeof patch.contactName === "string") {
    update.contact_name = patch.contactName.trim() || null
  }
  if (typeof patch.vendorFirstName === "string") {
    update.vendor_first_name = patch.vendorFirstName.trim() || null
  }
  if (typeof patch.email === "string") {
    update.email = patch.email.trim() || null
  }
  if (typeof patch.phone === "string") {
    update.phone = patch.phone.trim() || null
  }
  if (typeof patch.propertyName === "string") {
    update.property_name = patch.propertyName.trim() || null
  }
  if (typeof patch.licenseNumber === "string") {
    const number = patch.licenseNumber.trim()
    update.license_number = number || null
    if (number) update.license_status = "self_reported"
  }
  if (patch.coiGeneralLiability === null) {
    update.coi_general_liability = null
  } else if (
    typeof patch.coiGeneralLiability === "number" &&
    Number.isFinite(patch.coiGeneralLiability) &&
    patch.coiGeneralLiability >= 0
  ) {
    update.coi_general_liability = Math.round(patch.coiGeneralLiability)
  }
  if (Array.isArray(patch.tradeCategories)) {
    update.trade_categories = patch.tradeCategories.filter(
      (t): t is string => typeof t === "string",
    )
  }
  if (patch.serviceArea && typeof patch.serviceArea === "object") {
    update.service_area = patch.serviceArea
  }
  if (patch.progress && typeof patch.progress === "object") {
    update.progress = {
      ...(existingProgress && typeof existingProgress === "object"
        ? existingProgress
        : {}),
      ...(patch.progress as Record<string, unknown>),
    }
  }
  if (patch.availability === "active" || patch.availability === "paused") {
    update.availability = patch.availability
  }
  return update
}
