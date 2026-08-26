import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { getActiveLandlordId } from '@/lib/activeLandlord'
import { loadLandlordSettings } from '@/lib/landlordSettings'
import type { OrganizationSettingsForm } from '@/lib/organizationSettings'
import {
  formatLandlordCurrency,
  formatLandlordDate,
  getLandlordAbout,
  getLandlordDisplayName,
  landlordBrandAccentCssProperties,
  resolveLandlordDisplayName,
  setLandlordWorkspaceCache,
} from '@/lib/landlordWorkspace'

type LandlordWorkspaceContextValue = {
  loading: boolean
  organization: OrganizationSettingsForm | null
  displayName: string
  about: string
  refresh: () => Promise<void>
  formatCurrency: (amount: number | null | undefined) => string
  formatDate: (value: string | Date | null | undefined) => string
}

const LandlordWorkspaceContext = createContext<LandlordWorkspaceContextValue | null>(null)

export function LandlordWorkspaceProvider({ children }: { children: ReactNode }) {
  const landlordId = getActiveLandlordId()
  const [loading, setLoading] = useState(true)
  const [organization, setOrganization] = useState<OrganizationSettingsForm | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const snapshot = await loadLandlordSettings(landlordId)
      setOrganization(snapshot.organization)
      setLandlordWorkspaceCache({ organization: snapshot.organization })
    } finally {
      setLoading(false)
    }
  }, [landlordId])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const value = useMemo<LandlordWorkspaceContextValue>(() => {
    const displayName = organization
      ? resolveLandlordDisplayName(organization)
      : getLandlordDisplayName()
    const aboutText = organization?.about.trim() ?? getLandlordAbout()

    return {
      loading,
      organization,
      displayName,
      about: aboutText,
      refresh,
      formatCurrency: (amount) =>
        formatLandlordCurrency(amount, organization ?? undefined),
      formatDate: (value) => formatLandlordDate(value, organization ?? undefined),
    }
  }, [loading, organization, refresh])

  return (
    <LandlordWorkspaceContext.Provider value={value}>
      <div style={landlordBrandAccentCssProperties(organization?.brandAccent)}>
        {children}
      </div>
    </LandlordWorkspaceContext.Provider>
  )
}

export function useLandlordWorkspace(): LandlordWorkspaceContextValue {
  const context = useContext(LandlordWorkspaceContext)
  if (!context) {
    throw new Error('useLandlordWorkspace must be used within LandlordWorkspaceProvider')
  }
  return context
}
