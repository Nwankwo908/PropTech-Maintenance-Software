import { useCallback, useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { ASSET_REGISTRY_CHANGED_EVENT } from '@/lib/assetRegistry'
import { loadSetupSuccessProgress } from '@/lib/loadSetupSuccessProgress'
import {
  clearSetupSuccessCardDismissed,
  isSetupSuccessCardDismissed,
  SETUP_SUCCESS_COLLAPSED_EVENT,
  setupSuccessPercent,
  shouldShowSetupSuccessNavHint,
  type SetupSuccessProgress,
} from '@/lib/setupSuccessChecklist'

export function useSetupSuccessNavHint() {
  const location = useLocation()
  const [collapsed, setCollapsed] = useState(isSetupSuccessCardDismissed)
  const [progress, setProgress] = useState<SetupSuccessProgress | null>(null)

  const syncCollapsed = useCallback(() => {
    setCollapsed(isSetupSuccessCardDismissed())
  }, [])

  useEffect(() => {
    syncCollapsed()
    window.addEventListener(SETUP_SUCCESS_COLLAPSED_EVENT, syncCollapsed)
    window.addEventListener('storage', syncCollapsed)
    return () => {
      window.removeEventListener(SETUP_SUCCESS_COLLAPSED_EVENT, syncCollapsed)
      window.removeEventListener('storage', syncCollapsed)
    }
  }, [syncCollapsed])

  useEffect(() => {
    if (!collapsed) {
      setProgress(null)
      return
    }
    let cancelled = false
    const refresh = () => {
      void loadSetupSuccessProgress().then((next) => {
        if (!cancelled) setProgress(next)
      })
    }
    refresh()
    window.addEventListener(ASSET_REGISTRY_CHANGED_EVENT, refresh)
    window.addEventListener('storage', refresh)
    return () => {
      cancelled = true
      window.removeEventListener(ASSET_REGISTRY_CHANGED_EVENT, refresh)
      window.removeEventListener('storage', refresh)
    }
  }, [collapsed, location.pathname])

  const show = Boolean(progress && shouldShowSetupSuccessNavHint(progress))
  const percent = progress ? setupSuccessPercent(progress) : 0

  const expandCard = useCallback(() => {
    clearSetupSuccessCardDismissed()
    setCollapsed(false)
  }, [])

  return { show, percent, expandCard }
}
