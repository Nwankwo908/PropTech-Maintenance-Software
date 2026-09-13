import { getActiveLandlordId } from '@/lib/activeLandlord'
import { listPropertiesForLandlord } from '@/lib/properties'
import {
  buildPropertyHealthReport,
  countDistinctPortfolioUnits,
  enrichFeedbackFromTickets,
  fetchPropertyHealthSignals,
  mapTicketsForPropertyHealth,
  mapUnitsForPropertyHealth,
  type PropertyHealthBuildingRow,
  type PropertyHealthCanonicalProperty,
  type PropertyHealthResident,
} from '@/lib/propertyHealth'
import { buildPropertyIdByBuilding } from '@/lib/propertyRoutes'
import { supabase } from '@/lib/supabase'

/** Overview-style preview of the worst-scoring buildings. */
export const MY_PROPERTIES_PREVIEW_LIMIT = 6

function asString(value: unknown): string {
  if (value == null) return ''
  return String(value).trim()
}

export type MyPropertiesPortfolio = {
  buildings: PropertyHealthBuildingRow[]
  previewBuildings: PropertyHealthBuildingRow[]
  totalUnits: number
  propertyIdByBuilding: Map<string, string>
}

export async function fetchMyPropertiesPortfolio(
  landlordId: string = getActiveLandlordId(),
): Promise<MyPropertiesPortfolio> {
  const empty: MyPropertiesPortfolio = {
    buildings: [],
    previewBuildings: [],
    totalUnits: 0,
    propertyIdByBuilding: new Map(),
  }
  if (!supabase) return empty

  const [ticketsResult, unitsResult, healthSignals, residentsResult, canonicalPropertiesResult] =
    await Promise.all([
      supabase
        .from('maintenance_request_enriched')
        .select(
          'id, created_at, unit, unit_id, building, email, issue_category, assigned_vendor_id, vendor_work_status, urgency, severity, priority, description, due_at',
        )
        .eq('landlord_id', landlordId)
        .order('created_at', { ascending: false })
        .limit(500)
        .then((result) =>
          result.error
            ? supabase!
                .from('maintenance_requests')
                .select(
                  'id, created_at, unit, email, issue_category, assigned_vendor_id, vendor_work_status, urgency, severity, priority, description, due_at',
                )
                .eq('landlord_id', landlordId)
                .order('created_at', { ascending: false })
                .limit(500)
            : result,
        ),
      supabase
        .from('units')
        .select('id, unit_label, building, status, property_id, updated_at')
        .eq('landlord_id', landlordId)
        .limit(1000),
      fetchPropertyHealthSignals(),
      supabase
        .from('users')
        .select('id, full_name, unit, building, status, email')
        .eq('landlord_id', landlordId)
        .neq('status', 'past_resident')
        .limit(2000),
      listPropertiesForLandlord(landlordId),
    ])

  const ticketRows = ticketsResult.error
    ? []
    : ((ticketsResult.data ?? []) as Record<string, unknown>[])
  const unitRows = unitsResult.error
    ? []
    : ((unitsResult.data ?? []) as Record<string, unknown>[])

  const residents: PropertyHealthResident[] = residentsResult.error
    ? []
    : ((residentsResult.data ?? []) as Record<string, unknown>[])
        .map((raw) => ({
          id: asString(raw.id),
          fullName: asString(raw.full_name) || 'Unnamed resident',
          unit: asString(raw.unit),
          building: asString(raw.building) || null,
          status: asString(raw.status).toLowerCase() || 'active',
          email: asString(raw.email) || null,
        }))
        .filter((row) => row.id)

  const canonicalProperties: PropertyHealthCanonicalProperty[] = canonicalPropertiesResult.ok
    ? canonicalPropertiesResult.properties.map((property) => ({
        id: property.id,
        name: property.name,
      }))
    : []

  const healthTickets = mapTicketsForPropertyHealth(ticketRows)
  const units = mapUnitsForPropertyHealth(unitRows)
  const report = buildPropertyHealthReport({
    units,
    tickets: healthTickets,
    pmTasks: healthSignals.pmTasks,
    feedback: enrichFeedbackFromTickets(healthSignals.feedback, healthTickets),
    vendorMetrics: healthSignals.vendorMetrics,
    assets: healthSignals.assets,
    inspections: healthSignals.inspections,
    damageReports: healthSignals.damageReports,
    residents,
    canonicalProperties,
  })

  return {
    buildings: report.buildings,
    previewBuildings: report.buildings.slice(0, MY_PROPERTIES_PREVIEW_LIMIT),
    totalUnits: countDistinctPortfolioUnits(units),
    propertyIdByBuilding: buildPropertyIdByBuilding(canonicalProperties),
  }
}
