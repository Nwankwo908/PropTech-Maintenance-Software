import {
  buildPropertyIdByBuilding,
  propertyDetailPath,
  propertyDetailPathForBuilding,
  propertyResidentDetailPathForBuilding,
  residentDetailPath,
} from '@/lib/propertyRoutes'
import { supabase } from '@/lib/supabase'
import { isOnboardingImportLeaseRenewalRun } from '@/lib/onboardingImportLeaseRenewal'
import type { UniversalSearchItem } from '@/lib/adminUniversalSearchCore'

const WORKFLOW_TEMPLATE_LABELS: Record<string, string> = {
  maintenance_intake: 'Maintenance intake',
  maintenance_request: 'Maintenance request',
  lease_renewal: 'Lease renewal',
  rent_collection: 'Rent collection',
  move_in: 'Move in',
  move_out: 'Move out',
  inspection: 'Inspection',
  vendor_job_response: 'Vendor job response',
  identity_onboarding: 'Identity onboarding',
  landlord_command: 'Landlord command',
}

function asString(value: unknown): string {
  if (value == null) return ''
  return String(value).trim()
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  return {}
}

function readMetaString(metadata: Record<string, unknown>, key: string): string | null {
  const value = metadata[key]
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed || null
}

function buildKeywords(parts: Array<string | null | undefined>): string {
  return parts
    .map((part) => part?.trim().toLowerCase())
    .filter(Boolean)
    .join(' ')
}

function formatUnitLabel(raw: string | null | undefined): string {
  const unit = raw?.trim()
  if (!unit) return 'Unit'
  if (/^unit\b/i.test(unit)) return unit
  return `Unit ${unit}`
}

function formatWorkOrderTitle(row: Record<string, unknown>, includeDescription: boolean): string {
  const unit = asString(row.unit)
  const building = asString(row.building)
  const issue =
    (includeDescription ? asString(row.description) : '') ||
    asString(row.issue) ||
    asString(row.issue_category) ||
    asString(row.title) ||
    'Work order'
  const location = unit ? formatUnitLabel(unit) : building || ''
  if (location) return `${location} – ${issue}`
  return issue
}

function formatWorkflowTemplateName(templateId: string): string {
  return WORKFLOW_TEMPLATE_LABELS[templateId] ?? templateId.replace(/_/g, ' ')
}

function resolveWorkflowCategory(
  templateId: string,
): UniversalSearchItem['category'] {
  if (templateId === 'lease_renewal') return 'lease_renewal'
  if (templateId === 'rent_collection') return 'rent_collection'
  if (templateId === 'inspection') return 'inspection'
  return 'workflow'
}

function formatWorkflowSubtitle(input: {
  templateId: string
  status: string
  metadata: Record<string, unknown>
}): string {
  const template = formatWorkflowTemplateName(input.templateId)
  const status = input.status.replace(/_/g, ' ')
  const building =
    readMetaString(input.metadata, 'building') ||
    readMetaString(input.metadata, 'property_label') ||
    readMetaString(input.metadata, 'property_name')
  const unit =
    readMetaString(input.metadata, 'unit') || readMetaString(input.metadata, 'unit_label')
  const location = [building, unit ? formatUnitLabel(unit) : null].filter(Boolean).join(' · ')
  if (location) return `${template} · ${status} · ${location}`
  return `${template} · ${status}`
}

function formatWorkflowTitle(input: {
  templateId: string
  metadata: Record<string, unknown>
}): string {
  const template = formatWorkflowTemplateName(input.templateId)
  const building =
    readMetaString(input.metadata, 'building') ||
    readMetaString(input.metadata, 'property_label') ||
    readMetaString(input.metadata, 'property_name')
  if (building) return `${template} – ${building}`
  return template
}

function mapUnitsToSearchItems(
  rows: Record<string, unknown>[],
  propertyIdByBuilding: Map<string, string>,
): UniversalSearchItem[] {
  const items: UniversalSearchItem[] = []
  const buildings = new Set<string>()

  for (const row of rows) {
    const building = asString(row.building)
    const unitLabel = asString(row.unit_label)
    const unitId = asString(row.id)
    if (!building || !unitId) continue

    if (!buildings.has(building)) {
      buildings.add(building)
      items.push({
        id: `property:${building}`,
        category: 'property',
        title: building,
        subtitle: 'Property',
        href: propertyDetailPathForBuilding(building, propertyIdByBuilding),
        keywords: buildKeywords([building, 'property', 'building']),
        detailLoaded: true,
      })
    }

    items.push({
      id: `unit:${unitId}`,
      category: 'unit',
      title: formatUnitLabel(unitLabel),
      subtitle: building,
      href: `${propertyDetailPathForBuilding(building, propertyIdByBuilding)}?unit=${encodeURIComponent(unitLabel || unitId)}`,
      keywords: buildKeywords([unitLabel, building, 'unit']),
      detailLoaded: true,
    })
  }

  return items
}

