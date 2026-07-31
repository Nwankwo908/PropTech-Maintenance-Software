import { getErrorMessage } from '@/lib/errorMessage'
/**
 * Building-level Asset Registry — Property Details UI over unit_assets (Operational Graph).
 * AI inspection confirm and manual Register/Edit both write the same Asset shape.
 */
import { getActiveLandlordId } from '@/lib/activeLandlord'
import {
  ageYearsFromBuildYear,
  loadPropertyBuildingProfile,
} from '@/lib/propertyBuildingProfile'
import { supabase } from '@/lib/supabase'

export type RegistryAssetType =
  | 'hvac'
  | 'water_heater'
  | 'boiler'
  | 'appliance'
  | 'roof'
  | 'electrical_panel'

export type BoilerFuelType = 'gas' | 'oil' | 'electric' | 'propane' | 'unknown'

export type ApplianceSubtype =
  | 'fridge'
  | 'stove'
  | 'microwave'
  | 'washer'
  | 'dryer'
  | 'other'

export type AssetAgeBasis = 'known' | 'estimated_from_build_year' | 'ai_estimated'

export type AssetRegistrySource = 'ai_inspection' | 'manual' | 'manual_updated'

export type AssetRegistryKind = 'system' | 'appliance'
export type AssetRegistryStatusTone = 'ok' | 'warn' | 'missing'

export type AssetRegistryItem = {
  id: string
  /** Stable catalog slot, e.g. hvac or appliance:fridge */
  slotKey: string
  unitAssetId: string | null
  registryAssetType: RegistryAssetType
  applianceSubtype: ApplianceSubtype | null
  kind: AssetRegistryKind
  emoji: string
  title: string
  shortTitle?: string
  ageYears: number | null
  ageBasis: AssetAgeBasis | null
  brand: string
  /** Type/material/model detail shown in cards */
  detail: string
  modelNumber: string
  serialNumber: string
  /** ISO date or display string for last service */
  lastServiceDate: string | null
  lastInspectionDate: string | null
  /** Amp capacity for electrical panel */
  capacityAmps: number | null
  waterHeaterType: string
  roofMaterial: string
  fuelType: BoilerFuelType | ''
  btuOutput: number | null
  lastPressureTest: string | null
  condition: string
  lastService: string
  lastServiceOverdue: boolean
  remainingLifeYears: number | null
  statusNote: string
  statusTone: AssetRegistryStatusTone
  emptyHint: string
  source: AssetRegistrySource | null
  lastAssessedDate: string | null
  fieldConflicts: Array<{ field: string; manualValue: string; aiValue: string }>
}

export type AssetRegistryState = {
  items: AssetRegistryItem[]
  updatedAt: string | null
  buildYear: number | null
}

export const ASSET_REGISTRY_CHANGED_EVENT = 'ulo:asset-registry-changed'

type SlotDef = Omit<
  AssetRegistryItem,
  | 'id'
  | 'unitAssetId'
  | 'ageYears'
  | 'ageBasis'
  | 'brand'
  | 'detail'
  | 'modelNumber'
  | 'serialNumber'
  | 'lastServiceDate'
  | 'lastInspectionDate'
  | 'capacityAmps'
  | 'waterHeaterType'
  | 'roofMaterial'
  | 'fuelType'
  | 'btuOutput'
  | 'lastPressureTest'
  | 'condition'
  | 'lastService'
  | 'lastServiceOverdue'
  | 'remainingLifeYears'
  | 'statusNote'
  | 'statusTone'
  | 'source'
  | 'lastAssessedDate'
  | 'fieldConflicts'
> & { emptyHint: string }

const SYSTEM_SLOTS: SlotDef[] = [
  {
    slotKey: 'hvac',
    registryAssetType: 'hvac',
    applianceSubtype: null,
    kind: 'system',
    emoji: '💨',
    title: 'HVAC System',
    emptyHint:
      'Add HVAC age and brand to enable predictive maintenance and remaining-life estimates.',
  },
  {
    slotKey: 'water_heater',
    registryAssetType: 'water_heater',
    applianceSubtype: null,
    kind: 'system',
    emoji: '🚰',
    title: 'Water Heater',
    emptyHint:
      'Add water heater age and type to track flush intervals and replacement timing.',
  },
  {
    slotKey: 'boiler',
    registryAssetType: 'boiler',
    applianceSubtype: null,
    kind: 'system',
    emoji: '🔥',
    title: 'Boiler',
    emptyHint:
      'Add boiler age, fuel type, and last service to track annual service and pressure-relief checks.',
  },
  {
    slotKey: 'roof',
    registryAssetType: 'roof',
    applianceSubtype: null,
    kind: 'system',
    emoji: '🏠',
    title: 'Roof',
    emptyHint:
      'Add roof age and shingle material to enable automated predictive storm damage reviews.',
  },
  {
    slotKey: 'electrical_panel',
    registryAssetType: 'electrical_panel',
    applianceSubtype: null,
    kind: 'system',
    emoji: '⚡',
    title: 'Electrical Panel',
    emptyHint:
      'Define amp capacity to prevent overload diagnostics during automated tenant work order reviews.',
  },
]

