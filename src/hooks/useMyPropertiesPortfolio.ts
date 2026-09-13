import { useCallback, useEffect, useState } from 'react'
import { getActiveLandlordId } from '@/lib/activeLandlord'
import { PROPERTY_DETAILS_CHANGED_EVENTS } from '@/lib/propertyDetailsCompleteness'
import {
  fetchMyPropertiesPortfolio,
  type MyPropertiesPortfolio,
} from '@/lib/myPropertiesAcrossAdmin'

const EMPTY: MyPropertiesPortfolio = {
  buildings: [],
  previewBuildings: [],
  totalUnits: 0,
  propertyIdByBuilding: new Map(),
}

export function useMyPropertiesPortfolio(enabled: boolean) {
  const landlordId = getActiveLandlordId()
  const [loading, setLoading] = useState(enabled)
  const [portfolio, setPortfolio] = useState<MyPropertiesPortfolio>(EMPTY)

  const refresh = useCallback(async () => {
    if (!enabled) {
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      const next = await fetchMyPropertiesPortfolio(landlordId)
      setPortfolio(next)
    } catch (err) {
      console.warn('[my properties] portfolio load failed', err)
      setPortfolio(EMPTY)
    } finally {
      setLoading(false)
    }
  }, [enabled, landlordId])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    if (!enabled) return
    const onChanged = () => {
      void refresh()
    }
    for (const eventName of PROPERTY_DETAILS_CHANGED_EVENTS) {
      window.addEventListener(eventName, onChanged)
    }
    return () => {
      for (const eventName of PROPERTY_DETAILS_CHANGED_EVENTS) {
        window.removeEventListener(eventName, onChanged)
      }
    }
  }, [enabled, refresh])

  return { loading, portfolio, refresh }
}
