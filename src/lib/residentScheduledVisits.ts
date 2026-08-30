import { supabase } from '@/lib/supabase'
import { normalizeUnitLabel } from '@/lib/propertyHealth'
import {
  calendarEventsFromScheduledTickets,
  type ResidentCalendarEvent,
  type ResidentScheduledTicket,
} from '@/lib/residentLeaseCalendar'

function namesMatch(left: string, right: string): boolean {
  const a = left.trim().toLowerCase().replace(/\s+/g, ' ')
  const b = right.trim().toLowerCase().replace(/\s+/g, ' ')
  if (!a || !b) return false
  return a === b || a.includes(b) || b.includes(a)
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

  const unitKey = normalizeUnitLabel(params.unitLabel ?? '')
  const residentId = params.residentId.trim()
  const residentName = params.residentName?.trim() ?? ''

  const tickets: ResidentScheduledTicket[] = []
  for (const row of data ?? []) {
    const ticketId = typeof row.id === 'string' ? row.id : ''
    if (!ticketId) continue
    const userId =
      typeof row.resident_user_id === 'string' ? row.resident_user_id.trim() : ''
    const ticketUnit = normalizeUnitLabel(
      typeof row.unit === 'string' ? row.unit : '',
    )
    const ticketName = typeof row.resident_name === 'string' ? row.resident_name : ''
    const belongsToResident =
      (residentId && userId === residentId) ||
      (unitKey && ticketUnit === unitKey) ||
      (residentName && namesMatch(ticketName, residentName) && (!unitKey || !ticketUnit || ticketUnit === unitKey))
    if (!belongsToResident) continue
    tickets.push({
      id: ticketId,
      scheduledAt: typeof row.scheduled_at === 'string' ? row.scheduled_at : null,
      scheduleConfirmedAt:
        typeof row.schedule_confirmed_at === 'string' ? row.schedule_confirmed_at : null,
      vendorWorkStatus:
        typeof row.vendor_work_status === 'string' ? row.vendor_work_status : null,
    })
  }

  return calendarEventsFromScheduledTickets(tickets)
}
