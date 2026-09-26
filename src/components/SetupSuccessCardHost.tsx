import { useCallback, useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { GetSetUpForSuccessCard } from '@/components/GetSetUpForSuccessCard'
import { getActiveLandlordId } from '@/lib/activeLandlord'
import { loadSetupSuccessProgress } from '@/lib/loadSetupSuccessProgress'
import { hasSeenLimitedAlphaPostOnboardingWelcome } from '@/lib/postOnboardingWelcome'
import { PROPERTY_DETAILS_CHANGED_EVENTS } from '@/lib/propertyDetailsCompleteness'
import { listPropertiesForLandlord } from '@/lib/properties'
import {
  propertyDetailPath,
  type PropertyDetailTab,
} from '@/lib/propertyRoutes'
import {
  dismissSetupSuccessCard,
  isSetupSuccessCardDismissed,
  SETUP_SUCCESS_COLLAPSED_EVENT,
  SETUP_SUCCESS_PROGRESS_CHANGED_EVENT,
  shouldShowSetupSuccessCard,
  type SetupSuccessItemId,
  type SetupSuccessProgress,
} from '@/lib/setupSuccessChecklist'
import { isLimitedAlphaLandlord } from '@shared/landlordCapabilities'

/**
 * Global Get set up for success overlay — every admin route, not only Overview.
 * Profile setup in the sidebar clears dismiss and this host shows the card again.
 */
export function SetupSuccessCardHost() {
  const location = useLocation()
  const landlordId = getActiveLandlordId()
  const eligible =
    isLimitedAlphaLandlord(landlordId) && hasSeenLimitedAlphaPostOnboardingWelcome(landlordId)

  const [progress, setProgress] = useState<SetupSuccessProgress | null>(null)
  const [dismissed, setDismissed] = useState(isSetupSuccessCardDismissed)
  const [firstPropertyId, setFirstPropertyId] = useState<string | null>(null)

  useEffect(() => {
    const syncDismissed = () => setDismissed(isSetupSuccessCardDismissed())
    syncDismissed()
    window.addEventListener(SETUP_SUCCESS_COLLAPSED_EVENT, syncDismissed)
    window.addEventListener('storage', syncDismissed)
    return () => {
      window.removeEventListener(SETUP_SUCCESS_COLLAPSED_EVENT, syncDismissed)
      window.removeEventListener('storage', syncDismissed)
    }
  }, [])

  useEffect(() => {
    if (!eligible) {
      setProgress(null)
      setFirstPropertyId(null)
      return
    }
    let cancelled = false
    const refresh = () => {
      void Promise.all([
        loadSetupSuccessProgress(landlordId),
        listPropertiesForLandlord(landlordId),
      ]).then(([next, propertiesResult]) => {
        if (cancelled) return
        setProgress(next)
        if (propertiesResult.ok) {
          const first = propertiesResult.properties.find((row) => row.name.trim() || row.id)
          setFirstPropertyId(first?.id ?? null)
        } else {
          setFirstPropertyId(null)
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
    }
  }, [eligible, landlordId, location.pathname])

  const resolveItemTo = useCallback(
    (itemId: SetupSuccessItemId): string | undefined => {
      if (!firstPropertyId) return undefined
      if (itemId === 'property_access' || itemId === 'property_intelligence') {
        return propertyDetailPath(firstPropertyId, 'overview' satisfies PropertyDetailTab)
      }
      if (itemId === 'property_insurance') {
        return propertyDetailPath(firstPropertyId, 'insurance')
      }
      return undefined
    },
    [firstPropertyId],
  )

  if (!progress || dismissed || !shouldShowSetupSuccessCard(progress, landlordId)) {
    return null
  }

  return (
    <GetSetUpForSuccessCard
      progress={progress}
      resolveItemTo={resolveItemTo}
      onClose={() => {
        dismissSetupSuccessCard()
        setDismissed(true)
      }}
    />
  )
}
