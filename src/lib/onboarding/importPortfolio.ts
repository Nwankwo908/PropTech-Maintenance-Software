/**
 * Import AI / mock extraction into the onboarding portfolio.
 */
import { getActiveLandlordId } from '@/lib/activeLandlord'
import type {
  ExtractedFinancialLine,
  ExtractedMaintenanceIssue,
  MockExtractionReview,
} from '@/lib/onboardingMockExtraction'
import { supabase } from '@/lib/supabase'
import { activateUnitsFromResidentAssignments } from '@/lib/unitActivation'
import { normalizePhoneForDb } from '@/lib/phoneFormat'
import {
  shouldMintOpenTicketFromHistoricalIssue,
  shouldMintTicketFromExpenseLine,
} from './fastTrackTicketPolicy'
import { normalizeBuildingKey } from '@/lib/propertyHealth'
import { isUniqueViolation } from '@/lib/errorMessage'
import {
  issueCategoryToVendorTrade,
  isGeneralistTrade,
  normalizeVendorTrade,
  vendorTradeToDbCategory,
} from '@/lib/vendorTrades'
import { recordActivityLog } from '@/lib/recordActivityLog'
import {
  loadApprovedMaintenanceRecords,
  loadMaintenanceHistoryDocuments,
  recordsFromPlainJobs,
  saveApprovedMaintenanceRecords,
  saveMaintenanceHistoryDocuments,
  type MaintenanceHistoryDocument,
} from '@/lib/maintenanceHistoryImport'
import { requireOnboardingLandlord } from './draftStorage'
import { saveImportedOpsRecords } from './persist/importedOpsRecords'
import { importOnboardingResidentsFromExtraction } from './persist/importResidents'
import { persistOnboardingProperties, collectExtractedUnitLabels } from './persist/properties'
import { fetchOnboardingResidents } from './persist/residents'
import { fetchOnboardingVendors } from './persist/vendors'
import {
  isMaintenanceExpenseFinancialRecord,
  parseFinancialAmount,
  parseFinancialPeriodToIso,
  resolveListedPropertyForExpense,
} from './maintenanceExpenseFromFinancial'

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

function fallbackImportBuilding(
  properties: { name: string }[],
  building: string,
): string {
  const trimmed = building.trim()
  if (trimmed) return trimmed
  return properties[0]?.name.trim() || 'Portfolio'
}

function importIssuesIntoMaintenanceHistory(
  issues: ExtractedMaintenanceIssue[],
  properties: { name: string }[],
  landlordId: string,
): void {
  if (typeof window === 'undefined' || issues.length === 0) return

  const grouped = new Map<string, ExtractedMaintenanceIssue[]>()
  for (const issue of issues) {
    const building = fallbackImportBuilding(properties, issue.building)
    const list = grouped.get(building) ?? []
    list.push(issue)
    grouped.set(building, list)
  }

  for (const [building, group] of grouped) {
    const scope = { landlordId, building }
    const stamp = Date.now()
    const doc: MaintenanceHistoryDocument = {
      id: `onb-mh-${stamp}-${building.replace(/\s+/g, '-').slice(0, 24)}`,
      fileName: group[0]?.sourceDocumentName?.trim() || 'Fast Track import',
      fileSize: 0,
      fileType: 'TXT',
      status: 'ready_for_review',
      uploadedAt: new Date().toISOString(),
      records: [],
    }
    const records = recordsFromPlainJobs(
      doc,
      building,
      group.map((issue) => ({
        tradeCategory: issue.category,
        issueType: issue.description,
        workPerformed: issue.description,
        unitLabel: issue.unit,
        notes: issue.sourceDocumentName ?? '',
        confidence: 0.85,
      })),
    ).map((record) => ({ ...record, approved: true }))

    const existingApproved = loadApprovedMaintenanceRecords(scope)
    saveApprovedMaintenanceRecords([...existingApproved, ...records], scope)
    const existingDocs = loadMaintenanceHistoryDocuments(scope)
    saveMaintenanceHistoryDocuments(
      [...existingDocs, { ...doc, records }],
      scope,
    )
  }
}

