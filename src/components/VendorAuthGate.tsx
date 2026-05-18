import { useEffect, useState, type ReactNode } from 'react'
import { VendorAccessCodePage } from '@/components/VendorAccessCodePage'
import {
  VENDOR_TOKEN_CHANGED_EVENT,
  VENDOR_TOKEN_STORAGE_KEY,
} from '@/lib/vendorToken'

export default function VendorAuthGate({ children }: { children: ReactNode }) {
  const [, setTokenRevision] = useState(0)

  useEffect(() => {
    const bump = () => setTokenRevision((n) => n + 1)
    window.addEventListener(VENDOR_TOKEN_CHANGED_EVENT, bump)
    return () => window.removeEventListener(VENDOR_TOKEN_CHANGED_EVENT, bump)
  }, [])

  let token: string | null = null
  try {
    token = localStorage.getItem(VENDOR_TOKEN_STORAGE_KEY)
  } catch {
    token = null
  }

  if (!token?.trim()) {
    return (
      <VendorAccessCodePage
        onAccessGranted={() => setTokenRevision((n) => n + 1)}
      />
    )
  }

  return <>{children}</>
}
