/**
 * Import AI / mock extraction into the onboarding portfolio.
 */
import { getActiveLandlordId } from '@/lib/activeLandlord'
import type {
  ExtractedMaintenanceIssue,
  MockExtractionReview,
} from '@/lib/onboardingMockExtraction'
import { supabase } from '@/lib/supabase'
import { activateUnitsFromResidentAssignments } from '@/lib/unitActivation'
import { normalizePhoneForDb } from '@/lib/phoneFormat'
import { normalizeBuildingKey } from '@/lib/propertyHealth'
import { isUniqueViolation } from '@/lib/errorMessage'
import {
  issueCategoryToVendorTrade,
  isGeneralistTrade,
  normalizeVendorTrade,
} from '@/lib/vendorTrades'
import { requireOnboardingLandlord } from './draftStorage'
import { importOnboardingResidentsFromExtraction } from './persist/importResidents'
import { persistOnboardingProperties, collectExtractedUnitLabels } from './persist/properties'
import { fetchOnboardingResidents } from './persist/residents'
import { fetchOnboardingVendors } from './persist/vendors'
import type { OnboardingProperty } from './types'

type ImportUnitRow = {
  id: string
  unitLabel: string
  building: string | null
}

type ImportResidentRow = {
  id: string
  fullName: string
  unit: string
  building: string
  email: string
}

type ImportVendorRow = {
  id: string
  category: string
}

function mapExtractedIssuePriority(priority: string): {
  priority: string
  urgency: string
  severity: string
} {
  const value = priority.trim().toLowerCase()
  if (value === 'urgent' || value === 'emergency') {
    return { priority: 'urgent', urgency: 'urgent', severity: 'urgent' }
  }
  if (value === 'high') {
    return { priority: 'high', urgency: 'urgent', severity: 'high' }
  }
  return { priority: 'normal', urgency: 'normal', severity: 'normal' }
}

function resolveImportUnitLabel(issueUnit: string, units: ImportUnitRow[]): string {
  const trimmed = issueUnit.trim()
  if (!trimmed) return trimmed

  const exact = units.find(
    (unit) => unit.unitLabel.trim().toLowerCase() === trimmed.toLowerCase(),
  )
  if (exact) return exact.unitLabel

  const letter = trimmed.toUpperCase()
  if (/^[A-Z]$/.test(letter)) {
    const index = letter.charCodeAt(0) - 'A'.charCodeAt(0)
    if (units[index]) return units[index]!.unitLabel
  }

  return trimmed
}

function findImportResident(
  residents: ImportResidentRow[],
  issueUnit: string,
  building: string,
): ImportResidentRow | undefined {
  const unitKey = issueUnit.trim().toLowerCase()
  const buildingKey = normalizeBuildingKey(building)
  return (
    residents.find(
      (resident) =>
        resident.unit.trim().toLowerCase() === unitKey &&
        normalizeBuildingKey(resident.building) === buildingKey,
    ) ?? residents.find((resident) => resident.unit.trim().toLowerCase() === unitKey)
  )
}

function findImportUnit(
  units: ImportUnitRow[],
  issueUnit: string,
  building: string,
  resolvedLabel: string,
): ImportUnitRow | undefined {
  const buildingKey = normalizeBuildingKey(building)
  return (
    units.find(
      (unit) =>
        unit.unitLabel === resolvedLabel &&
        normalizeBuildingKey(unit.building ?? '') === buildingKey,
    ) ??
    units.find((unit) => unit.unitLabel === resolvedLabel) ??
    units.find(
      (unit) =>
        unit.unitLabel.trim().toLowerCase() === issueUnit.trim().toLowerCase() &&
        normalizeBuildingKey(unit.building ?? '') === buildingKey,
    )
  )
}

