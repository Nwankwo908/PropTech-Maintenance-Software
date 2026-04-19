import { useEffect, useState, type ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

export default function VendorAuthGate({ children }: { children: ReactNode }) {
  const location = useLocation()
  const navigate = useNavigate()

  const [checked, setChecked] = useState(false)
  const [allowed, setAllowed] = useState(false)

  useEffect(() => {
    const params = new URLSearchParams(location.search)
    let k = params.get('k')

    // fallback: check redirect
    if (!k) {
      const redirect = params.get('redirect')
      if (redirect) {
        try {
          const decoded = decodeURIComponent(redirect)
          const queryPart = decoded.includes('?') ? decoded.split('?')[1] : ''
          k = new URLSearchParams(queryPart).get('k')
        } catch {}
      }
    }

    // ✅ KEY LOGIC (you are missing this right now)
    if (k && k.trim() !== '') {
      console.log('🔥 Vendor key detected, bypassing login')
      setAllowed(true)
      setChecked(true)
      return
    }

    // ❌ only redirect when NO key
    const dest = `/vendor/login?redirect=${encodeURIComponent(
      location.pathname + location.search,
    )}`

    navigate(dest, { replace: true })
    setChecked(true)
  }, [location.pathname, location.search, navigate])

  if (!checked) return null
  if (!allowed) return null

  return <>{children}</>
}
