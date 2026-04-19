import { useEffect, useState, type ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

function extractPortalKey(search: string): string | null {
  const params = new URLSearchParams(search)

  const top = params.get('k')
  if (top && top.trim() !== '') return top.trim()

  const redirect = params.get('redirect')
  if (!redirect) return null

  try {
    // 🔥 handles + and encoding edge cases
    const decoded = decodeURIComponent(redirect.replace(/\+/g, ' '))
    const idx = decoded.indexOf('?')
    const queryPart = idx >= 0 ? decoded.slice(idx + 1) : ''

    const nested = new URLSearchParams(queryPart).get('k')
    if (nested && nested.trim() !== '') return nested.trim()
  } catch {}

  return null
}

export default function VendorAuthGate({ children }: { children: ReactNode }) {
  const location = useLocation()
  const navigate = useNavigate()

  const [status, setStatus] = useState<'checking' | 'allowed' | 'blocked'>('checking')

  useEffect(() => {
    const key = extractPortalKey(location.search)

    console.log('🔥 SEARCH:', location.search)
    console.log('🔥 KEY:', key)

    if (key) {
      console.log('🔥 Vendor key detected → ALLOW')
      setStatus('allowed')
      return
    }

    console.log('❌ No key → redirecting to login')

    setStatus('blocked')

    navigate(
      `/vendor/login?redirect=${encodeURIComponent(
        location.pathname + location.search
      )}`,
      { replace: true }
    )
  }, [location.pathname, location.search, navigate])

  if (status === 'checking') return null
  if (status === 'allowed') return <>{children}</>

  return null
}