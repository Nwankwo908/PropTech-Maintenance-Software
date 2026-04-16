import { useState } from 'react'
import { MaintenanceRequestForm } from '@/components/MaintenanceRequestForm'
import { MaintenanceRequestSubmittedView } from '@/components/MaintenanceRequestSubmittedView'
import { supabase } from '@/lib/supabase'

export function ResidentPortal() {
  const [submitted, setSubmitted] = useState<{
    requestId: string
    ticketId: string
  } | null>(null)

  if (submitted) {
    return (
      <MaintenanceRequestSubmittedView
        requestId={submitted.requestId}
        ticketId={submitted.ticketId}
        onSubmitAnother={() => setSubmitted(null)}
        onLogOut={async () => {
          await supabase?.auth.signOut()
          setSubmitted(null)
        }}
      />
    )
  }

  return (
    <MaintenanceRequestForm
      onTicketSubmitted={(r) =>
        setSubmitted({ requestId: r.id, ticketId: r.ticketId })
      }
    />
  )
}