const APPLIANCE_SLOTS: SlotDef[] = (
  [
    ['fridge', 'Fridge'],
    ['stove', 'Stove'],
    ['microwave', 'Microwave'],
    ['washer', 'Washer'],
    ['dryer', 'Dryer'],
  ] as const
).map(([subtype, title]) => ({
  slotKey: `appliance:${subtype}`,
  registryAssetType: 'appliance' as const,
  applianceSubtype: subtype,
  kind: 'appliance' as const,
  emoji: '➕',
  title,
  shortTitle: title,
  emptyHint: '',
}))

function emptyItem(slot: SlotDef, index: number): AssetRegistryItem {
  return {
    id: `slot-${slot.slotKey}-${index}`,
    unitAssetId: null,
    ageYears: null,
    ageBasis: null,
    brand: '',
    detail: '',
    modelNumber: '',
    serialNumber: '',
    lastServiceDate: null,
    lastInspectionDate: null,
    capacityAmps: null,
    waterHeaterType: '',
    roofMaterial: '',
    fuelType: '',
    btuOutput: null,
    lastPressureTest: null,
    condition: '',
    lastService: '',
    lastServiceOverdue: false,
    remainingLifeYears: null,
    statusNote: '',
    statusTone: 'missing',
    source: null,
    lastAssessedDate: null,
    fieldConflicts: [],
    ...slot,
  }
}

export function usefulLifeForRegistryType(type: RegistryAssetType): number {
  switch (type) {
    case 'roof':
      return 25
    case 'hvac':
    case 'boiler':
      return 15
    case 'water_heater':
      return 12
    case 'electrical_panel':
      return 30
    default:
      return 12
  }
}

function serviceIntervalMonths(type: RegistryAssetType): number {
  switch (type) {
    case 'hvac':
    case 'water_heater':
    case 'boiler':
      return 12
    case 'roof':
      return 24
    case 'electrical_panel':
      return 36
    default:
      return 24
  }
}

export function deriveAssetStatus(item: AssetRegistryItem): AssetRegistryItem {
  const hasCore =
    item.ageYears != null ||
    Boolean(item.brand.trim()) ||
    Boolean(item.detail.trim()) ||
    Boolean(item.lastService.trim()) ||
    Boolean(item.lastServiceDate) ||
    Boolean(item.lastInspectionDate) ||
    item.capacityAmps != null ||
    Boolean(item.waterHeaterType.trim()) ||
    Boolean(item.roofMaterial.trim()) ||
    Boolean(item.fuelType) ||
    item.btuOutput != null ||
    Boolean(item.lastPressureTest) ||
    Boolean(item.modelNumber.trim())

  if (!hasCore) {
    return {
      ...item,
      emoji: item.kind === 'appliance' ? '➕' : item.emoji,
      statusTone: 'missing',
      statusNote: '',
      remainingLifeYears: null,
      lastServiceOverdue: false,
    }
  }

  const life = usefulLifeForRegistryType(item.registryAssetType)
  const remaining =
    item.ageYears != null && item.ageYears >= 0
      ? Math.max(0, Math.round((life - item.ageYears) * 10) / 10)
      : item.remainingLifeYears

  const overdue =
    item.lastServiceOverdue ||
    /\boverdue\b/i.test(item.lastService) ||
    (item.ageYears != null && item.ageYears >= life * 0.85)

  let statusTone: AssetRegistryStatusTone = 'ok'
  let statusNote = ''
  if (overdue || (remaining != null && remaining <= 2)) {
    statusTone = 'warn'
    statusNote =
      item.statusNote.trim() ||
      (overdue ? 'Needs diagnostic check soon' : 'Approaching end of useful life')
  } else if (remaining != null) {
    statusTone = 'ok'
    const estimated =
      item.ageBasis === 'estimated_from_build_year' || item.ageBasis === 'ai_estimated'
        ? ' (estimated)'
        : ''
    statusNote = `Estimated Remaining Life: ~${remaining} year${remaining === 1 ? '' : 's'}${estimated}`
  }

  return {
    ...item,
    emoji: item.kind === 'appliance' ? '✅' : item.emoji,
    remainingLifeYears: remaining,
    lastServiceOverdue: overdue,
    statusTone,
    statusNote,
  }
}

