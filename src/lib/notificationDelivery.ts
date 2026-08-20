import type { NotificationChannel, NotificationSettingsState } from '@/lib/notificationSettings'

export type NotificationEventKey =
  | 'maintenance.new_request'
  | 'maintenance.emergency_request'
  | 'maintenance.vendor_assigned'
  | 'maintenance.vendor_delayed'
  | 'maintenance.work_completed'
  | 'maintenance.sla_overdue'
  | 'rent.rent_reminder'
  | 'rent.payment_received'
  | 'rent.overdue_rent'
  | 'rent.rent_escalated'
  | 'leasing.application_submitted'
  | 'leasing.lease_signed'
  | 'leasing.lease_expiring'
  | 'leasing.lease_info_missing'
  | 'leasing.move_in_scheduled'
  | 'inspection.inspection_scheduled'
  | 'inspection.inspection_completed'
  | 'inspection.inspection_review'
  | 'workflow.workflow_started'
  | 'workflow.needs_your_attention'
  | 'workflow.workflow_escalated'
  | 'workflow.automation_failed'
  | 'workflow.vendor_unassigned'
  | 'resident.resident_posted'
  | 'resident.resident_opt_out'
  | 'resident.resident_uploaded'
  | 'vendor.vendor_responded'
  | 'vendor.vendor_declined'
  | 'vendor.vendor_photos'

const CRITICAL_EVENTS = new Set<NotificationEventKey>([
  'maintenance.emergency_request',
  'maintenance.sla_overdue',
  'rent.overdue_rent',
  'rent.rent_escalated',
  'inspection.inspection_review',
  'workflow.needs_your_attention',
  'workflow.workflow_escalated',
  'workflow.automation_failed',
  'workflow.vendor_unassigned',
])

const EVENT_TO_MATRIX: Record<
  NotificationEventKey,
  { categoryId: string; eventId: string }
> = {
  'maintenance.new_request': { categoryId: 'maintenance', eventId: 'new_request' },
  'maintenance.emergency_request': { categoryId: 'maintenance', eventId: 'emergency_request' },
  'maintenance.vendor_assigned': { categoryId: 'maintenance', eventId: 'vendor_assigned' },
  'maintenance.vendor_delayed': { categoryId: 'maintenance', eventId: 'vendor_delayed' },
  'maintenance.work_completed': { categoryId: 'maintenance', eventId: 'work_completed' },
  'maintenance.sla_overdue': { categoryId: 'maintenance', eventId: 'sla_overdue' },
  'rent.rent_reminder': { categoryId: 'rent', eventId: 'rent_reminder' },
  'rent.payment_received': { categoryId: 'rent', eventId: 'payment_received' },
  'rent.overdue_rent': { categoryId: 'rent', eventId: 'overdue_rent' },
  'rent.rent_escalated': { categoryId: 'rent', eventId: 'rent_escalated' },
  'leasing.application_submitted': { categoryId: 'leasing', eventId: 'application_submitted' },
  'leasing.lease_signed': { categoryId: 'leasing', eventId: 'lease_signed' },
  'leasing.lease_expiring': { categoryId: 'leasing', eventId: 'lease_expiring' },
  'leasing.lease_info_missing': { categoryId: 'leasing', eventId: 'lease_info_missing' },
  'leasing.move_in_scheduled': { categoryId: 'leasing', eventId: 'move_in_scheduled' },
  'inspection.inspection_scheduled': { categoryId: 'inspections', eventId: 'inspection_scheduled' },
  'inspection.inspection_completed': { categoryId: 'inspections', eventId: 'inspection_completed' },
  'inspection.inspection_review': { categoryId: 'inspections', eventId: 'inspection_review' },
  'workflow.workflow_started': { categoryId: 'workflows', eventId: 'workflow_started' },
  'workflow.needs_your_attention': { categoryId: 'workflows', eventId: 'needs_your_attention' },
  'workflow.workflow_escalated': { categoryId: 'workflows', eventId: 'workflow_escalated' },
  'workflow.automation_failed': { categoryId: 'workflows', eventId: 'automation_failed' },
  'workflow.vendor_unassigned': { categoryId: 'workflows', eventId: 'vendor_unassigned' },
  'resident.resident_posted': { categoryId: 'resident_comms', eventId: 'resident_posted' },
  'resident.resident_opt_out': { categoryId: 'resident_comms', eventId: 'resident_opt_out' },
  'resident.resident_uploaded': { categoryId: 'resident_comms', eventId: 'resident_uploaded' },
  'vendor.vendor_responded': { categoryId: 'vendor_comms', eventId: 'vendor_responded' },
  'vendor.vendor_declined': { categoryId: 'vendor_comms', eventId: 'vendor_declined' },
  'vendor.vendor_photos': { categoryId: 'vendor_comms', eventId: 'vendor_photos' },
}