async function fetchImportUnits(landlordId: string): Promise<ImportUnitRow[]> {
  if (!supabase) return []

  const { data, error } = await supabase
    .from('units')
    .select('id, unit_label, building')
    .eq('landlord_id', landlordId)
    .order('unit_label', { ascending: true })

  if (error) {
    console.warn('[landlordOnboarding] fetch import units', error.message)
    return []
  }

  return (data ?? []).map((row) => ({
    id: String((row as { id: string }).id),
    unitLabel: String((row as { unit_label: string }).unit_label ?? ''),
    building: String((row as { building?: string | null }).building ?? '') || null,
  }))
}

async function fetchImportResidents(landlordId: string): Promise<ImportResidentRow[]> {
  const residents = await fetchOnboardingResidents(landlordId)
  return residents.map((resident) => ({
    id: resident.id,
    fullName: resident.fullName,
    unit: resident.unit,
    building: resident.building,
    email: resident.email,
  }))
}

async function logImportWorkflowEvent(
  workflowRunId: string,
  event: {
    eventType: string
    step?: string
    message: string
    metadata?: Record<string, unknown>
  },
): Promise<void> {
  if (!supabase) return

  const { error } = await supabase.from('workflow_events').insert({
    workflow_run_id: workflowRunId,
    event_type: event.eventType,
    step: event.step ?? null,
    actor_type: 'system',
    message: event.message,
    metadata: event.metadata ?? {},
  })

  if (error) {
    console.warn('[landlordOnboarding] workflow event insert', error.message)
  }
}

function matchImportVendorForCategory(
  category: string,
  vendors: ImportVendorRow[],
): ImportVendorRow | undefined {
  if (vendors.length === 0) return undefined

  const issueTrade = issueCategoryToVendorTrade(category)
  const preferred = [issueTrade, 'general'] as const

  for (const preferredSlug of preferred) {
    const match = vendors.find((vendor) => {
      const vendorTrade = normalizeVendorTrade(vendor.category, { fallbackOther: false })
      if (preferredSlug === 'general') {
        return isGeneralistTrade(vendor.category) || vendorTrade === 'general'
      }
      return vendorTrade === preferredSlug
    })
    if (match) return match
  }

  return vendors[0]
}

