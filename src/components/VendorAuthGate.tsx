import { useEffect, useState, type ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { getVendorPortalK } from '@/api/vendorPortalTickets'

export default function VendorAuthGate({ children }: { children: ReactNode }) {
  const location = useLocation()
  const navigate = useNavigate()

  const [checked, setChecked] = useState(false)
  const [allowed, setAllowed] = useState(false)

  useEffect(() => {
    const k = getVendorPortalK()

    console.log('🔥 AuthGate check:', {
      path: location.pathname,
      search: location.search,
      k,
    })

    // If key exists → allow
    if (k) {
      setAllowed(true)
      setChecked(true)
      return
    }

    // If NO key → redirect to login
    navigate(
      `/vendor/login?redirect=${encodeURIComponent(location.pathname + location.search)}`,
      { replace: true },
    )

    setChecked(true)
  }, [location.pathname, location.search])

  // Block render until check completes
  if (!checked) return null

  if (!allowed) return null

  return <>{children}</>
}
