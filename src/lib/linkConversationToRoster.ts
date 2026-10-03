/**
 * Messages inbox: link SMS threads to roster residents by phone when
 * sms_conversations.resident_id / unit_id are missing.
 */
import { inboxPhoneDigits } from '@/lib/communicationInboxKind'

export type RosterResidentForInboxLink = {
  id: string
  name: string
  phone: string
  unit: string
  building: string
}

export type InboxUnitRow = {
  id: string
  label: string
  building: string
}

export function normalizeUnitLabelForMatch(v: string | null | undefined): string {
  let s = (v ?? '').trim().toLowerCase()
  s = s.replace(/#/g, '')
  s = s.replace(/\b(unit|apt|apartment|suite|ste)\b/g, '')
  s = s.replace(/[^a-z0-9]/g, '')
  return s
}

export function resolveUnitIdFromInventory(
  units: InboxUnitRow[],
  unitLabel: string | null | undefined,
  building?: string | null,
): string | null {
  const wanted = normalizeUnitLabelForMatch(unitLabel)
  if (!wanted) return null
  const matches = units.filter((u) => normalizeUnitLabelForMatch(u.label) === wanted)
  if (matches.length === 0) return null
  if (matches.length === 1) return matches[0]!.id
  const buildingHint = (building ?? '').trim().toLowerCase()
  // Fail closed — never pick matches[0] when unit labels like "1" collide.
  if (!buildingHint) return null
  const narrowed = matches.filter((u) => {
    const b = u.building.trim().toLowerCase()
    if (!b) return false
    if (b === buildingHint || b.includes(buildingHint) || buildingHint.includes(b)) return true
    const STREET = new Set([
      'ave',
      'avenue',
      'st',
      'street',
      'rd',
      'road',
      'dr',
      'drive',
      'ln',
      'lane',
      'blvd',
      'ct',
      'court',
      'pl',
      'place',
    ])
    const tokens = buildingHint
      .split(/\s+/)
      .filter((tok) => tok.length >= 3 && !STREET.has(tok))
    return tokens.length > 0 && tokens.every((tok) => b.includes(tok))
  })
  return narrowed.length === 1 ? narrowed[0]!.id : null
}

export function buildResidentByPhoneDigits(
  residents: RosterResidentForInboxLink[],
): Map<string, RosterResidentForInboxLink> {
  const map = new Map<string, RosterResidentForInboxLink>()
  for (const resident of residents) {
    const digits = inboxPhoneDigits(resident.phone)
    if (!digits || map.has(digits)) continue
    map.set(digits, resident)
  }
  return map
}

export type ConversationRosterLink = {
  residentId: string
  unitId: string | null
  name: string
  unitLabel: string
  building: string
}

/**
 * Resolve display + persist fields for a tenant thread missing resident_id.
 */
export function linkConversationToRosterByPhone(input: {
  externalPhone: string
  residentByPhone: Map<string, RosterResidentForInboxLink>
  units: InboxUnitRow[]
}): ConversationRosterLink | null {
  const digits = inboxPhoneDigits(input.externalPhone)
  if (!digits) return null
  const resident = input.residentByPhone.get(digits)
  if (!resident) return null
  const unitId = resolveUnitIdFromInventory(input.units, resident.unit, resident.building)
  return {
    residentId: resident.id,
    unitId,
    name: resident.name,
    unitLabel: resident.unit,
    building: resident.building,
  }
}
