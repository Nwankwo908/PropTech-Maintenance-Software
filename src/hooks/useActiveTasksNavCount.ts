import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { getActiveLandlordId } from '@/lib/activeLandlord'
import { computeActiveTasksKpis } from '@/lib/activeTasksKpis'
import {
  buildWorkflowKanbanCard,
  collectAdminWorkflowRuns,
} from '@/lib/adminWorkflowKanban'
import {
  fetchAdminWorkflowDashboard,
  isCancelledOnActiveTasks,
} from '@/lib/adminWorkflows'

/** Live Active Tasks badge — needs-attention cards only (not every active workflow). */
export function useActiveTasksNavCount(): number | null {
  const location = useLocation()
  const landlordId = getActiveLandlordId()
  const [count, setCount] = useState<number | null>(null)

  useEffect(() => {
    let cancelled = false
    void fetchAdminWorkflowDashboard()
      .then((data) => {
        if (cancelled) return
        const runMetadata = data.runMetadata ?? {}
        const cards = collectAdminWorkflowRuns(data)
          .filter((row) => !isCancelledOnActiveTasks(row))
          .map((row) => buildWorkflowKanbanCard(row, runMetadata[row.id]))
        setCount(computeActiveTasksKpis(cards).needsYourAttention)
      })
      .catch(() => {
        if (!cancelled) setCount(null)
      })
    return () => {
      cancelled = true
    }
  }, [landlordId, location.pathname])

  return count
}
