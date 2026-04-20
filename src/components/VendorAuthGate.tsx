import { useLayoutEffect, type ReactNode } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { VendorInvalidLinkPage } from '@/components/VendorInvalidLinkPage'

export default function VendorAuthGate({ children }: { children: ReactNode }) {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const location = useLocation()

  const tokenFromUrl = searchParams.get('k')
  if (tokenFromUrl) {
    try {
      localStorage.setItem('vendor_token', tokenFromUrl)
    } catch {
      /* ignore */
    }
  }

  const token = localStorage.getItem('vendor_token')

  useLayoutEffect(() => {
    if (!tokenFromUrl) return
    navigate({ pathname: location.pathname, hash: location.hash || '' }, { replace: true })
  }, [tokenFromUrl, navigate, location.pathname, location.hash])

  if (!token) {
    return <VendorInvalidLinkPage />
  }

  return <>{children}</>
}
