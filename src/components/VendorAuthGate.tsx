import { useEffect, useState, type ReactNode } from 'react'
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
      <div className="flex min-h-dvh flex-col items-center justify-center bg-[#f8fafc] px-6 py-12">
        <div className="w-full max-w-sm rounded-xl border border-[#e5e7eb] bg-white p-8 text-center shadow-sm">
          <h1 className="text-xl font-semibold text-[#0f172a]">Open your job link</h1>
          <p className="mt-3 text-sm leading-6 text-[#64748b]">
            Use the unique work order link we sent you. That link is your access — there is no
            access code.
          </p>
        </div>
      </div>
    )
  }

  return <>{children}</>
}
