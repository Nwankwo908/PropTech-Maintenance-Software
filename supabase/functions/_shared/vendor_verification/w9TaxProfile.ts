/**
 * W-9 tax profile: entity type → TIN type, W-9 variant, 1099 treatment.
 *
 * Sole proprietors: SSN. LLCs/corps: EIN.
 * Entity type determines W-9 variant and 1099 treatment — must be captured correctly.
 */

export type TaxEntityType =
  | "sole_proprietor"
  | "llc"
  | "corporation"
  | "partnership"
  | "other"

export type TinType = "ssn" | "ein"
export type W9Variant = "individual" | "business"
export type Tax1099Treatment = "nec" | "none"

export type W9TaxProfile = {
  taxEntityType: TaxEntityType
  tinType: TinType
  w9Variant: W9Variant
  tax1099Treatment: Tax1099Treatment
}

export const TAX_ENTITY_OPTIONS: Array<{
  value: TaxEntityType
  label: string
}> = [
  { value: "sole_proprietor", label: "Sole proprietor" },
  { value: "llc", label: "LLC" },
  { value: "corporation", label: "Corporation" },
  { value: "partnership", label: "Partnership" },
  { value: "other", label: "Other" },
]

export function isTaxEntityType(value: unknown): value is TaxEntityType {
  return (
    value === "sole_proprietor" ||
    value === "llc" ||
    value === "corporation" ||
    value === "partnership" ||
    value === "other"
  )
}

/** Derive TIN / W-9 / 1099 rules from entity type. */
export function taxProfileForEntity(entity: TaxEntityType): W9TaxProfile {
  if (entity === "sole_proprietor") {
    return {
      taxEntityType: entity,
      tinType: "ssn",
      w9Variant: "individual",
      tax1099Treatment: "nec",
    }
  }
  if (entity === "corporation") {
    return {
      taxEntityType: entity,
      tinType: "ein",
      w9Variant: "business",
      tax1099Treatment: "none",
    }
  }
  return {
    taxEntityType: entity,
    tinType: "ein",
    w9Variant: "business",
    tax1099Treatment: "nec",
  }
}

export function normalizeTinDigits(raw: string): string {
  return raw.replace(/\D/g, "")
}

export function validateTinDigits(
  digits: string,
  tinType: TinType,
): { ok: true } | { ok: false; error: string } {
  if (digits.length !== 9) {
    return {
      ok: false,
      error: tinType === "ssn"
        ? "Enter a 9-digit Social Security number."
        : "Enter a 9-digit Employer Identification Number (EIN).",
    }
  }
  if (/^0+$/.test(digits)) {
    return { ok: false, error: "Enter a valid tax ID." }
  }
  return { ok: true }
}

export function tinLast4(digits: string): string {
  return digits.slice(-4)
}

export async function tinFingerprint(digits: string): Promise<string> {
  const data = new TextEncoder().encode(digits)
  const hash = await crypto.subtle.digest("SHA-256", data)
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
}

export function maskTin(tinType: TinType, last4: string | null | undefined): string {
  const tail = (last4 ?? "").trim()
  if (!/^\d{4}$/.test(tail)) return tinType === "ssn" ? "•••-••-••••" : "••-•••••••"
  return tinType === "ssn" ? `•••-••-${tail}` : `••-•••${tail}`
}

export function taxProfileComplete(record: {
  tax_entity_type?: string | null
  tin_type?: string | null
  tin_last4?: string | null
  tin_fingerprint?: string | null
  w9_variant?: string | null
  tax_1099_treatment?: string | null
  w9_received?: boolean | null
}): boolean {
  if (record.w9_received !== true) return false
  if (!isTaxEntityType(record.tax_entity_type)) return false
  const expected = taxProfileForEntity(record.tax_entity_type)
  if (record.tin_type !== expected.tinType) return false
  if (record.w9_variant !== expected.w9Variant) return false
  if (record.tax_1099_treatment !== expected.tax1099Treatment) return false
  if (!/^\d{4}$/.test((record.tin_last4 ?? "").trim())) return false
  if (!(record.tin_fingerprint ?? "").trim()) return false
  return true
}

export function parseTaxEntityFromPatch(
  patch: Record<string, unknown>,
): TaxEntityType | null {
  const raw = patch.taxEntityType ?? patch.tax_entity_type
  return isTaxEntityType(raw) ? raw : null
}
