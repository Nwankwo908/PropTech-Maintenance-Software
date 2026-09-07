/** Roster origin — preferred network vs Find External Vendor. */

export function vendorSourceLabel(onboardedFromExternal: boolean): 'Preferred' | 'External' {
  return onboardedFromExternal ? 'External' : 'Preferred'
}

/**
 * Matches `vendorAllowedForMarketplace` when the pool is Ulo-vetted only.
 * Default / include-imported still allows assigning external vendors.
 */
export function vendorBlockedFromAutoAssignBySettings(opts: {
  onboardedFromExternal: boolean
  marketplacePreference: string | null | undefined
}): boolean {
  return opts.onboardedFromExternal && (opts.marketplacePreference ?? '').trim() === 'ulo_vetted_only'
}

export const VENDOR_SOURCE_INFO =
  'External vendors cannot be automatically assigned. They must be assigned manually.'

export const VENDOR_SOURCE_SETTINGS_HINT =
  'Your preferred vendor pool is Ulo-vetted vendors only, so Ulo will not assign jobs to this vendor. Change this in Settings → Organization to include imported vendors.'
