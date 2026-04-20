import { type ReactNode } from 'react'
import { VendorAccessCodePage } from '@/components/VendorAccessCodePage'
import { VENDOR_TOKEN_STORAGE_KEY } from '@/lib/vendorToken'

export default function VendorAuthGate({ children }: { children: ReactNode }) {
  let token: string | null = null
  try {
    token = localStorage.getItem(VENDOR_TOKEN_STORAGE_KEY)
  } catch {
    token = null
  }

  if (!token?.trim()) {
    return <VendorAccessCodePage />
  }

  return <>{children}</>
}
