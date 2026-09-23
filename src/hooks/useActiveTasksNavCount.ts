import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { getActiveLandlordId } from '@/lib/activeLandlord'
import { fetchAdminWorkflowDashboard } from '@/lib/adminWorkflows'
import { snapshotActiveOperations } from '@/lib/adminWorkflowKanban'

/** Live Active Tasks total — same rules as the Overview KPI. */
export function useActiveTasksNavCount(): number | null {
  const location = useLocation()
  const landlordId = getActiveLandlordId()
  const [count, setCount] = useState<number | null>(null)

  useEffect(() => {
    let cancelled = false
    void fetchAdminWorkflowDashboard()
      .then((data) => {
        if (cancelled) return
        setCount(snapshotActiveOperations(data).total)
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
