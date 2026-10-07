import { useSearchParams } from 'react-router-dom'
import { useAskUlo, withAskUloSearch } from '@/components/AskUloContext'
import { PropertyHealthBuildingGrid } from '@/components/PropertyHealthBuildingGrid'
import { useMyPropertiesPortfolio } from '@/hooks/useMyPropertiesPortfolio'
import { adminNavPath } from '@/lib/adminNavigation'
import { assignAdminPath } from '@/lib/assignAdminPath'
import { propertyDetailPathForBuilding } from '@/lib/propertyRoutes'

export function MyPropertiesAcrossAdmin({
  className,
  fitContainer = false,
  spotlightId,
}: {
  className?: string
  fitContainer?: boolean
  /** Try Demo tip cutout — place on the My Properties card, not a stretch wrapper. */
  spotlightId?: string
} = {}) {
  const [searchParams] = useSearchParams()
  const { open: askUloOpen } = useAskUlo()
  const { loading, portfolio } = useMyPropertiesPortfolio(true)
  const propertiesPath = adminNavPath('properties')
  const viewAllTo = askUloOpen
    ? withAskUloSearch(propertiesPath, searchParams, { forceDock: true })
    : propertiesPath

  return (
    <PropertyHealthBuildingGrid
      className={className}
      fitContainer={fitContainer}
      spotlightId={spotlightId}
      loading={loading}
      buildings={portfolio.previewBuildings}
      buildingCount={portfolio.buildings.length}
      totalUnits={portfolio.totalUnits}
      emptyCtaHref={`${propertiesPath}?add=1`}
      emptyCtaLabel="Add your first property"
      buildingHref={(building) =>
        propertyDetailPathForBuilding(building, portfolio.propertyIdByBuilding)
      }
      headerAction={
        <button
          type="button"
          className="admin-quiet-text-action sa-link relative z-10"
          onClick={(event) => {
            event.preventDefault()
            event.stopPropagation()
            assignAdminPath(viewAllTo)
          }}
        >
          View all properties →
        </button>
      }
    />
  )
}
