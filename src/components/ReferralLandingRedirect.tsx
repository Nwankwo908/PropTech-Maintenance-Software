import { useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

/** Send `?ref=` traffic to the landing page instead of deep portal routes. */
export function ReferralLandingRedirect() {
  const location = useLocation()
  const navigate = useNavigate()

  useEffect(() => {
    const ref = new URLSearchParams(location.search).get('ref')?.trim()
    if (!ref) return
    if (location.pathname === '/') return

    navigate(`/?ref=${encodeURIComponent(ref)}`, { replace: true })
  }, [location.pathname, location.search, navigate])

  return null
}
