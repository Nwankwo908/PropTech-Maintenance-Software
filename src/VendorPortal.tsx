import { useEffect } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { VendorPortalDashboard } from '@/components/VendorPortalDashboard'

const VENDOR_PORTAL_BEARER_STORAGE_KEY = 'vendor_portal_bearer'

/** Vendor-facing work order board (Figma 136:20488). */
export function VendorPortal() {
  const routeParams = useParams()
  const [searchParams] = useSearchParams()
  const fromPath = routeParams.ticketId?.trim() || null
  const fromQuery = searchParams.get('t')?.trim() || null
  const deepLinkTicketId = fromPath ?? fromQuery
  const deepLinkToken = searchParams.get('k')?.trim() || null

  useEffect(() => {
    const k = searchParams.get('k')?.trim()
    if (!k) return
    try {
      sessionStorage.setItem(VENDOR_PORTAL_BEARER_STORAGE_KEY, k)
    } catch {
      /* private mode / quota */
    }
  }, [searchParams])

  return (
    <VendorPortalDashboard deepLinkTicketId={deepLinkTicketId} deepLinkToken={deepLinkToken} />
  )
}