export function createDefaultAssetRegistry(buildYear: number | null = null): AssetRegistryState {
  const items = [...SYSTEM_SLOTS, ...APPLIANCE_SLOTS].map((slot, i) =>
    deriveAssetStatus(emptyItem(slot, i)),
  )
  return { items, updatedAt: null, buildYear }
}

export function assetRegistryHasContent(state: AssetRegistryState): boolean {
  return state.items.some(
    (item) =>
      item.unitAssetId != null ||
      item.ageYears != null ||
      item.brand.trim() ||
      item.detail.trim() ||
      item.lastService.trim() ||
      item.lastServiceDate ||
      item.lastInspectionDate ||
      item.capacityAmps != null ||
      item.waterHeaterType.trim() ||
      item.roofMaterial.trim(),
  )
}

export function isAssetComplete(item: AssetRegistryItem): boolean {
  if (item.kind === 'appliance') {
    return Boolean(item.brand.trim() || item.detail.trim() || item.modelNumber.trim())
  }
  return (
    item.ageYears != null ||
    Boolean(item.brand.trim()) ||
    Boolean(item.detail.trim()) ||
    Boolean(item.lastService.trim()) ||
    Boolean(item.lastServiceDate) ||
    Boolean(item.lastInspectionDate) ||
    item.capacityAmps != null ||
    Boolean(item.waterHeaterType.trim()) ||
    Boolean(item.roofMaterial.trim()) ||
    Boolean(item.fuelType) ||
    item.btuOutput != null ||
    Boolean(item.lastPressureTest)
  )
}

function storageKey(building: string): string {
  const landlordId = getActiveLandlordId()
  const key = building.trim().toLowerCase().replace(/\s+/g, '-')
  return `ulo.assetRegistry.${landlordId}.${key}`
}

function formatServiceDisplay(iso: string | null | undefined, overdueFlag?: boolean): string {
  if (overdueFlag) return 'Overdue'
  if (!iso?.trim()) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso.trim()
  return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
}

function parseDateInput(value: string | null | undefined): string | null {
  if (!value?.trim()) return null
  const t = value.trim()
  if (/^\d{4}-\d{2}-\d{2}/.test(t)) return t.slice(0, 10)
  const d = new Date(t)
  if (Number.isNaN(d.getTime())) return null
  return d.toISOString().slice(0, 10)
}

function addMonthsIso(iso: string, months: number): string {
  const d = new Date(iso)
  d.setMonth(d.getMonth() + months)
  return d.toISOString()
}

/** Map vision / free-text type strings onto a catalog slot. */
export function resolveRegistrySlot(input: {
  category?: string | null
  applianceType?: string | null
  applianceSubtype?: string | null
  registryAssetType?: string | null
}): { slotKey: string; registryAssetType: RegistryAssetType; applianceSubtype: ApplianceSubtype | null } {
  const reg = (input.registryAssetType || '').toLowerCase()
  if (reg === 'hvac') return { slotKey: 'hvac', registryAssetType: 'hvac', applianceSubtype: null }
  if (reg === 'boiler') {
    return { slotKey: 'boiler', registryAssetType: 'boiler', applianceSubtype: null }
  }
  if (reg === 'water_heater') {
    return { slotKey: 'water_heater', registryAssetType: 'water_heater', applianceSubtype: null }
  }
  if (reg === 'roof') return { slotKey: 'roof', registryAssetType: 'roof', applianceSubtype: null }
  if (reg === 'electrical_panel') {
    return {
      slotKey: 'electrical_panel',
      registryAssetType: 'electrical_panel',
      applianceSubtype: null,
    }
  }
  if (reg === 'appliance') {
    const sub = normalizeApplianceSubtype(input.applianceSubtype || input.applianceType)
    return {
      slotKey: `appliance:${sub}`,
      registryAssetType: 'appliance',
      applianceSubtype: sub,
    }
  }

  const cat = `${input.category || ''} ${input.applianceType || ''}`.toLowerCase()
  if (cat.includes('electrical') || cat.includes('panel') || cat.includes('breaker')) {
    return {
      slotKey: 'electrical_panel',
      registryAssetType: 'electrical_panel',
      applianceSubtype: null,
    }
  }
  if (cat.includes('roof')) return { slotKey: 'roof', registryAssetType: 'roof', applianceSubtype: null }
  if (cat.includes('boiler') || input.category === 'boiler') {
    return { slotKey: 'boiler', registryAssetType: 'boiler', applianceSubtype: null }
  }
  if (
    cat.includes('water heater') ||
    cat.includes('water_heater') ||
    (cat.includes('water') && cat.includes('heater')) ||
    cat.includes('tankless')
  ) {
    return { slotKey: 'water_heater', registryAssetType: 'water_heater', applianceSubtype: null }
  }
  if (
    cat.includes('hvac') ||
    cat.includes('furnace') ||
    cat.includes('condenser') ||
    cat.includes('air condition') ||
    /\bac\b/.test(cat)
  ) {
    return { slotKey: 'hvac', registryAssetType: 'hvac', applianceSubtype: null }
  }

  const sub = normalizeApplianceSubtype(input.applianceSubtype || input.applianceType)
  return {
    slotKey: `appliance:${sub}`,
    registryAssetType: 'appliance',
    applianceSubtype: sub,
  }
}

