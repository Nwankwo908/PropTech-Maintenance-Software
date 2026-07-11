import { touchVendorSetupInboxActivity } from '@/lib/vendorSetupConversation'

export type VendorPricingConfirmation = {
  vendorConfirmedAtMs: number | null
  adminConfirmedAtMs: number | null
}

const STORAGE_PREFIX = 'ulo.vendorPricingConfirmation.'

function readJson<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return null
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* ignore */
  }
}

export function readVendorPricingConfirmation(conversationId: string): VendorPricingConfirmation {
  return (
    readJson<VendorPricingConfirmation>(`${STORAGE_PREFIX}${conversationId}`) ?? {
      vendorConfirmedAtMs: null,
      adminConfirmedAtMs: null,
    }
  )
}

export function isVendorPricingConfirmedByVendor(conversationId: string): boolean {
  return readVendorPricingConfirmation(conversationId).vendorConfirmedAtMs != null
}

export function isVendorPricingConfirmedByAdmin(conversationId: string): boolean {
  return readVendorPricingConfirmation(conversationId).adminConfirmedAtMs != null
}

export function isVendorPricingMutuallyConfirmed(conversationId: string): boolean {
  const row = readVendorPricingConfirmation(conversationId)
  return row.vendorConfirmedAtMs != null && row.adminConfirmedAtMs != null
}

export function markVendorPricingConfirmed(conversationId: string): VendorPricingConfirmation {
  const atMs = Date.now()
  const next: VendorPricingConfirmation = {
    ...readVendorPricingConfirmation(conversationId),
    vendorConfirmedAtMs: atMs,
  }
  writeJson(`${STORAGE_PREFIX}${conversationId}`, next)
  touchVendorSetupInboxActivity(conversationId, 'Vendor confirmed pricing', atMs)
  return next
}

export function markAdminPricingConfirmed(conversationId: string): VendorPricingConfirmation {
  const atMs = Date.now()
  const next: VendorPricingConfirmation = {
    ...readVendorPricingConfirmation(conversationId),
    adminConfirmedAtMs: atMs,
  }
  writeJson(`${STORAGE_PREFIX}${conversationId}`, next)
  touchVendorSetupInboxActivity(conversationId, 'Landlord confirmed pricing', atMs)
  return next
}

export function formatVendorPricingConfirmationStatus(conversationId: string): string {
  const row = readVendorPricingConfirmation(conversationId)
  const vendor = row.vendorConfirmedAtMs != null ? 'Vendor confirmed' : 'Vendor pending'
  const admin = row.adminConfirmedAtMs != null ? 'You confirmed' : 'Your confirmation pending'
  return `${vendor} · ${admin}`
}