async function importExtractedMaintenanceIssues(
  issues: ExtractedMaintenanceIssue[],
  params: {
    landlordId: string
    units: ImportUnitRow[]
    residents: ImportResidentRow[]
    vendors: ImportVendorRow[]
  },
): Promise<{ tickets: number; workflowRuns: number }> {
  if (!supabase || issues.length === 0) {
    return { tickets: 0, workflowRuns: 0 }
  }

  let tickets = 0
  let workflowRuns = 0
  const now = Date.now()

  for (let index = 0; index < issues.length; index++) {
    const issue = issues[index]!
    const resolvedUnit = resolveImportUnitLabel(issue.unit, params.units)
    const resident = findImportResident(params.residents, issue.unit, issue.building)
    const unit = findImportUnit(params.units, issue.unit, issue.building, resolvedUnit)
    const sla = mapExtractedIssuePriority(issue.priority)
    const createdAt = new Date(now - index * 36 * 60 * 60 * 1000).toISOString()
    const dueAt = new Date(
      Date.now() -
        (sla.severity === 'urgent' || sla.severity === 'high' ? 6 : 1) * 60 * 60 * 1000,
    ).toISOString()
    const matchedVendor = matchImportVendorForCategory(issue.category, params.vendors)
    const vendorWorkStatus = matchedVendor
      ? index % 2 === 0
        ? 'pending_accept'
        : 'accepted'
      : 'unassigned'

    const { data: ticketRow, error: ticketError } = await supabase
      .from('maintenance_requests')
      .insert({
        landlord_id: params.landlordId,
        created_at: createdAt,
        priority: sla.priority,
        urgency: sla.urgency,
        severity: sla.severity,
        resident_name: resident?.fullName ?? 'Property Manager',
        email: resident?.email?.trim() || 'newlandlord@ulohome.io',
        unit: resolvedUnit,
        description: issue.description.trim() || 'Imported maintenance issue',
        assigned_vendor_id: matchedVendor?.id ?? null,
        assigned_at: matchedVendor ? createdAt : null,
        vendor_work_status: vendorWorkStatus,
        issue_category: issue.category.trim() || 'general',
        estimated_minutes: sla.severity === 'urgent' ? 240 : 480,
        due_at: dueAt,
      })
      .select('id')
      .single()

    if (ticketError || !ticketRow?.id) {
      console.warn('[landlordOnboarding] maintenance import', ticketError?.message)
      continue
    }

    tickets += 1
    const ticketId = String(ticketRow.id)
    const runStatus = sla.severity === 'urgent' || index === 0 ? 'escalated' : 'active'

    const { data: runRow, error: runError } = await supabase
      .from('workflow_runs')
      .insert({
        template_id: 'maintenance_intake',
        status: runStatus,
        entity_type: 'maintenance_request',
        entity_id: ticketId,
        property_id: null,
        unit_id: unit?.id ?? null,
        resident_id: resident?.id ?? null,
        landlord_id: params.landlordId,
        trigger_type: 'dashboard',
        workflow_type: 'maintenance',
        current_stage: runStatus === 'escalated' ? 'escalated' : 'routed',
        current_step: runStatus === 'escalated' ? 'awaiting_review' : 'document_import',
        started_at: createdAt,
        metadata: {
          landlord_id: params.landlordId,
          unit_label: resolvedUnit,
          building: issue.building,
          maintenance_request_id: ticketId,
          issue_category: issue.category,
          source: 'onboarding_import',
          description: issue.description,
        },
      })
      .select('id')
      .single()

    if (runError || !runRow?.id) {
      console.warn('[landlordOnboarding] maintenance workflow import', runError?.message)
      continue
    }

    workflowRuns += 1
    const runId = String(runRow.id)
    await logImportWorkflowEvent(runId, {
      eventType: 'workflow.trigger',
      step: 'document_import',
      message: 'Maintenance issue imported from onboarding documents',
      metadata: { maintenance_request_id: ticketId, source: 'onboarding_import' },
    })
    if (runStatus === 'escalated') {
      await logImportWorkflowEvent(runId, {
        eventType: 'workflow.escalate',
        step: 'awaiting_review',
        message: 'Imported issue flagged for landlord review',
      })
    }
  }

  return { tickets, workflowRuns }
}

