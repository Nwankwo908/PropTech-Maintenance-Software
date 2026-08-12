import { adminNavPath } from '@/lib/adminNavigation'

/** URL-safe vendor identifier for /admin/vendors/:vendorId routes. */
export function vendorDetailPath(vendorId: string): string {
  return `${adminNavPath('vendors')}/${encodeURIComponent(vendorId)}`
}

export function parseVendorId(slug: string | undefined): string | null {
  if (!slug?.trim()) return null
  try {
    return decodeURIComponent(slug)
  } catch {
    return null
  }
}