export type ResolveNotificationDeliveryInput = {
  settings: NotificationSettingsState
  eventType: NotificationEventKey
  isCritical?: boolean
  now?: Date
  timeZone?: string
}

export type ResolvedNotificationDelivery = {
  allowed: boolean
  channels: NotificationChannel[]
  reason?: string
}

function parseClockToMinutes(label: string): number | null {
  const trimmed = label.trim().toLowerCase()
  const match = trimmed.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/)
  if (!match) return null
  let hours = Number(match[1])
  const minutes = Number(match[2] ?? '0')
  const meridiem = match[3]
  if (meridiem === 'pm' && hours < 12) hours += 12
  if (meridiem === 'am' && hours === 12) hours = 0
  return hours * 60 + minutes
}

/** Returns true when local time is inside quiet-hours window (supports overnight ranges). */
export function isWithinQuietHours(input: {
  now: Date
  timeZone: string
  start: string
  end: string
}): boolean {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: input.timeZone,
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
  })
  const parts = formatter.formatToParts(input.now)
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? '0')
  const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? '0')
  const current = hour * 60 + minute
  const start = parseClockToMinutes(input.start)
  const end = parseClockToMinutes(input.end)
  if (start == null || end == null) return false
  if (start === end) return false
  if (start < end) return current >= start && current < end
  return current >= start || current < end
}

function eventChannelsEnabled(
  settings: NotificationSettingsState,
  eventType: NotificationEventKey,
): Record<NotificationChannel, boolean> | null {
  const mapping = EVENT_TO_MATRIX[eventType]
  const category = settings.categories.find((row) => row.id === mapping.categoryId)
  const event = category?.events.find((row) => row.id === mapping.eventId)
  if (!event) return null
  return event.channels
}

export function resolveNotificationDelivery(
  input: ResolveNotificationDeliveryInput,
): ResolvedNotificationDelivery {
  const critical = input.isCritical === true || CRITICAL_EVENTS.has(input.eventType)
  const eventChannels = eventChannelsEnabled(input.settings, input.eventType)
  if (eventChannels) {
    const anyEnabled = Object.values(eventChannels).some(Boolean)
    if (!anyEnabled && !critical) {
      return { allowed: false, channels: [], reason: 'event_muted' }
    }
  }

  const delivery = input.settings.delivery
  const primary = delivery.primaryChannel
  const fallback = delivery.fallbackChannel
  const channels: NotificationChannel[] = []

  const pushAllowed = false

  const tryChannel = (channel: NotificationChannel) => {
    if (channel === 'push' && !pushAllowed) return
    if (channel === 'push') return
    if (eventChannels && eventChannels[channel] === false) return
    if (!channels.includes(channel)) channels.push(channel)
  }

  tryChannel(primary)
  if (delivery.autoFallback && fallback !== primary) {
    tryChannel(fallback)
  }

  if (channels.length === 0 && critical) {
    if (eventChannels?.email !== false) channels.push('email')
    if (eventChannels?.sms !== false) channels.push('sms')
  }

  if (channels.length === 0) {
    return { allowed: false, channels: [], reason: 'no_channels' }
  }

  const quiet =
    input.timeZone &&
    isWithinQuietHours({
      now: input.now ?? new Date(),
      timeZone: input.timeZone,
      start: delivery.quietHoursStart,
      end: delivery.quietHoursEnd,
    })

  if (quiet && !critical) {
    return { allowed: false, channels: [], reason: 'quiet_hours' }
  }

  return { allowed: true, channels }
}

export function mapAttentionKindToEvent(
  kind: string,
): NotificationEventKey {
  switch (kind) {
    case 'invoice_ready':
      return 'workflow.needs_your_attention'
    case 'assign_vendor':
      return 'workflow.vendor_unassigned'
    case 'workflow_escalated':
      return 'workflow.workflow_escalated'
    case 'late_rent':
      return 'rent.rent_escalated'
    case 'lease_renewal':
      return 'leasing.lease_expiring'
    case 'lease_info_missing':
      return 'leasing.lease_info_missing'
    default:
      return 'workflow.needs_your_attention'
  }
}
