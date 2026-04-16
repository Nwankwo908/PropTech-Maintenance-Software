import { useEffect, useState } from 'react'
import {
  fetchMaintenanceTicketStatus,
  isMaintenanceTicketStatusConfigured,
  maintenanceTicketStatusPollIntervalMs,
} from '@/api/fetchMaintenanceTicketStatus'
import {
  mapRawStatusToTimelinePhase,
  type TicketTimelinePhase,
} from '@/lib/maintenanceTicketTimeline'
import { getCurrentResidentSession } from '@/lib/residentAuth'

export type UseTicketTimelineStatusResult = {
  phase: TicketTimelinePhase
  activeStepDetail: string | null
  statusError: string | null
  isPolling: boolean
}

const INITIAL_PHASE: TicketTimelinePhase = 1

export function useTicketTimelineStatus(
  ticketId: string,
): UseTicketTimelineStatusResult {
  const [phase, setPhase] = useState<TicketTimelinePhase>(INITIAL_PHASE)
  const [activeStepDetail, setActiveStepDetail] = useState<string | null>(null)
  const [statusError, setStatusError] = useState<string | null>(null)
  const [isPolling, setIsPolling] = useState(false)

  useEffect(() => {
    if (!isMaintenanceTicketStatusConfigured()) {
      return
    }

    let cancelled = false
    let intervalId: ReturnType<typeof setInterval> | undefined

    async function poll() {
      try {
        const session = await getCurrentResidentSession()
        const data = await fetchMaintenanceTicketStatus({
          ticketId,
          auth: session
            ? {
                accessToken: session.accessToken,
                residentUserId: session.userId,
              }
            : undefined,
        })
        if (cancelled || !data) return
        setStatusError(null)

        const next = mapRawStatusToTimelinePhase(data.status)
        if (next !== null) {
          setPhase(next)
          if (next === 'resolved' && intervalId !== undefined) {
            window.clearInterval(intervalId)
            intervalId = undefined
          }
        }
        setActiveStepDetail(data.detail ?? null)
      } catch (e) {
        if (!cancelled) {
          setStatusError(
            e instanceof Error ? e.message : 'Could not load ticket status.',
          )
        }
      }
    }

    setIsPolling(true)
    void poll()

    const pollMs = maintenanceTicketStatusPollIntervalMs()
    intervalId = window.setInterval(() => {
      void poll()
    }, pollMs)

    return () => {
      cancelled = true
      if (intervalId !== undefined) window.clearInterval(intervalId)
    }
  }, [ticketId])

  return { phase, activeStepDetail, statusError, isPolling }
}
