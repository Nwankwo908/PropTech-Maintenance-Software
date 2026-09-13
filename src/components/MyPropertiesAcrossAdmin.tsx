import { Link } from 'react-router-dom'
import { PropertyHealthBuildingGrid } from '@/components/PropertyHealthBuildingGrid'
import { useMyPropertiesPortfolio } from '@/hooks/useMyPropertiesPortfolio'
import { propertyDetailPathForBuilding } from '@/lib/propertyRoutes'

export function MyPropertiesAcrossAdmin() {
  const { loading, portfolio } = useMyPropertiesPortfolio(true)

  return (
    <PropertyHealthBuildingGrid
      loading={loading}
      buildings={portfolio.previewBuildings}
      buildingCount={portfolio.buildings.length}
      totalUnits={portfolio.totalUnits}
      emptyCtaHref="/admin/properties?add=1"
      emptyCtaLabel="Add your first property"
      buildingHref={(building) =>
        propertyDetailPathForBuilding(building, portfolio.propertyIdByBuilding)
      }
      headerAction={
        <Link to="/admin/properties" className="admin-quiet-text-action sa-link">
          View all properties →
        </Link>
      }
    />
  )
}
