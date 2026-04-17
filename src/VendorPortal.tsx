import { useParams, useSearchParams } from 'react-router-dom'
import { VendorPortalDashboard } from '@/components/VendorPortalDashboard'

/** Vendor-facing work order board (Figma 136:20488). */
export function VendorPortal() {
  const routeParams = useParams()
  const [searchParams] = useSearchParams()
  const fromPath = routeParams.ticketId?.trim() || null
  const fromQuery = searchParams.get('t')?.trim() || null
  const deepLinkTicketId = fromPath ?? fromQuery
  const deepLinkToken = searchParams.get('k')?.trim() || null

  return (
    <VendorPortalDashboard deepLinkTicketId={deepLinkTicketId} deepLinkToken={deepLinkToken} />
  )
}