function normalizeApplianceSubtype(raw: string | null | undefined): ApplianceSubtype {
  const t = (raw || '').toLowerCase()
  if (t.includes('fridge') || t.includes('refrigerat')) return 'fridge'
  if (t.includes('stove') || t.includes('range') || t.includes('oven') || t.includes('cook')) {
    return 'stove'
  }
  if (t.includes('microwave')) return 'microwave'
  if (t.includes('washer') || t.includes('washing')) return 'washer'
  if (t.includes('dryer')) return 'dryer'
  return 'other'
}

type UnitAssetRow = {
  id: string
  appliance_type: string
  appliance_label: string
  brand: string | null
  model: string | null
  estimated_age_years: number | null
  useful_life_years: number | null
  detection_source: string | null
  last_detected_at: string | null
  updated_at: string | null
  due_at: string | null
  metadata: Record<string, unknown> | null
}

function mapSource(detection: string | null, meta: Record<string, unknown>): AssetRegistrySource | null {
  const fromMeta = meta.source
  if (fromMeta === 'ai_inspection' || fromMeta === 'manual' || fromMeta === 'manual_updated') {
    return fromMeta
  }
  if (detection === 'photo_ai' || detection === 'inspection') return 'ai_inspection'
  if (detection === 'manual_updated') return 'manual_updated'
  if (detection === 'manual') return 'manual'
  return null
}

function mapAgeBasis(meta: Record<string, unknown>, age: number | null): AssetAgeBasis | null {
  const b = meta.ageBasis
  if (b === 'known' || b === 'estimated_from_build_year' || b === 'ai_estimated') return b
  if (typeof meta.ageBasis === 'string' && /serial|nameplate|documented/i.test(meta.ageBasis)) {
    return 'known'
  }
  if (typeof meta.ageBasis === 'string' && /build|year built|property/i.test(meta.ageBasis)) {
    return 'estimated_from_build_year'
  }
  if (typeof meta.ageBasis === 'string' && meta.ageBasis.trim()) return 'ai_estimated'
  return age != null ? 'ai_estimated' : null
}

