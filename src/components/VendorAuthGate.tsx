import { useEffect, useState, type ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

export default function VendorAuthGate({ children }: { children: ReactNode }) {
  const location = useLocation()
  const navigate = useNavigate()

  const [ready, setReady] = useState(false)

  useEffect(() => {
    const params = new URLSearchParams(location.search)
    const queryToken = params.get('k')
    const storedToken = localStorage.getItem('vendor_token')

    // STEP 1: Save token if it exists in URL
    if (queryToken) {
      localStorage.setItem('vendor_token', queryToken)
    }

    const finalToken = queryToken || storedToken

    // STEP 2: Only redirect AFTER checking both sources
    if (!finalToken) {
      navigate('/vendor/login?redirect=/vendor', { replace: true })
      return
    }

    setReady(true)
  }, [location.search, navigate])

  // STEP 3: Prevent early render
  if (!ready) return null

  return <>{children}</>
}
