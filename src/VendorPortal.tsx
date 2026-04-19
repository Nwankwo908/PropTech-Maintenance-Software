import { useLocation, useSearchParams } from 'react-router-dom'
import { VendorPortalDashboard } from '@/components/VendorPortalDashboard'

/** Vendor-facing work order board (Figma 136:20488). */
export function VendorPortal() {
  const { pathname } = useLocation()
  const [searchParams] = useSearchParams()

  const pathMatch = pathname.match(/^\/vendor\/ticket\/([^/?#]+)/)
  const fromPath = pathMatch?.[1]?.trim() || null

  const fromQuery = searchParams.get('t')?.trim() || null
  const deepLinkTicketId = fromPath ?? fromQuery

  return (
    <VendorPortalDashboard deepLinkTicketId={deepLinkTicketId} />
  )
}
