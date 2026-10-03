/**
 * Shared unit-label display for admin + edge/SMS/Ask Ulo.
 * Single-family: omit the unit entirely (never "Home" or "Unit 1" in messages).
 */

import {
  isSingleFamilyPropertyType,
  SINGLE_FAMILY_UNIT_LABEL,
} from './propertyType.ts'

function normalizeUnitKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/^unit\s+/i, '')
    .replace(/\s+/g, ' ')
}

/** True when this unit label is the SFH inventory sentinel (Home), regardless of property type. */
export function isSingleFamilyUnitSentinel(unitLabel: string | null | undefined): boolean {
  const raw = (unitLabel ?? '').trim()
  if (!raw) return false
  return normalizeUnitKey(raw) === normalizeUnitKey(SINGLE_FAMILY_UNIT_LABEL)
}

/**
 * Whether user-facing copy should omit the unit reference.
 * Omit when property is single-family, or the stored label is the Home sentinel.
 */
export function shouldOmitUnitReference(input: {
  unitLabel?: string | null
  propertyType?: string | null
}): boolean {
  if (isSingleFamilyPropertyType(input.propertyType)) return true
  if (isSingleFamilyUnitSentinel(input.unitLabel)) return true
  return false
}

/**
 * Format a unit for messages / UI.
 * Returns '' when the unit should be omitted (SFH); otherwise "Unit {label}".
 * Empty input (and not SFH) returns '' so callers can filter(Boolean).
 */
export function formatUnitReference(
  unitLabel: string | null | undefined,
  propertyType?: string | null,
): string {
  if (shouldOmitUnitReference({ unitLabel, propertyType })) return ''
  const trimmed = (unitLabel ?? '').trim()
  if (!trimmed) return ''
  if (/^unit\s+/i.test(trimmed)) return trimmed.replace(/^unit\s+/i, 'Unit ')
  return `Unit ${trimmed}`
}

/**
 * Suffix for "Resident in Unit N" phrasing. Empty when the unit should be omitted.
 */
export function formatInUnitPhrase(
  unitLabel: string | null | undefined,
  propertyType?: string | null,
): string {
  const ref = formatUnitReference(unitLabel, propertyType)
  return ref ? ` in ${ref}` : ''
}

/**
 * Bare unit token for lines like `Unit: {label}` (no "Unit " prefix).
 * Empty when the unit should be omitted.
 */
export function formatBareUnitLabel(
  unitLabel: string | null | undefined,
  propertyType?: string | null,
): string {
  const ref = formatUnitReference(unitLabel, propertyType)
  return ref.replace(/^Unit\s+/i, '').trim()
}

/**
 * "Property · Unit N" for multifamily; property only for single-family.
 */
export function formatLocationWithOptionalUnit(input: {
  propertyLabel?: string | null
  unitLabel?: string | null
  propertyType?: string | null
}): string {
  const property = (input.propertyLabel ?? '').trim()
  const unitDisplay = formatUnitReference(input.unitLabel, input.propertyType)
  if (property && unitDisplay) return `${property} · ${unitDisplay}`
  if (property) return property
  if (unitDisplay) return unitDisplay
  return ''
}
