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
  if (!buildingHint) return matches[0]!.id
  const narrowed = matches.filter((u) => {
    const b = u.building.trim().toLowerCase()
    if (!b) return false
    return (
      b.includes(buildingHint) ||
      buildingHint.includes(b) ||
      buildingHint.split(/\s+/).some((tok) => tok.length >= 3 && b.includes(tok))
    )
  })
  return (narrowed[0] ?? matches[0])!.id
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