function rowToPartialItem(row: UnitAssetRow): Partial<AssetRegistryItem> & { slotKey: string } {
  const meta =
    row.metadata && typeof row.metadata === 'object'
      ? (row.metadata as Record<string, unknown>)
      : {}
  const slot = resolveRegistrySlot({
    category: typeof meta.category === 'string' ? meta.category : null,
    applianceType: row.appliance_type,
    applianceSubtype: typeof meta.applianceSubtype === 'string' ? meta.applianceSubtype : null,
    registryAssetType:
      typeof meta.registryAssetType === 'string' ? meta.registryAssetType : null,
  })

  const age =
    row.estimated_age_years != null && Number(row.estimated_age_years) > 0
      ? Number(row.estimated_age_years)
      : null
  const lastServiceDate =
    typeof meta.lastServiceDate === 'string' ? meta.lastServiceDate : null
  const lastInspectionDate =
    typeof meta.lastInspectionDate === 'string' ? meta.lastInspectionDate : null
  const capacityAmps =
    typeof meta.capacityAmps === 'number'
      ? meta.capacityAmps
      : typeof meta.capacityAmps === 'string' && meta.capacityAmps.trim()
        ? Number(meta.capacityAmps)
        : null
  const waterHeaterType =
    typeof meta.waterHeaterType === 'string'
      ? meta.waterHeaterType
      : typeof meta.type === 'string' && slot.registryAssetType === 'water_heater'
        ? meta.type
        : ''
  const roofMaterial =
    typeof meta.roofMaterial === 'string'
      ? meta.roofMaterial
      : typeof meta.material === 'string'
        ? meta.material
        : ''
  const fuelRaw = typeof meta.fuelType === 'string' ? meta.fuelType.toLowerCase() : ''
  const fuelType: BoilerFuelType | '' =
    fuelRaw === 'gas' ||
    fuelRaw === 'oil' ||
    fuelRaw === 'electric' ||
    fuelRaw === 'propane' ||
    fuelRaw === 'unknown'
      ? fuelRaw
      : ''
  const btuOutput =
    typeof meta.btuOutput === 'number'
      ? meta.btuOutput
      : typeof meta.btuOutput === 'string' && meta.btuOutput.trim()
        ? Number(meta.btuOutput)
        : null
  const lastPressureTest =
    typeof meta.lastPressureTest === 'string' ? meta.lastPressureTest : null

  const detail =
    slot.registryAssetType === 'water_heater'
      ? waterHeaterType
      : slot.registryAssetType === 'boiler'
        ? [fuelType, btuOutput != null && Number.isFinite(btuOutput) ? `${btuOutput} BTU` : '']
            .filter(Boolean)
            .join(' · ')
        : slot.registryAssetType === 'roof'
          ? roofMaterial
          : slot.registryAssetType === 'electrical_panel' && capacityAmps != null
            ? `${capacityAmps}A`
            : row.model?.trim() || ''

  const conflicts = Array.isArray(meta.fieldConflicts)
    ? (meta.fieldConflicts as Array<{ field?: string; manualValue?: string; aiValue?: string }>)
        .filter((c) => c && typeof c === 'object')
        .map((c) => ({
          field: String(c.field || 'field'),
          manualValue: String(c.manualValue || ''),
          aiValue: String(c.aiValue || ''),
        }))
    : []

  return {
    slotKey: slot.slotKey,
    unitAssetId: row.id,
    registryAssetType: slot.registryAssetType,
    applianceSubtype: slot.applianceSubtype,
    ageYears: age,
    ageBasis: mapAgeBasis(meta, age),
    brand: row.brand?.trim() || '',
    detail,
    modelNumber: row.model?.trim() || '',
    serialNumber:
      typeof meta.serialNumber === 'string' ? meta.serialNumber : '',
    lastServiceDate,
    lastInspectionDate,
    capacityAmps: capacityAmps != null && Number.isFinite(capacityAmps) ? capacityAmps : null,
    waterHeaterType,
    roofMaterial,
    fuelType,
    btuOutput: btuOutput != null && Number.isFinite(btuOutput) ? btuOutput : null,
    lastPressureTest,
    condition:
      typeof meta.conditionSummary === 'string'
        ? meta.conditionSummary
        : typeof meta.conditionRating === 'string'
          ? meta.conditionRating
          : '',
    lastService: formatServiceDisplay(
      lastServiceDate || lastInspectionDate,
      meta.lastServiceOverdue === true,
    ),
    lastServiceOverdue: meta.lastServiceOverdue === true,
    source: mapSource(row.detection_source, meta),
    lastAssessedDate: row.last_detected_at,
    fieldConflicts: conflicts,
  }
}

function mergeRowOntoSlot(slotItem: AssetRegistryItem, row: UnitAssetRow): AssetRegistryItem {
  const partial = rowToPartialItem(row)
  return deriveAssetStatus({
    ...slotItem,
    ...partial,
    id: slotItem.id,
    slotKey: slotItem.slotKey,
    kind: slotItem.kind,
    emoji: slotItem.emoji,
    title: slotItem.title,
    shortTitle: slotItem.shortTitle,
    emptyHint: slotItem.emptyHint,
  })
}

function saveLocalCache(building: string, state: AssetRegistryState): void {
  try {
    window.localStorage.setItem(
      storageKey(building),
      JSON.stringify({
        ...state,
        items: state.items.map(deriveAssetStatus),
        updatedAt: state.updatedAt ?? new Date().toISOString(),
      }),
    )
  } catch {
    // private mode
  }
}

/** Sync localStorage snapshot (legacy / offline). Prefer loadAssetRegistryAsync. */
export function loadAssetRegistry(building: string): AssetRegistryState {
  const defaults = createDefaultAssetRegistry()
  try {
    const raw = window.localStorage.getItem(storageKey(building))
    if (!raw) return defaults
    const parsed = JSON.parse(raw) as AssetRegistryState
    if (!parsed || !Array.isArray(parsed.items)) return defaults
    const bySlot = new Map(
      parsed.items.map((i) => [i.slotKey || i.title, i] as const),
    )
    const items = defaults.items.map((def) => {
      const saved =
        bySlot.get(def.slotKey) ||
        parsed.items.find((i) => i.title === def.title)
      return deriveAssetStatus(
        saved
          ? {
              ...def,
              ...saved,
              id: def.id,
              slotKey: def.slotKey,
              registryAssetType: def.registryAssetType,
              applianceSubtype: def.applianceSubtype,
              kind: def.kind,
              emoji: def.emoji,
              emptyHint: def.emptyHint,
              title: def.title,
              shortTitle: def.shortTitle,
            }
          : def,
      )
    })
    return {
      items,
      updatedAt: parsed.updatedAt ?? null,
      buildYear: parsed.buildYear ?? null,
    }
  } catch {
    return defaults
  }
}

export function saveAssetRegistry(building: string, state: AssetRegistryState): void {
  saveLocalCache(building, state)
}

