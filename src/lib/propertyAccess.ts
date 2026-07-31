import { getErrorMessage } from '@/lib/errorMessage'
/**
 * Building-level property access — Property Details + vendor job page.
 */
import { getActiveLandlordId } from '@/lib/activeLandlord'
import { supabase } from '@/lib/supabase'

export type PropertyAccessProfile = {
  buildingEntry: string
  gateCode: string
  lockboxLocation: string
  lockboxCode: string
  utilityRoomAccess: string
  visitorParking: string
  superintendentContact: string
  emergencyAccessNotes: string
  updatedAt: string | null
}

export const EMPTY_PROPERTY_ACCESS: PropertyAccessProfile = {
  buildingEntry: '',
  gateCode: '',
  lockboxLocation: '',
  lockboxCode: '',
  utilityRoomAccess: '',
  visitorParking: '',
  superintendentContact: '',
  emergencyAccessNotes: '',
  updatedAt: null,
}

export function normalizePropertyAccess(raw: unknown): PropertyAccessProfile {
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const str = (...keys: string[]) => {
    for (const key of keys) {
      if (typeof o[key] === 'string') return (o[key] as string).trim()
    }
    return ''
  }
  return {
    buildingEntry: str('buildingEntry', 'building_entry', 'entryNotes'),
    gateCode: str('gateCode', 'gate_code'),
    lockboxLocation: str('lockboxLocation', 'lockbox_location'),
    lockboxCode: str('lockboxCode', 'lockbox_code'),
    utilityRoomAccess: str('utilityRoomAccess', 'utility_room_access'),
    visitorParking: str('visitorParking', 'visitor_parking', 'parkingNotes'),
    superintendentContact: str('superintendentContact', 'superintendent_contact'),
    emergencyAccessNotes: str('emergencyAccessNotes', 'emergency_access_notes'),
    updatedAt:
      typeof o.updatedAt === 'string'
        ? o.updatedAt
        : typeof o.updated_at === 'string'
          ? o.updated_at
          : null,
  }
}

export function propertyAccessHasContent(access: PropertyAccessProfile): boolean {
  return Boolean(
    access.buildingEntry ||
      access.gateCode ||
      access.lockboxLocation ||
      access.lockboxCode ||
      access.utilityRoomAccess ||
      access.visitorParking ||
      access.superintendentContact ||
      access.emergencyAccessNotes,
  )
}

/** Plain-text block for SMS / single accessInstructions field. */
export function formatPropertyAccessPlainText(access: PropertyAccessProfile): string {
  const lines: string[] = []
  const add = (label: string, value: string) => {
    const v = value.trim()
    if (v) lines.push(`${label}: ${v}`)
  }
  add('Building entry', access.buildingEntry)
  add('Gate code', access.gateCode)
  add('Lockbox location', access.lockboxLocation)
  add('Lockbox code', access.lockboxCode)
  add('Utility room', access.utilityRoomAccess)
  add('Visitor parking', access.visitorParking)
  add('Superintendent', access.superintendentContact)
  add('Emergency access', access.emergencyAccessNotes)
  return lines.join('\n')
}

export type PropertyAccessDisplayRow = { label: string; value: string }

export function propertyAccessDisplayRows(
  access: PropertyAccessProfile,
): PropertyAccessDisplayRow[] {
  const rows: PropertyAccessDisplayRow[] = []
  const add = (label: string, value: string) => {
    const v = value.trim()
    if (v) rows.push({ label, value: v })
  }
  add('Building entry instructions', access.buildingEntry)
  add('Gate code', access.gateCode)
  add('Lockbox location', access.lockboxLocation)
  add('Lockbox code', access.lockboxCode)
  add('Utility room access', access.utilityRoomAccess)
  add('Visitor parking', access.visitorParking)
  add('Superintendent contact', access.superintendentContact)
  add('Emergency access notes', access.emergencyAccessNotes)
  return rows
}

function localStorageKey(building: string): string {
  const landlordId = getActiveLandlordId()
  const key = building.trim().toLowerCase().replace(/\s+/g, '-')
  return `ulo.propertyAccess.${landlordId}.${key}`
}

export function loadPropertyAccessLocal(building: string): PropertyAccessProfile {
  try {
    const raw = window.localStorage.getItem(localStorageKey(building))
    if (!raw) return { ...EMPTY_PROPERTY_ACCESS }
    return normalizePropertyAccess(JSON.parse(raw))
  } catch {
    return { ...EMPTY_PROPERTY_ACCESS }
  }
}

export function savePropertyAccessLocal(
  building: string,
  access: PropertyAccessProfile,
): void {
  try {
    window.localStorage.setItem(localStorageKey(building), JSON.stringify(access))
  } catch {
    // private mode
  }
}

/** Load from DB (preferred) with localStorage fallback. */
export async function loadPropertyAccess(building: string): Promise<PropertyAccessProfile> {
  const landlordId = getActiveLandlordId()
  const local = loadPropertyAccessLocal(building)
  if (!supabase || !landlordId || !building.trim()) return local

  const { data, error } = await supabase
    .from('property_access_profiles')
    .select('*')
    .eq('landlord_id', landlordId)
    .eq('building', building.trim())
    .maybeSingle()

  if (error || !data) return local
  const fromDb = normalizePropertyAccess(data)
  savePropertyAccessLocal(building, fromDb)
  return fromDb
}

/** Upsert to DB and mirror to localStorage. */
export async function savePropertyAccess(
  building: string,
  access: PropertyAccessProfile,
): Promise<void> {
  const landlordId = getActiveLandlordId()
  const next = { ...access, updatedAt: new Date().toISOString() }
  savePropertyAccessLocal(building, next)

  if (!supabase || !landlordId || !building.trim()) return

  const { error } = await supabase.from('property_access_profiles').upsert(
    {
      landlord_id: landlordId,
      building: building.trim(),
      building_entry: next.buildingEntry,
      gate_code: next.gateCode,
      lockbox_location: next.lockboxLocation,
      lockbox_code: next.lockboxCode,
      utility_room_access: next.utilityRoomAccess,
      visitor_parking: next.visitorParking,
      superintendent_contact: next.superintendentContact,
      emergency_access_notes: next.emergencyAccessNotes,
      updated_at: next.updatedAt,
    },
    { onConflict: 'landlord_id,building' },
  )

  if (error) {
    console.error('[property-access] save', error.message)
    throw new Error(getErrorMessage(error, 'Something went wrong. Please try again.'))
  }
}
