/**
 * Canonical vendor trade taxonomy — single master list for client + edge.
 */

export const VENDOR_TRADE_DEFINITIONS = [
  {
    slug: 'appliance_repair',
    label: 'Appliance Repair',
    rosterPlural: 'appliance technicians',
  },
  {
    slug: 'carpentry',
    label: 'Carpentry',
    rosterPlural: 'carpenters',
  },
  {
    slug: 'cleaning',
    label: 'Cleaning',
    rosterPlural: 'cleaners',
  },
  {
    slug: 'concrete',
    label: 'Concrete',
    rosterPlural: 'concrete contractors',
  },
  {
    slug: 'deck_builder',
    label: 'Deck Builder',
    rosterPlural: 'deck builders',
  },
  {
    slug: 'electrical',
    label: 'Electrical',
    rosterPlural: 'electricians',
  },
  {
    slug: 'flooring',
    label: 'Flooring',
    rosterPlural: 'flooring contractors',
  },
  {
    slug: 'general',
    label: 'General / Handyman',
    rosterPlural: 'handymen',
  },
  {
    slug: 'hvac',
    label: 'HVAC',
    rosterPlural: 'HVAC technicians',
  },
  {
    slug: 'landscaping',
    label: 'Landscaping',
    rosterPlural: 'landscapers',
  },
  {
    slug: 'locksmith',
    label: 'Locksmith',
    rosterPlural: 'locksmiths',
  },
  {
    slug: 'masonry',
    label: 'Masonry',
    rosterPlural: 'masons',
  },
  {
    slug: 'painting',
    label: 'Painting',
    rosterPlural: 'painters',
  },
  {
    slug: 'pest_control',
    label: 'Pest Control',
    rosterPlural: 'pest control vendors',
  },
  {
    slug: 'plumbing',
    label: 'Plumbing',
    rosterPlural: 'plumbers',
  },
  {
    slug: 'roofing',
    label: 'Roofing',
    rosterPlural: 'roofers',
  },
  {
    slug: 'windows',
    label: 'Windows',
    rosterPlural: 'window technicians',
  },
  {
    slug: 'other',
    label: 'Other',
    rosterPlural: null,
  },
] as const

export type VendorTradeSlug = (typeof VENDOR_TRADE_DEFINITIONS)[number]['slug']

/** Alias used by the maintenance classification pipeline. */
export type VendorTrade = VendorTradeSlug

export const VENDOR_TRADE_SLUGS: readonly VendorTradeSlug[] =
  VENDOR_TRADE_DEFINITIONS.map((trade) => trade.slug)
