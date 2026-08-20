/**
 * Invented names used only by the demo/mock external-vendor providers.
 * Live accounts (including Alpha) must never show these as search results.
 */
export const DEMO_EXTERNAL_VENDOR_NAMES = [
  'Rapid Plumb Co.',
  'Metro Plumbing Services',
  'Apex Pipe & Drain',
  'BrightWire Electric',
  'SafePanel Contractors',
  'Summit Climate HVAC',
  'Allied Home Repair',
  'Neighborhood Fix-It',
  'Credentialed Flow Plumbing',
  'Verified Pipe & Drain Co.',
  'Compliant Spark Electric',
  'NetClimate HVAC Services',
  'Verified Property Services',
] as const

const DEMO_NAME_KEYS = new Set(
  DEMO_EXTERNAL_VENDOR_NAMES.map((name) => name.trim().toLowerCase()),
)

export function isDemoExternalVendorName(name: string | null | undefined): boolean {
  const key = name?.trim().toLowerCase() ?? ''
  return key.length > 0 && DEMO_NAME_KEYS.has(key)
}

export function isDemoExternalVendorProviderRef(
  providerRef: string | null | undefined,
): boolean {
  const ref = providerRef?.trim().toLowerCase() ?? ''
  return ref.startsWith('nv-mock-')
}