export function notifyAssetRegistryChanged(building: string): void {
  try {
    window.dispatchEvent(
      new CustomEvent(ASSET_REGISTRY_CHANGED_EVENT, {
        detail: { building: building.trim() },
      }),
    )
  } catch {
    // non-browser
  }
}

export async function loadAssetRegistryAsync(building: string): Promise<AssetRegistryState> {
  const profile = await loadPropertyBuildingProfile(building)
  const buildYear = profile.yearBuilt
  const defaults = createDefaultAssetRegistry(buildYear)
  const landlordId = getActiveLandlordId()

  if (!supabase || !landlordId || !building.trim()) {
    const local = loadAssetRegistry(building)
    return { ...local, buildYear: buildYear ?? local.buildYear }
  }

  const { data, error } = await supabase
    .from('unit_assets')
    .select(
      `id, appliance_type, appliance_label, brand, model, estimated_age_years,
       useful_life_years, detection_source, last_detected_at, updated_at, due_at, metadata`,
    )
    .eq('landlord_id', landlordId)
    .eq('building', building.trim())
    .order('updated_at', { ascending: false })

  if (error) {
    console.error('[asset-registry] load', error.message)
    const local = loadAssetRegistry(building)
    return { ...local, buildYear: buildYear ?? local.buildYear }
  }

  const rows = (data ?? []) as UnitAssetRow[]
  const usedIds = new Set<string>()
  const items = defaults.items.map((slotItem) => {
    const match = rows.find((row) => {
      if (usedIds.has(row.id)) return false
      const mapped = rowToPartialItem(row)
      return mapped.slotKey === slotItem.slotKey
    })
    if (!match) return slotItem
    usedIds.add(match.id)
    return mergeRowOntoSlot(slotItem, match)
  })

  // Extra assets that don't map to catalog chips (e.g. "other" appliances)
  for (const row of rows) {
    if (usedIds.has(row.id)) continue
    const partial = rowToPartialItem(row)
    if (partial.slotKey.startsWith('appliance:') && partial.applianceSubtype === 'other') {
      items.push(
        deriveAssetStatus({
          ...emptyItem(
            {
              slotKey: `extra:${row.id}`,
              registryAssetType: 'appliance',
              applianceSubtype: 'other',
              kind: 'appliance',
              emoji: '✅',
              title: row.appliance_label || row.appliance_type || 'Appliance',
              shortTitle: row.appliance_type || 'Other',
              emptyHint: '',
            },
            items.length,
          ),
          ...partial,
          unitAssetId: row.id,
        }),
      )
    }
  }

  const updatedAt =
    rows.reduce<string | null>((acc, row) => {
      const t = row.updated_at || row.last_detected_at
      if (!t) return acc
      if (!acc || t > acc) return t
      return acc
    }, null) ?? null

  const state: AssetRegistryState = { items, updatedAt, buildYear }
  saveLocalCache(building, state)
  return state
}

export type ManualAssetPatch = {
  ageYears?: number | null
  brand?: string
  detail?: string
  modelNumber?: string
  serialNumber?: string
  lastServiceDate?: string | null
  lastInspectionDate?: string | null
  capacityAmps?: number | null
  waterHeaterType?: string
  roofMaterial?: string
  fuelType?: BoilerFuelType | ''
  btuOutput?: number | null
  lastPressureTest?: string | null
  lastService?: string
  lastServiceOverdue?: boolean
}

function failureFromAge(
  ageYears: number | null,
  lifeYears: number,
): { risk: number; window: string; replace: boolean; urgency: string } {
  const ratio = ageYears != null && lifeYears > 0 ? ageYears / lifeYears : 0.4
  if (ratio >= 1) return { risk: 80, window: '3–6 months', replace: true, urgency: 'soon' }
  if (ratio >= 0.85) return { risk: 55, window: '6–18 months', replace: true, urgency: 'plan' }
  if (ratio >= 0.7) return { risk: 35, window: '1–3 years', replace: false, urgency: 'plan' }
  return { risk: 15, window: '2–5 years', replace: false, urgency: 'monitor' }
}

