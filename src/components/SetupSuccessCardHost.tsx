import { useCallback, useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { GetSetUpForSuccessCard } from '@/components/GetSetUpForSuccessCard'
import { getActiveLandlordId } from '@/lib/activeLandlord'
import { fetchLandlordAccountProfile } from '@/lib/landlordAccountProfile'
import { loadSetupSuccessProgress } from '@/lib/loadSetupSuccessProgress'
import { PROPERTY_DETAILS_CHANGED_EVENTS } from '@/lib/propertyDetailsCompleteness'
import { listPropertiesForLandlord } from '@/lib/properties'
import {
  propertyDetailPath,
  type PropertyDetailTab,
} from '@/lib/propertyRoutes'
import {
  clearSetupSuccessCompleteInformationPrompt,
  dismissSetupSuccessCard,
  isSetupSuccessCardHidden,
  isSetupSuccessCompleteInformationPrompt,
  minimizeSetupSuccessCard,
  SETUP_SUCCESS_COLLAPSED_EVENT,
  SETUP_SUCCESS_PROGRESS_CHANGED_EVENT,
  setupSuccessExperienceReady,
  shouldShowSetupSuccessCard,
  type SetupSuccessItemId,
  type SetupSuccessProgress,
} from '@/lib/setupSuccessChecklist'

/**
 * Global Get set up for success overlay — every admin route, not only Overview.
 * Profile setup in the sidebar clears dismiss/minimize and this host shows the card again.
 */
export function SetupSuccessCardHost() {
  const location = useLocation()
  const landlordId = getActiveLandlordId()
  const eligible = setupSuccessExperienceReady(landlordId)

  const [accountContactName, setAccountContactName] = useState<string | null>(null)
  const [progress, setProgress] = useState<SetupSuccessProgress | null>(null)
  const [hidden, setHidden] = useState(() => isSetupSuccessCardHidden(landlordId))
  const [showPropertyAccessPrompt, setShowPropertyAccessPrompt] = useState(() =>
    isSetupSuccessCompleteInformationPrompt(landlordId),
  )
  const [firstPropertyId, setFirstPropertyId] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void fetchLandlordAccountProfile(landlordId).then((account) => {
      if (!cancelled) setAccountContactName(account.contactName)
    })
    return () => {
      cancelled = true
    }
  }, [landlordId])

  useEffect(() => {
    const syncCard = () => {
      setHidden(isSetupSuccessCardHidden(landlordId))
      setShowPropertyAccessPrompt(isSetupSuccessCompleteInformationPrompt(landlordId))
    }
    syncCard()
    window.addEventListener(SETUP_SUCCESS_COLLAPSED_EVENT, syncCard)
    window.addEventListener('storage', syncCard)
    return () => {
      window.removeEventListener(SETUP_SUCCESS_COLLAPSED_EVENT, syncCard)
      window.removeEventListener('storage', syncCard)
    }
  }, [landlordId])

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

  if (!progress || hidden || !shouldShowSetupSuccessCard(progress, landlordId)) {
    return null
  }

  return (
    <GetSetUpForSuccessCard
      progress={progress}
      firstName={accountContactName}
      showPropertyAccessPrompt={showPropertyAccessPrompt}
      resolveItemTo={resolveItemTo}
      onClose={() => {
        clearSetupSuccessCompleteInformationPrompt(landlordId)
        setShowPropertyAccessPrompt(false)
        dismissSetupSuccessCard(landlordId)
        setHidden(true)
      }}
      onMinimize={() => {
        clearSetupSuccessCompleteInformationPrompt(landlordId)
        setShowPropertyAccessPrompt(false)
        minimizeSetupSuccessCard(landlordId)
        setHidden(true)
      }}
    />
  )
}
