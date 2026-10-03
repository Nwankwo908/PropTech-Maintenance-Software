/**
 * Edge re-export of shared property / unit-label helpers.
 * Import from here in supabase/functions so paths stay short and stable.
 */
export {
  isSingleFamilyPropertyType,
  resolveCanonicalPropertyType,
  SINGLE_FAMILY_PROPERTY_TYPE,
  SINGLE_FAMILY_UNIT_LABEL,
} from '../../../../shared/properties/propertyType.ts'

export {
  formatBareUnitLabel,
  formatInUnitPhrase,
  formatLocationWithOptionalUnit,
  formatUnitReference,
  isSingleFamilyUnitSentinel,
  shouldOmitUnitReference,
} from '../../../../shared/properties/unitLabelDisplay.ts'
