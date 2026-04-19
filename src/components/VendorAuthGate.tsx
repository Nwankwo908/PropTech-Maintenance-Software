import { useEffect, useState, type ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

function extractPortalKey(search: string): string | null {
  const params = new URLSearchParams(search)
  let k = params.get('k')

  if (!k) {
    const redirect = params.get('redirect')
    if (redirect) {
      try {
        const decoded = decodeURIComponent(redirect)
        const queryPart = decoded.includes('?') ? decoded.split('?')[1] : ''
        k = new URLSearchParams(queryPart).get('k')
      } catch {
        return null
      }
    }
  }

  if (k !== null && k.trim() !== '') {
    return k.trim()
  }
  return null
}

export default function VendorAuthGate({ children }: { children: ReactNode }) {
  const location = useLocation()
  const navigate = useNavigate()

  const [checked, setChecked] = useState(false)
  const [allowed, setAllowed] = useState(false)

  useEffect(() => {
    const key = extractPortalKey(location.search)

    console.log('🔥 SEARCH:', location.search)
    console.log('🔥 KEY:', key)

    // ✅ If key exists → allow immediately
    if (key) {
      console.log('🔥 Vendor key detected, bypassing login')
      setAllowed(true)
      setChecked(true)
      return
    }

    // ⛔ IMPORTANT: do NOT redirect immediately on first render
    // Wait until we are sure there's no key

    if (!checked) {
      setChecked(true)
      return
    }

    // ❌ Only redirect AFTER check is complete
    navigate(
      `/vendor/login?redirect=${encodeURIComponent(
        location.pathname + location.search,
      )}`,
      { replace: true },
    )
  }, [location.search, location.pathname, checked, navigate])

  if (!checked) return null
  if (!allowed) return null

  return <>{children}</>
}