async function importExtractedFinancialRecords(
  records: ExtractedFinancialLine[],
  params: {
    landlordId: string
    properties: { name: string }[]
    units: ImportUnitRow[]
    residents: ImportResidentRow[]
    vendors: ImportVendorRow[]
  },
): Promise<{
  financialRecords: number
  historyTickets: number
  /** Maintenance expense lines skipped because no vendor matched (dropped, not parked). */
  unmatchedExpenses: number
}> {
  if (records.length === 0) {
    return { financialRecords: 0, historyTickets: 0, unmatchedExpenses: 0 }
  }

  await recordActivityLog({
    landlordId: params.landlordId,
    eventType: 'financial.imported',
    source: 'onboarding',
    actorType: 'landlord',
    metadata: {
      message:
        records.length === 1
          ? `Imported financial record: ${records[0]?.description.trim() || records[0]?.amount || 'line item'}`
          : `Imported ${records.length} financial records from onboarding documents.`,
      count: records.length,
      source: 'onboarding_import',
    },
  })

  if (!supabase) {
    return { financialRecords: records.length, historyTickets: 0, unmatchedExpenses: 0 }
  }

  let historyTickets = 0
  let unmatchedExpenses = 0
  const now = Date.now()

  for (let index = 0; index < records.length; index++) {
    const record = records[index]!
    if (!isMaintenanceExpenseFinancialRecord(record)) continue

    const listedBuilding = resolveListedPropertyForExpense(record.building, params.properties)
    if (!listedBuilding) continue

    const amount = parseFinancialAmount(record.amount)
    if (amount <= 0) continue

    const resolvedUnit = resolveImportUnitLabel(record.unit, params.units)
    const unitFromBuilding =
      params.units.find(
        (unit) =>
          normalizeBuildingKey(unit.building ?? '') === normalizeBuildingKey(listedBuilding) &&
          (!resolvedUnit ||
            unit.unitLabel.trim().toLowerCase() === resolvedUnit.trim().toLowerCase()),
      ) ??
      params.units.find(
        (unit) =>
          normalizeBuildingKey(unit.building ?? '') === normalizeBuildingKey(listedBuilding),
      )
    const unitLabel =
      (resolvedUnit && unitFromBuilding?.unitLabel) ||
      unitFromBuilding?.unitLabel ||
      resolvedUnit ||
      '—'
    const unit = findImportUnit(
      params.units,
      record.unit || unitLabel,
      listedBuilding,
      unitLabel,
    )
    const resident = findImportResident(params.residents, unitLabel, listedBuilding)
    const matchedVendor = matchImportVendorForCategory(
      record.description || record.recordType,
      params.vendors,
    )
    // PRODUCT DECISION: unmatched expenses are dropped (not parked for matching).
    if (!matchedVendor || !shouldMintTicketFromExpenseLine({ matchedVendorId: matchedVendor.id })) {
      unmatchedExpenses += 1
      continue
    }

    const activityAt =
      parseFinancialPeriodToIso(record.period) ||
      new Date(now - index * 24 * 60 * 60 * 1000).toISOString()
    const description =
      record.description.trim() ||
      record.recordType.trim() ||
      'Imported maintenance expense'

    const { data: ticketRow, error: ticketError } = await supabase
      .from('maintenance_requests')
      .insert({
        landlord_id: params.landlordId,
        created_at: activityAt,
        completed_at: activityAt,
        priority: 'normal',
        urgency: 'normal',
        severity: 'normal',
        resident_name: resident?.fullName ?? 'Property Manager',
        email: resident?.email?.trim() || '',
        unit: unitLabel,
        description,
        assigned_vendor_id: matchedVendor.id,
        assigned_at: activityAt,
        vendor_work_status: 'completed',
        issue_category: issueCategoryToVendorTrade(
          record.description.trim() || record.recordType.trim() || 'general',
        ),
        estimated_minutes: 120,
        spend_status: 'recognized',
        recognized_spend_at: activityAt,
        recognized_spend_amount: amount,
      })
      .select('id')
      .single()

    if (ticketError || !ticketRow?.id) {
      console.warn('[landlordOnboarding] financial expense ticket import', ticketError?.message)
      continue
    }

    const ticketId = String(ticketRow.id)
    const invoiceNumber = `ONB-${ticketId.replace(/-/g, '').slice(0, 8).toUpperCase()}`

    const { data: invoiceRow, error: invoiceError } = await supabase
      .from('maintenance_invoices')
      .insert({
        landlord_id: params.landlordId,
        maintenance_request_id: ticketId,
        vendor_id: matchedVendor?.id ?? null,
        invoice_number: invoiceNumber,
        labor_cost: amount,
        material_cost: 0,
        tax_amount: 0,
        status: 'approved',
        submitted_at: activityAt,
        approved_at: activityAt,
        vendor_notes: record.sourceDocumentName?.trim() || 'Imported from onboarding documents',
        metadata: {
          source: 'onboarding_import',
          building: listedBuilding,
          unit: unitLabel,
          record_type: record.recordType,
          period: record.period,
          financial_record_id: record.id,
        },
      })
      .select('id')
      .single()

    if (invoiceError || !invoiceRow?.id) {
      console.warn('[landlordOnboarding] financial expense invoice import', invoiceError?.message)
      // Ticket alone still surfaces in History once completed; amount stays 0 without invoice.
    }

    historyTickets += 1
    await recordActivityLog({
      landlordId: params.landlordId,
      eventType: 'maintenance.expense_imported',
      source: 'onboarding',
      actorType: 'landlord',
      maintenanceRequestId: ticketId,
      unitId: unit?.id ?? null,
      vendorId: matchedVendor?.id ?? null,
      metadata: {
        message: `Imported maintenance expense: ${description} · $${amount.toFixed(2)}`,
        source: 'onboarding_import',
        building: listedBuilding,
        amount,
        invoice_id: invoiceRow?.id ? String(invoiceRow.id) : null,
      },
    })
  }

  return { financialRecords: records.length, historyTickets, unmatchedExpenses }
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
    financialRecords: 0,
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
        category: vendorTradeToDbCategory(vendor.category) ?? 'general',
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
        if (error) {
          console.warn('[fastTrackImport] update vendor', vendor.name, error.message)
          continue
        }
        imported.vendors += 1
        continue
      }

      const { error } = await supabase.from('vendors').insert({
        ...payload,
        landlord_id: landlordId,
      })
      if (error) {
        console.warn('[fastTrackImport] insert vendor', vendor.name, error.message)
        continue
      }
      imported.vendors += 1
      existingByName.set(nameKey, {
        id: `imported-${nameKey}`,
        name: vendor.name,
        category: payload.category ?? '',
        email: vendor.email,
        phone: vendor.phone,
        city: '',
        state: '',
        country: '',
        preferredEmergency: false,
      })
    }
  }

  const [importUnits, importResidents, importVendors] = await Promise.all([
    fetchImportUnits(landlordId),
    fetchImportResidents(landlordId),
    fetchOnboardingVendors(landlordId),
  ])

  const maintenanceIssues = (review.maintenanceIssues ?? []).filter((issue) => issue.selected)
  if (maintenanceIssues.length > 0) {
    // PRODUCT DECISION (fastTrackTicketPolicy): always History-only — never Open Repairs.
    const openFromHistorical = maintenanceIssues.filter((issue) =>
      shouldMintOpenTicketFromHistoricalIssue(issue),
    )
    if (openFromHistorical.length > 0) {
      console.warn(
        '[fastTrackImport] policy violated: refusing to mint open tickets from historical issues',
        openFromHistorical.length,
      )
    }
    importIssuesIntoMaintenanceHistory(maintenanceIssues, persistedProperties, landlordId)
  }

  const financialRecords = (review.financialRecords ?? []).filter((row) => row.selected)
  const financialImport = await importExtractedFinancialRecords(financialRecords, {
    landlordId,
    properties: persistedProperties.map((property) => ({ name: property.name })),
    units: importUnits,
    residents: importResidents,
    vendors: importVendors.map((vendor) => ({
      id: vendor.id,
      category: vendor.category,
    })),
  })
  imported.financialRecords = financialImport.financialRecords
  imported.tickets += financialImport.historyTickets

  saveImportedOpsRecords(
    {
      maintenanceIssues: maintenanceIssues.map((issue) => ({
        id: issue.id,
        description: issue.description,
        unit: issue.unit,
        building: issue.building,
        category: issue.category,
        priority: issue.priority,
      })),
      financialRecords: financialRecords.map((row) => ({
        id: row.id,
        recordType: row.recordType,
        description: row.description,
        amount: row.amount,
        period: row.period,
        building: row.building ?? '',
        unit: row.unit ?? '',
        sourceDocumentName: row.sourceDocumentName ?? '',
      })),
    },
    landlordId,
  )

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