function mapResidentsToSearchItems(
  rows: Record<string, unknown>[],
  propertyIdByBuilding: Map<string, string>,
): UniversalSearchItem[] {
  return rows.flatMap((row) => {
    const id = asString(row.id)
    const name = asString(row.full_name) || 'Unnamed resident'
    const building = asString(row.building) || null
    const unit = asString(row.unit)
    if (!id) return []

    const subtitle =
      [building, unit ? formatUnitLabel(unit) : null].filter(Boolean).join(' · ') || 'Resident'
    const href = building
      ? propertyResidentDetailPathForBuilding(building, id, propertyIdByBuilding)
      : residentDetailPath(id)

    return [
      {
        id: `resident:${id}`,
        category: 'resident' as const,
        title: name,
        subtitle,
        href,
        keywords: buildKeywords([name, building, unit, 'resident', 'tenant']),
        detailLoaded: true,
      },
    ]
  })
}

function mapVendorsToSearchItems(rows: Record<string, unknown>[]): UniversalSearchItem[] {
  return rows.flatMap((row) => {
    const id = asString(row.id)
    const name = asString(row.name) || 'Vendor'
    const categoryLabel = asString(row.category)
    if (!id) return []

    return [
      {
        id: `vendor:${id}`,
        category: 'vendor' as const,
        title: name,
        subtitle: categoryLabel || 'Vendor',
        href: `/admin/vendors/${encodeURIComponent(id)}`,
        keywords: buildKeywords([name, categoryLabel, 'vendor']),
        detailLoaded: true,
      },
    ]
  })
}

function mapMaintenanceLight(rows: Record<string, unknown>[]): UniversalSearchItem[] {
  return rows.flatMap((row) => {
    const id = asString(row.id)
    if (!id) return []
    const title = formatWorkOrderTitle(row, false)
    const building = asString(row.building)
    const unit = asString(row.unit)
    const issueCategory = asString(row.issue_category)
    const subtitle =
      [building, unit ? formatUnitLabel(unit) : null, issueCategory]
        .filter(Boolean)
        .join(' · ') || 'Maintenance request'

    return [
      {
        id: `work-order:${id}`,
        category: 'work_order' as const,
        title,
        subtitle,
        href: `/admin/requests?q=${encodeURIComponent(title || id)}`,
        keywords: buildKeywords([
          id,
          title,
          building,
          unit,
          issueCategory,
          asString(row.issue),
          'work order',
          'maintenance',
          'request',
        ]),
        detailLoaded: false,
      },
    ]
  })
}

function mapMaintenanceDetailed(rows: Record<string, unknown>[]): UniversalSearchItem[] {
  return rows.flatMap((row) => {
    const id = asString(row.id)
    if (!id) return []
    const title = formatWorkOrderTitle(row, true)
    const building = asString(row.building)
    const unit = asString(row.unit)
    const issueCategory = asString(row.issue_category)
    const subtitle =
      [building, unit ? formatUnitLabel(unit) : null, issueCategory]
        .filter(Boolean)
        .join(' · ') || 'Maintenance request'

    return [
      {
        id: `work-order:${id}`,
        category: 'work_order' as const,
        title,
        subtitle,
        href: `/admin/requests?q=${encodeURIComponent(title || id)}`,
        keywords: buildKeywords([
          id,
          title,
          building,
          unit,
          issueCategory,
          asString(row.description),
          asString(row.issue),
          'work order',
          'maintenance',
          'request',
        ]),
        detailLoaded: true,
      },
    ]
  })
}

function mapWorkflowRunsToSearchItems(rows: Record<string, unknown>[]): UniversalSearchItem[] {
  return rows.flatMap((row) => {
    const id = asString(row.id)
    const templateId = asString(row.template_id) || 'workflow'
    const status = asString(row.status) || 'active'
    const metadata = asRecord(row.metadata)
    if (!id) return []

    const category = resolveWorkflowCategory(templateId)
    const title = formatWorkflowTitle({ templateId, metadata })
    const subtitle = formatWorkflowSubtitle({ templateId, status, metadata })

    return [
      {
        id: `workflow:${id}`,
        category,
        title,
        subtitle,
        href: `/admin/workflows?run=${encodeURIComponent(id)}`,
        keywords: buildKeywords([
          id,
          title,
          subtitle,
          templateId,
          status,
          readMetaString(metadata, 'building'),
          readMetaString(metadata, 'unit'),
          readMetaString(metadata, 'resident_name'),
          'workflow',
        ]),
        detailLoaded: true,
      },
    ]
  })
}

async function loadProperties(
  landlordId: string,
): Promise<Array<{ id: string; name: string }>> {
  if (!supabase) return []
  const { data, error } = await supabase
    .from('properties')
    .select('id, name')
    .eq('landlord_id', landlordId)
    .limit(200)
  if (error) return []
  return ((data ?? []) as Array<{ id: string; name: string }>).map((row) => ({
    id: String(row.id),
    name: String(row.name ?? ''),
  }))
}

