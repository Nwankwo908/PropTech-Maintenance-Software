/**
 * Pure helpers: detect ticket/conversation unit_id that disagrees with the
 * resident's occupancy (WO-C2C7 class of write-time corruption).
 *
 * Used by the daily cron and by scripts/audit-ticket-unit-fk-mismatches.mjs
 * (logic mirrored for the heal path).
 */

export type TicketUnitFkUnit = {
  id: string
  unit_label?: string | null
  building?: string | null
  property_id?: string | null
}

export type TicketUnitFkResident = {
  id: string
  full_name?: string | null
  unit?: string | null
  building?: string | null
  email?: string | null
}

export type TicketUnitFkTicket = {
  id: string
  unit?: string | null
  unit_id?: string | null
  property_id?: string | null
  email?: string | null
  description?: string | null
  vendor_work_status?: string | null
  resident_user_id?: string | null
}

export type TicketUnitFkRun = {
  id: string
  entity_id: string
  property_id?: string | null
  unit_id?: string | null
  resident_id?: string | null
}

export type TicketUnitFkConvo = {
  id: string
  resident_id: string
  unit_id: string
  maintenance_request_id?: string | null
}

export type TicketUnitFkMismatch = {
  ticketId: string
  residentId: string
  residentName: string | null
  reasons: string[]
  expectedUnitIds: string[]
}

export type ConversationUnitFkMismatch = {
  conversationId: string
  residentId: string
  residentName: string | null
  expectedUnitId: string
  reasons: string[]
}

function expectedUnitsForResident(input: {
  resident: TicketUnitFkResident
  occupancyByResident: Map<string, string[]>
  units: TicketUnitFkUnit[]
}): string[] {
  const ids = new Set(input.occupancyByResident.get(input.resident.id) ?? [])
  for (const unit of input.units) {
    if (
      String(unit.unit_label ?? '').trim() === String(input.resident.unit ?? '').trim() &&
      String(unit.building ?? '').trim().toLowerCase() ===
        String(input.resident.building ?? '').trim().toLowerCase()
    ) {
      ids.add(unit.id)
    }
  }
  return [...ids]
}

export function findTicketUnitFkMismatches(input: {
  units: TicketUnitFkUnit[]
  residents: TicketUnitFkResident[]
  occupancy: Array<{ resident_id: string; unit_id: string }>
  tickets: TicketUnitFkTicket[]
  runs: TicketUnitFkRun[]
}): TicketUnitFkMismatch[] {
  const unitById = new Map(input.units.map((u) => [u.id, u]))
  const residentById = new Map(input.residents.map((r) => [r.id, r]))
  const residentByEmail = new Map(
    input.residents
      .filter((r) => r.email)
      .map((r) => [String(r.email).toLowerCase(), r]),
  )
  const occByResident = new Map<string, string[]>()
  for (const row of input.occupancy) {
    const list = occByResident.get(row.resident_id) ?? []
    list.push(row.unit_id)
    occByResident.set(row.resident_id, list)
  }
  const runByTicket = new Map(input.runs.map((r) => [r.entity_id, r]))

  const mismatches: TicketUnitFkMismatch[] = []
  for (const ticket of input.tickets) {
    const run = runByTicket.get(ticket.id)
    let resident: TicketUnitFkResident | undefined
    if (run?.resident_id && residentById.get(run.resident_id)) {
      resident = residentById.get(run.resident_id)
    } else if (ticket.resident_user_id && residentById.get(ticket.resident_user_id)) {
      resident = residentById.get(ticket.resident_user_id)
    } else if (ticket.email && residentByEmail.get(String(ticket.email).toLowerCase())) {
      resident = residentByEmail.get(String(ticket.email).toLowerCase())
    }
    if (!resident) continue

    const expected = expectedUnitsForResident({
      resident,
      occupancyByResident: occByResident,
      units: input.units,
    })
    if (!expected.length) continue

    const reasons: string[] = []
    if (ticket.unit_id && !expected.includes(ticket.unit_id)) {
      reasons.push('ticket.unit_id not resident occupancy/roster unit')
    }
    const expectedProps = new Set(
      expected.map((id) => unitById.get(id)?.property_id).filter(Boolean),
    )
    if (ticket.property_id && expectedProps.size && !expectedProps.has(ticket.property_id)) {
      reasons.push('ticket.property_id not resident property')
    }
    if (run?.unit_id && !expected.includes(run.unit_id)) {
      reasons.push('run.unit_id not resident occupancy/roster unit')
    }
    if (!reasons.length) continue
    mismatches.push({
      ticketId: ticket.id,
      residentId: resident.id,
      residentName: resident.full_name ?? null,
      reasons,
      expectedUnitIds: expected,
    })
  }
  return mismatches
}

export function findConversationUnitFkMismatches(input: {
  residents: TicketUnitFkResident[]
  occupancy: Array<{ resident_id: string; unit_id: string }>
  conversations: TicketUnitFkConvo[]
}): ConversationUnitFkMismatch[] {
  const residentById = new Map(input.residents.map((r) => [r.id, r]))
  const occByResident = new Map<string, string[]>()
  for (const row of input.occupancy) {
    const list = occByResident.get(row.resident_id) ?? []
    list.push(row.unit_id)
    occByResident.set(row.resident_id, list)
  }

  const mismatches: ConversationUnitFkMismatch[] = []
  for (const convo of input.conversations) {
    const expected = occByResident.get(convo.resident_id) ?? []
    if (!expected.length || expected.includes(convo.unit_id)) continue
    const resident = residentById.get(convo.resident_id)
    mismatches.push({
      conversationId: convo.id,
      residentId: convo.resident_id,
      residentName: resident?.full_name ?? null,
      expectedUnitId: expected[0]!,
      reasons: ['conversation.unit_id not resident occupancy unit'],
    })
  }
  return mismatches
}
