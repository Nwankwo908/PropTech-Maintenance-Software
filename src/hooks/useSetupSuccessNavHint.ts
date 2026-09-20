import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { getActiveLandlordId } from '@/lib/activeLandlord'
import { loadSetupSuccessProgress } from '@/lib/loadSetupSuccessProgress'
import { hasSeenLimitedAlphaPostOnboardingWelcome } from '@/lib/postOnboardingWelcome'
import { PROPERTY_DETAILS_CHANGED_EVENTS } from '@/lib/propertyDetailsCompleteness'
import { isLimitedAlpha1Landlord } from '@shared/landlordCapabilities'
import {
  clearSetupSuccessCardDismissed,
  SETUP_SUCCESS_COLLAPSED_EVENT,
  SETUP_SUCCESS_NAV_GAIN_FLASH_MS,
  SETUP_SUCCESS_PROGRESS_CHANGED_EVENT,
  setupSuccessNavPercentGain,
  setupSuccessPercent,
  shouldShowSetupSuccessNavHint,
  type SetupSuccessProgress,
} from '@/lib/setupSuccessChecklist'

export function useSetupSuccessNavHint() {
  const location = useLocation()
  const landlordId = getActiveLandlordId()
  const eligible =
    isLimitedAlpha1Landlord(landlordId) && hasSeenLimitedAlphaPostOnboardingWelcome(landlordId)
  const [progress, setProgress] = useState<SetupSuccessProgress | null>(null)
  const [gainDelta, setGainDelta] = useState(0)
  const gainTimerRef = useRef<number | null>(null)

  useEffect(() => {
    if (!eligible) {
      setProgress(null)
      setGainDelta(0)
      return
    }
    let cancelled = false
    const refresh = () => {
      void loadSetupSuccessProgress(landlordId).then((next) => {
        if (cancelled || !next) return
        const percent = setupSuccessPercent(next)
        const gain = setupSuccessNavPercentGain(percent, landlordId)
        setProgress(next)
        if (gain > 0) {
          setGainDelta(gain)
          if (gainTimerRef.current != null) window.clearTimeout(gainTimerRef.current)
          gainTimerRef.current = window.setTimeout(() => {
            setGainDelta(0)
            gainTimerRef.current = null
          }, SETUP_SUCCESS_NAV_GAIN_FLASH_MS)
        }
      })
    }
    refresh()
    for (const eventName of PROPERTY_DETAILS_CHANGED_EVENTS) {
      window.addEventListener(eventName, refresh)
    }
    window.addEventListener(SETUP_SUCCESS_COLLAPSED_EVENT, refresh)
    window.addEventListener(SETUP_SUCCESS_PROGRESS_CHANGED_EVENT, refresh)
    return () => {
      cancelled = true
      for (const eventName of PROPERTY_DETAILS_CHANGED_EVENTS) {
        window.removeEventListener(eventName, refresh)
      }
      window.removeEventListener(SETUP_SUCCESS_COLLAPSED_EVENT, refresh)
      window.removeEventListener(SETUP_SUCCESS_PROGRESS_CHANGED_EVENT, refresh)
      if (gainTimerRef.current != null) window.clearTimeout(gainTimerRef.current)
    }
  }, [eligible, landlordId, location.pathname])

  const incomplete = Boolean(progress && shouldShowSetupSuccessNavHint(progress))
  const showCompletionFlash = Boolean(progress && progress.doneCount >= progress.total && gainDelta > 0)
  const show = incomplete || showCompletionFlash
  const percent = progress ? setupSuccessPercent(progress) : 0

  const expandCard = useCallback(() => {
    clearSetupSuccessCardDismissed()
  }, [])

  return { show, percent, gainDelta, expandCard }
}