export async function importMockExtraction(
  review: MockExtractionReview,
  landlordId: string = getActiveLandlordId(),
): Promise<{ ok: boolean; error?: string; imported: Record<string, number> }> {
  const scope = requireOnboardingLandlord(landlordId)
  if (!scope.ok) {
    return { ok: false, error: scope.error, imported: {} }
  }
  if (!supabase) {
    return { ok: false, error: 'We can\'t reach the server right now. Please try again in a moment.', imported: {} }
  }
  landlordId = scope.landlordId

  const imported = {
    properties: 0,
    units: 0,
    residents: 0,
    vendors: 0,
    tickets: 0,
    leases: 0,
    workflowRuns: 0,
  }

  const selectedProperties = review.properties.filter((p) => p.selected)
  const onboardingProperties: OnboardingProperty[] = selectedProperties.map((p) => {
    const unitLabels = collectExtractedUnitLabels({
      propertyName: p.name,
      otherPropertyNames: selectedProperties.map((property) => property.name),
      units: review.units,
      residents: review.residents,
      leases: review.leases,
    })
    return {
      id: p.id,
      name: p.name,
      streetAddress: p.address.split(',')[0]?.trim() ?? p.address,
      city: '',
      state: '',
      zipCode: '',
      unitCount: Math.max(p.unitCount || 0, unitLabels.length, 1),
      unitLabels: unitLabels.length > 0 ? unitLabels : undefined,
      propertyManagerName: '',
      propertyManagerPhone: '',
    }
  })

  let persistedProperties: OnboardingProperty[] = []
  if (onboardingProperties.length > 0) {
    const unitResult = await persistOnboardingProperties(onboardingProperties)
    if (!unitResult.ok) return { ...unitResult, imported }
    persistedProperties = unitResult.properties
    imported.properties = unitResult.properties.length
    imported.units = unitResult.properties.reduce(
      (s, p) => s + (p.unitLabels?.length || p.unitCount),
      0,
    )
  }

  const selectedResidents = review.residents.filter((r) => r.selected)
  const selectedLeases = review.leases.filter((lease) => lease.selected)
  imported.residents = await importOnboardingResidentsFromExtraction(
    selectedResidents,
    selectedLeases,
    landlordId,
    {
      properties: persistedProperties.map((property) => ({
        id: property.id,
        name: property.name,
      })),
    },
  )

  const selectedVendors = review.vendors.filter((v) => v.selected)
  const seenVendorNames = new Set<string>()
  const uniqueSelectedVendors = selectedVendors.filter((vendor) => {
    const nameKey = vendor.name.trim().toLowerCase()
    if (!nameKey || seenVendorNames.has(nameKey)) return false
    seenVendorNames.add(nameKey)
    return true
  })

  if (uniqueSelectedVendors.length > 0) {
    const existingVendors = await fetchOnboardingVendors(landlordId)
    const existingByName = new Map(
      existingVendors.map((vendor) => [vendor.name.trim().toLowerCase(), vendor]),
    )

    for (const vendor of uniqueSelectedVendors) {
      const nameKey = vendor.name.trim().toLowerCase()
      const payload = {
        name: vendor.name,
        category: vendor.category,
        email: vendor.email,
        phone: normalizePhoneForDb(vendor.phone) ?? null,
        notification_channel: 'both' as const,
        active: true,
        preferred_emergency: Boolean(
          (vendor as { preferredEmergency?: boolean }).preferredEmergency,
        ),
      }
      const existing = existingByName.get(nameKey)
      if (existing) {
        const { error } = await supabase
          .from('vendors')
          .update(payload)
          .eq('id', existing.id)
          .eq('landlord_id', landlordId)
        if (!error) imported.vendors += 1
        continue
      }

      const { error } = await supabase.from('vendors').insert({
        ...payload,
        landlord_id: landlordId,
      })
      if (!error) {
        imported.vendors += 1
        existingByName.set(nameKey, {
          id: `imported-${nameKey}`,
          name: vendor.name,
          category: vendor.category ?? '',
          email: vendor.email,
          phone: vendor.phone,
          preferredEmergency: false,
        })
      }
    }
  }

  const [importUnits, importResidents, importVendors] = await Promise.all([
    fetchImportUnits(landlordId),
    fetchImportResidents(landlordId),
    fetchOnboardingVendors(landlordId),
  ])

  const maintenanceIssues = review.maintenanceIssues.filter((issue) => issue.selected)
  if (maintenanceIssues.length > 0) {
    const maintenanceImport = await importExtractedMaintenanceIssues(maintenanceIssues, {
      landlordId,
      units: importUnits,
      residents: importResidents,
      vendors: importVendors.map((vendor) => ({
        id: vendor.id,
        category: vendor.category,
      })),
    })
    imported.tickets = maintenanceImport.tickets
    imported.workflowRuns += maintenanceImport.workflowRuns
  }

  // Lease dates persist on residents above. Real lease_renewal runs start from
  // check-lease-renewals when the notice window opens — do not insert dummy WOs.
  imported.leases = selectedLeases.length

  // Tenant + unit + lease dates from document import activates those units.
  await activateUnitsFromResidentAssignments({
    landlordId,
    source: 'onboarding_import',
  })

  return { ok: true, imported }
}
