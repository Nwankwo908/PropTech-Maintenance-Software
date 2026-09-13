import { supabase } from '@/lib/supabase'
import { normalizeUnitLabel } from '@/lib/propertyHealth'
import {
  calendarEventsFromScheduledTickets,
  type ResidentCalendarEvent,
  type ResidentScheduledTicket,
} from '@/lib/residentLeaseCalendar'
import type { SmartIntelligenceTicket } from '@/lib/smartIntelligence/types'

function namesMatch(left: string, right: string): boolean {
  const a = left.trim().toLowerCase().replace(/\s+/g, ' ')
  const b = right.trim().toLowerCase().replace(/\s+/g, ' ')
  if (!a || !b) return false
  return a === b || a.includes(b) || b.includes(a)
}

function ticketBelongsToResident(
  row: Record<string, unknown>,
  params: { residentId: string; residentName: string; unitKey: string },
): boolean {
  const userId = typeof row.resident_user_id === 'string' ? row.resident_user_id.trim() : ''
  const ticketUnit = normalizeUnitLabel(typeof row.unit === 'string' ? row.unit : '')
  const ticketName = typeof row.resident_name === 'string' ? row.resident_name : ''
  return (
    (params.residentId && userId === params.residentId) ||
    (params.unitKey && ticketUnit === params.unitKey) ||
    (Boolean(params.residentName) &&
      namesMatch(ticketName, params.residentName) &&
      (!params.unitKey || !ticketUnit || ticketUnit === params.unitKey))
  )
}

export async function fetchResidentMaintenanceCalendarEvents(params: {
  landlordId: string
  residentId: string
  residentName?: string | null
  unitLabel?: string | null
}): Promise<ResidentCalendarEvent[]> {
  if (!supabase) return []
  const landlordId = params.landlordId.trim()
  if (!landlordId) return []

  const { data, error } = await supabase
    .from('maintenance_requests')
    .select(
      'id, scheduled_at, schedule_confirmed_at, unit, resident_user_id, resident_name, vendor_work_status',
    )
    .eq('landlord_id', landlordId)
    .not('scheduled_at', 'is', null)
    .limit(200)

  if (error) {
    console.warn('[resident-calendar] scheduled visits', error.message)
    return []
  }

  const match = {
    unitKey: normalizeUnitLabel(params.unitLabel ?? ''),
    residentId: params.residentId.trim(),
    residentName: params.residentName?.trim() ?? '',
  }

  const tickets: ResidentScheduledTicket[] = []
  for (const row of data ?? []) {
    const record = row as Record<string, unknown>
    const ticketId = typeof record.id === 'string' ? record.id : ''
    if (!ticketId) continue
    if (!ticketBelongsToResident(record, match)) continue
    tickets.push({
      id: ticketId,
      scheduledAt: typeof record.scheduled_at === 'string' ? record.scheduled_at : null,
      scheduleConfirmedAt:
        typeof record.schedule_confirmed_at === 'string' ? record.schedule_confirmed_at : null,
      vendorWorkStatus:
        typeof record.vendor_work_status === 'string' ? record.vendor_work_status : null,
    })
  }

  return calendarEventsFromScheduledTickets(tickets)
}

export async function fetchResidentOpenMaintenanceTickets(params: {
  landlordId: string
  residentId: string
  residentName?: string | null
  unitLabel?: string | null
}): Promise<SmartIntelligenceTicket[]> {
  if (!supabase) return []
  const landlordId = params.landlordId.trim()
  if (!landlordId) return []

  const { data, error } = await supabase
    .from('maintenance_requests')
    .select(
      'id, description, issue_category, vendor_work_status, assigned_vendor_id, assigned_at, urgency, severity, priority, scheduled_at, due_at, created_at, unit, resident_user_id, resident_name',
    )
    .eq('landlord_id', landlordId)
    .limit(200)

  if (error) {
    console.warn('[resident-intelligence] open tickets', error.message)
    return []
  }

  const match = {
    unitKey: normalizeUnitLabel(params.unitLabel ?? ''),
    residentId: params.residentId.trim(),
    residentName: params.residentName?.trim() ?? '',
  }

  const tickets: SmartIntelligenceTicket[] = []
  for (const row of data ?? []) {
    const record = row as Record<string, unknown>
    const ticketId = typeof record.id === 'string' ? record.id : ''
    if (!ticketId) continue
    if (!ticketBelongsToResident(record, match)) continue
    const status = typeof record.vendor_work_status === 'string' ? record.vendor_work_status : ''
    tickets.push({
      id: ticketId,
      description: typeof record.description === 'string' ? record.description : null,
      issueCategory: typeof record.issue_category === 'string' ? record.issue_category : null,
      vendorWorkStatus: status,
      assignedVendorId:
        typeof record.assigned_vendor_id === 'string' ? record.assigned_vendor_id : null,
      assignedAt: typeof record.assigned_at === 'string' ? record.assigned_at : null,
      urgency: typeof record.urgency === 'string' ? record.urgency : null,
      severity: typeof record.severity === 'string' ? record.severity : null,
      priority: typeof record.priority === 'string' ? record.priority : null,
      scheduledAt: typeof record.scheduled_at === 'string' ? record.scheduled_at : null,
      dueAt: typeof record.due_at === 'string' ? record.due_at : null,
      createdAt: typeof record.created_at === 'string' ? record.created_at : null,
    })
  }
  return tickets
}