/** Stage 1 — properties / units / residents / vendors (fast first paint). */
export async function loadAdminSearchIndexLight(
  landlordId: string,
): Promise<UniversalSearchItem[]> {
  if (!supabase || !landlordId.trim()) return []

  const [unitsResult, usersResult, vendorsResult, properties] = await Promise.all([
    supabase
      .from('units')
      .select('id, unit_label, building')
      .eq('landlord_id', landlordId)
      .limit(500),
    supabase
      .from('users')
      .select('id, full_name, unit, building')
      .eq('landlord_id', landlordId)
      .neq('status', 'past_resident')
      .limit(500),
    supabase
      .from('vendors')
      .select('id, name, category')
      .eq('landlord_id', landlordId)
      .limit(200),
    loadProperties(landlordId),
  ])

  const propertyIdByBuilding = buildPropertyIdByBuilding(properties)
  const items: UniversalSearchItem[] = []

  if (!unitsResult.error) {
    items.push(
      ...mapUnitsToSearchItems(
        (unitsResult.data ?? []) as Record<string, unknown>[],
        propertyIdByBuilding,
      ),
    )
  }

  // Properties with no units still need to be searchable.
  const seenPropertyTitles = new Set(
    items.filter((item) => item.category === 'property').map((item) => item.title.toLowerCase()),
  )
  for (const property of properties) {
    const name = property.name.trim()
    if (!name || seenPropertyTitles.has(name.toLowerCase())) continue
    items.push({
      id: `property-id:${property.id}`,
      category: 'property',
      title: name,
      subtitle: 'Property',
      href: propertyDetailPath(property.id),
      keywords: buildKeywords([name, 'property', 'building']),
      detailLoaded: true,
    })
  }

  if (!usersResult.error) {
    items.push(
      ...mapResidentsToSearchItems(
        (usersResult.data ?? []) as Record<string, unknown>[],
        propertyIdByBuilding,
      ),
    )
  }
  if (!vendorsResult.error) {
    items.push(...mapVendorsToSearchItems((vendorsResult.data ?? []) as Record<string, unknown>[]))
  }

  return items
}

/** Stage 2 — work orders (light fields) + workflow runs. */
export async function loadAdminSearchIndexHeavy(
  landlordId: string,
): Promise<UniversalSearchItem[]> {
  if (!supabase || !landlordId.trim()) return []

  const [enrichedTicketsResult, workflowRunsResult] = await Promise.all([
    supabase
      .from('maintenance_request_enriched')
      .select('id, building, unit, issue, issue_category')
      .eq('landlord_id', landlordId)
      .order('created_at', { ascending: false })
      .limit(200),
    supabase
      .from('workflow_runs')
      .select('id, template_id, status, entity_type, metadata')
      .eq('landlord_id', landlordId)
      .order('started_at', { ascending: false })
      .limit(100),
  ])

  const items: UniversalSearchItem[] = []

  let maintenanceRows: Record<string, unknown>[] = []
  if (!enrichedTicketsResult.error) {
    maintenanceRows = (enrichedTicketsResult.data ?? []) as Record<string, unknown>[]
  } else {
    const fallback = await supabase
      .from('maintenance_requests')
      .select('id, building, unit, issue, issue_category')
      .eq('landlord_id', landlordId)
      .order('created_at', { ascending: false })
      .limit(200)
    if (!fallback.error) {
      maintenanceRows = (fallback.data ?? []) as Record<string, unknown>[]
    }
  }
  items.push(...mapMaintenanceLight(maintenanceRows))

  if (!workflowRunsResult.error) {
    const operationalRuns = ((workflowRunsResult.data ?? []) as Record<string, unknown>[]).filter(
      (row) =>
        !isOnboardingImportLeaseRenewalRun(
          asString(row.template_id),
          asRecord(row.metadata),
          asString(row.entity_type),
        ),
    )
    items.push(...mapWorkflowRunsToSearchItems(operationalRuns))
  }

  return items
}

/** Lazy detail for rendered work-order rows (description → richer title/keywords). */
export async function enrichSearchItemsDetail(
  landlordId: string,
  itemIds: string[],
): Promise<Map<string, UniversalSearchItem>> {
  const out = new Map<string, UniversalSearchItem>()
  if (!supabase || !landlordId.trim() || itemIds.length === 0) return out

  const workOrderIds = itemIds
    .filter((id) => id.startsWith('work-order:'))
    .map((id) => id.slice('work-order:'.length))
    .filter(Boolean)
    .slice(0, SEARCH_DETAIL_BATCH)

  if (workOrderIds.length === 0) return out

  const { data, error } = await supabase
    .from('maintenance_request_enriched')
    .select('id, building, unit, description, issue, issue_category')
    .eq('landlord_id', landlordId)
    .in('id', workOrderIds)

  let rows = !error ? ((data ?? []) as Record<string, unknown>[]) : []
  if (error || rows.length === 0) {
    const fallback = await supabase
      .from('maintenance_requests')
      .select('id, building, unit, description, issue, issue_category')
      .eq('landlord_id', landlordId)
      .in('id', workOrderIds)
    if (!fallback.error) rows = (fallback.data ?? []) as Record<string, unknown>[]
  }

  for (const item of mapMaintenanceDetailed(rows)) {
    out.set(item.id, item)
  }
  return out
}

const SEARCH_DETAIL_BATCH = 40
