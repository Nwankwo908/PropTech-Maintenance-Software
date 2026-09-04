import type { ExternalVendorSuggestionDto } from '@/api/discoverExternalVendors'
import { isDemoExternalVendorName } from '@shared/externalVendor/demoVendorNames'

export function canMessageThumbtackVendor(vendor: ExternalVendorSuggestionDto): boolean {
  if (isDemoExternalVendorName(vendor.name)) return false
  const sources = vendor.sources ?? []
  if (sources.length === 0 || sources.every((src) => src === 'mock')) return false
  return Boolean(
    vendor.providerRef?.trim() ||
      vendor.requestFlowUrl?.trim() ||
      vendor.listingUrl?.trim() ||
      (vendor.searchId?.trim() && vendor.categoryId?.trim()),
  )
}

export function formatThumbtackContactedAt(iso: string | null | undefined): string | null {
  if (!iso?.trim()) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

export function thumbtackContactStatusLabel(
  vendor: ExternalVendorSuggestionDto,
): string | null {
  if (vendor.contactStatus === 'vendor_replied') return 'Replied · Needs review'
  if (vendor.contactStatus === 'awaiting_response' || vendor.contactedAt) {
    return 'Contacted · Awaiting Response'
  }
  return null
}