/** Upsert a catalog slot into unit_assets (+ PM task). */
export async function saveRegistryAsset(
  building: string,
  item: AssetRegistryItem,
  patch: ManualAssetPatch,
): Promise<AssetRegistryItem> {
  const landlordId = getActiveLandlordId()
  const now = new Date().toISOString()
  const profile = await loadPropertyBuildingProfile(building)
  const buildYear = profile.yearBuilt

  let ageYears =
    patch.ageYears !== undefined
      ? patch.ageYears
      : item.ageYears
  let ageBasis: AssetAgeBasis | null =
    patch.ageYears !== undefined
      ? patch.ageYears != null
        ? 'known'
        : null
      : item.ageBasis

  if (ageYears == null && buildYear != null) {
    ageYears = ageYearsFromBuildYear(buildYear)
    ageBasis = 'estimated_from_build_year'
  }

  const brand = (patch.brand !== undefined ? patch.brand : item.brand).trim()
  const modelNumber = (
    patch.modelNumber !== undefined ? patch.modelNumber : item.modelNumber
  ).trim()
  const serialNumber = (
    patch.serialNumber !== undefined ? patch.serialNumber : item.serialNumber
  ).trim()
  const waterHeaterType = (
    patch.waterHeaterType !== undefined ? patch.waterHeaterType : item.waterHeaterType
  ).trim()
  const roofMaterial = (
    patch.roofMaterial !== undefined ? patch.roofMaterial : item.roofMaterial
  ).trim()
  const capacityAmps =
    patch.capacityAmps !== undefined ? patch.capacityAmps : item.capacityAmps
  const fuelType =
    patch.fuelType !== undefined ? patch.fuelType : item.fuelType
  const btuOutput =
    patch.btuOutput !== undefined ? patch.btuOutput : item.btuOutput
  const lastServiceDate = parseDateInput(
    patch.lastServiceDate !== undefined
      ? patch.lastServiceDate
      : item.lastServiceDate,
  )
  const lastInspectionDate = parseDateInput(
    patch.lastInspectionDate !== undefined
      ? patch.lastInspectionDate
      : item.lastInspectionDate,
  )
  const lastPressureTest = parseDateInput(
    patch.lastPressureTest !== undefined
      ? patch.lastPressureTest
      : item.lastPressureTest,
  )
  const lastServiceOverdue =
    patch.lastServiceOverdue ??
    (item.lastServiceOverdue ||
      /\boverdue\b/i.test(patch.lastService || item.lastService))

  const detail =
    item.registryAssetType === 'water_heater'
      ? waterHeaterType
      : item.registryAssetType === 'boiler'
        ? [fuelType, btuOutput != null ? `${btuOutput} BTU` : ''].filter(Boolean).join(' · ')
        : item.registryAssetType === 'roof'
          ? roofMaterial
          : item.registryAssetType === 'electrical_panel' && capacityAmps != null
            ? `${capacityAmps}A`
            : (patch.detail !== undefined ? patch.detail : item.detail).trim() ||
              modelNumber

  const life = usefulLifeForRegistryType(item.registryAssetType)
  const derived = failureFromAge(ageYears, life)
  const priorSource = item.source
  const source: AssetRegistrySource =
    priorSource === 'ai_inspection' || priorSource === 'manual_updated'
      ? 'manual_updated'
      : 'manual'

  const applianceTypeLabel =
    item.registryAssetType === 'appliance'
      ? item.applianceSubtype || item.title
      : item.title

  const metadata: Record<string, unknown> = {
    registryAssetType: item.registryAssetType,
    applianceSubtype: item.applianceSubtype,
    category:
      item.registryAssetType === 'appliance' ? 'appliance' : item.registryAssetType,
    source,
    ageBasis,
    serialNumber: serialNumber || null,
    lastServiceDate,
    lastInspectionDate,
    lastServiceOverdue,
    capacityAmps,
    waterHeaterType: waterHeaterType || null,
    type: waterHeaterType || null,
    roofMaterial: roofMaterial || null,
    material: roofMaterial || null,
    fuelType: fuelType || null,
    btuOutput,
    lastPressureTest,
    fieldProvenance: {
      age: patch.ageYears !== undefined ? 'manual' : item.ageBasis === 'known' ? 'manual' : ageBasis,
      brand: patch.brand !== undefined ? 'manual' : undefined,
      lastServiceDate: patch.lastServiceDate !== undefined ? 'manual' : undefined,
      lastInspectionDate: patch.lastInspectionDate !== undefined ? 'manual' : undefined,
      fuelType: patch.fuelType !== undefined ? 'manual' : undefined,
    },
    lastUpdatedBy: 'manual_registry',
    lastUpdatedAt: now,
    fieldConflicts: item.fieldConflicts,
  }

  const label = [brand, applianceTypeLabel].filter(Boolean).join(' ').slice(0, 160) ||
    applianceTypeLabel

  const anchorDate =
    lastServiceDate || lastInspectionDate || now.slice(0, 10)
  const dueAt = addMonthsIso(
    anchorDate.length === 10 ? `${anchorDate}T12:00:00.000Z` : anchorDate,
    serviceIntervalMonths(item.registryAssetType),
  )

  const payload = {
    landlord_id: landlordId,
    building: building.trim(),
    appliance_type: String(applianceTypeLabel).slice(0, 120),
    appliance_label: label,
    brand: brand || null,
    model: modelNumber || detail || null,
    estimated_age_years: ageYears != null && ageYears >= 0 ? ageYears : 0,
    useful_life_years: life,
    failure_risk_pct: derived.risk,
    failure_prediction_window: derived.window,
    replacement_recommended: derived.replace,
    replacement_urgency: derived.urgency,
    detection_source: source === 'manual_updated' ? 'manual_updated' : 'manual',
    detection_confidence: ageBasis === 'known' ? 0.95 : ageBasis === 'ai_estimated' ? 0.5 : 0.4,
    last_detected_at: item.lastAssessedDate || now,
    due_at: dueAt,
    task_kind:
      item.registryAssetType === 'roof' || item.registryAssetType === 'hvac'
        ? 'inspection'
        : item.registryAssetType === 'appliance'
          ? 'appliance'
          : 'service',
    metadata,
    updated_at: now,
  }

  const nextItemBase: AssetRegistryItem = deriveAssetStatus({
    ...item,
    ageYears,
    ageBasis,
    brand,
    detail,
    modelNumber,
    serialNumber,
    lastServiceDate,
    lastInspectionDate,
    capacityAmps,
    waterHeaterType,
    roofMaterial,
    fuelType,
    btuOutput,
    lastPressureTest,
    lastService: formatServiceDisplay(
      lastServiceDate || lastInspectionDate || lastPressureTest,
      lastServiceOverdue,
    ),
    lastServiceOverdue,
    source,
  })

  if (!supabase || !landlordId) {
    const localNext = nextItemBase
    notifyAssetRegistryChanged(building)
    return localNext
  }

  let unitAssetId = item.unitAssetId
  if (unitAssetId) {
    // Merge: load existing metadata so we don't wipe AI deficiencies
    const { data: existing } = await supabase
      .from('unit_assets')
      .select('metadata, detection_source')
      .eq('id', unitAssetId)
      .maybeSingle()
    const prevMeta =
      existing?.metadata && typeof existing.metadata === 'object'
        ? (existing.metadata as Record<string, unknown>)
        : {}
    const mergedMeta = {
      ...prevMeta,
      ...metadata,
      deficiencies: prevMeta.deficiencies,
      maintenanceRecommendations: prevMeta.maintenanceRecommendations,
      fieldConflicts: prevMeta.fieldConflicts ?? metadata.fieldConflicts,
    }
    const { error } = await supabase
      .from('unit_assets')
      .update({ ...payload, metadata: mergedMeta })
      .eq('id', unitAssetId)
    if (error) throw new Error(getErrorMessage(error, 'Something went wrong. Please try again.'))
  } else {
    const { data, error } = await supabase
      .from('unit_assets')
      .insert(payload)
      .select('id')
      .single()
    if (error || !data?.id) throw new Error(error?.message ?? 'Failed to create asset')
    unitAssetId = String(data.id)
  }

  // Ensure a PM task exists for compliance
  const { data: existingTasks } = await supabase
    .from('preventive_maintenance_tasks')
    .select('id, status')
    .eq('landlord_id', landlordId)
    .eq('unit_asset_id', unitAssetId)
    .neq('status', 'cancelled')
    .limit(1)

  const taskTitle =
    item.registryAssetType === 'hvac'
      ? `Service ${label || 'HVAC'}`
      : item.registryAssetType === 'roof' || item.registryAssetType === 'electrical_panel'
        ? `Inspect ${label || item.title}`
        : `Maintain ${label || item.title}`

  if (!existingTasks?.length) {
    await supabase.from('preventive_maintenance_tasks').insert({
      landlord_id: landlordId,
      unit_asset_id: unitAssetId,
      title: taskTitle.slice(0, 200),
      task_kind: payload.task_kind,
      due_at: dueAt,
      status: 'scheduled',
      building: building.trim(),
      metadata: {
        source: 'manual_registry',
        registryAssetType: item.registryAssetType,
        suggestedIntervalMonths: serviceIntervalMonths(item.registryAssetType),
      },
    })
  } else if (lastServiceDate || lastInspectionDate) {
    await supabase
      .from('preventive_maintenance_tasks')
      .update({ due_at: dueAt, updated_at: now })
      .eq('id', existingTasks[0].id)
      .neq('status', 'completed')
  }

  const { recordActivityLog } = await import('@/lib/recordActivityLog')
  await recordActivityLog({
    landlordId,
    eventType: 'asset.registry_upserted',
    source: 'dashboard',
    actorType: 'landlord',
    metadata: {
      building: building.trim(),
      unit_asset_id: unitAssetId,
      registry_asset_type: item.registryAssetType,
      asset_source: source,
      age_basis: ageBasis,
      message: `${item.title} updated in asset registry`,
    },
  })

  const saved = deriveAssetStatus({
    ...nextItemBase,
    unitAssetId,
  })
  notifyAssetRegistryChanged(building)
  return saved
}
