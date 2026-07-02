export type NotificationChannel = 'email' | 'sms' | 'push'

export type NotificationEventChannels = Record<NotificationChannel, boolean>

export type NotificationEvent = {
  id: string
  label: string
  critical?: boolean
  channels: NotificationEventChannels
}

export type NotificationEventCategory = {
  id: string
  title: string
  description: string
  events: NotificationEvent[]
}

export type NotificationDeliveryPreferences = {
  primaryChannel: NotificationChannel
  fallbackChannel: NotificationChannel
  autoFallback: boolean
  pushEnabled: boolean
  quietHoursStart: string
  quietHoursEnd: string
}

export type NotificationSettingsState = {
  delivery: NotificationDeliveryPreferences
  categories: NotificationEventCategory[]
}

const STORAGE_KEY = 'ulo.notificationSettings'

function event(
  id: string,
  label: string,
  channels: Partial<NotificationEventChannels> & { email?: boolean; sms?: boolean; push?: boolean },
  critical = false,
): NotificationEvent {
  return {
    id,
    label,
    critical,
    channels: {
      email: channels.email ?? true,
      sms: channels.sms ?? false,
      push: channels.push ?? false,
    },
  }
}

export const DEFAULT_NOTIFICATION_SETTINGS: NotificationSettingsState = {
  delivery: {
    primaryChannel: 'email',
    fallbackChannel: 'sms',
    autoFallback: true,
    pushEnabled: false,
    quietHoursStart: '10:00 PM',
    quietHoursEnd: '8:00 AM',
  },
  categories: [
    {
      id: 'maintenance',
      title: 'Maintenance',
      description: 'Work orders, emergencies, vendor dispatch, and close-out updates.',
      events: [
        event('new_request', 'New maintenance request', { email: true, sms: true }),
        event('emergency_request', 'Emergency maintenance request', { email: true, sms: true, push: true }, true),
        event('vendor_assigned', 'Vendor assigned', { email: true, sms: false }),
        event('vendor_delayed', 'Vendor delayed response', { email: true, sms: true }),
        event('work_completed', 'Work order completed', { email: true, sms: false }),
        event('sla_overdue', 'SLA overdue', { email: true, sms: true, push: true }, true),
      ],
    },
    {
      id: 'rent',
      title: 'Rent collection',
      description: 'Reminders, payments, delinquency, and escalation events.',
      events: [
        event('rent_reminder', 'Rent reminder sent', { email: true, sms: false }),
        event('payment_received', 'Payment received', { email: true, sms: false }),
        event('overdue_rent', 'Overdue rent', { email: true, sms: true, push: true }, true),
        event('rent_escalated', 'Rent collection escalated', { email: true, sms: true, push: true }, true),
      ],
    },
    {
      id: 'leasing',
      title: 'Leasing',
      description: 'Applications, lease execution, renewals, and move events.',
      events: [
        event('application_submitted', 'Application submitted', { email: true, sms: false }),
        event('lease_signed', 'Lease signed', { email: true, sms: false }),
        event('lease_expiring', 'Lease expiring soon', { email: true, sms: true }),
        event('move_in_scheduled', 'Move-in scheduled', { email: true, sms: false }),
      ],
    },
    {
      id: 'inspections',
      title: 'Inspections',
      description: 'Scheduling, completion, and findings that need review.',
      events: [
        event('inspection_scheduled', 'Inspection scheduled', { email: true, sms: false }),
        event('inspection_completed', 'Inspection completed', { email: true, sms: false }),
        event('inspection_review', 'Inspection requires review', { email: true, sms: true, push: true }, true),
      ],
    },
    {
      id: 'workflows',
      title: 'AI workflows',
      description: 'Automation runs, escalations, failures, and routing exceptions.',
      events: [
        event('workflow_started', 'Workflow started', { email: false, sms: false }),
        event('workflow_escalated', 'Workflow escalated', { email: true, sms: true, push: true }, true),
        event('automation_failed', 'Automation failed', { email: true, sms: true, push: true }, true),
        event('vendor_unassigned', 'Vendor could not be assigned', { email: true, sms: true, push: true }, true),
      ],
    },
    {
      id: 'resident_comms',
      title: 'Resident communications',
      description: 'Resident posts, opt-outs, and document uploads.',
      events: [
        event('resident_posted', 'Resident posted update', { email: true, sms: false }),
        event('resident_opt_out', 'Resident opted out of SMS', { email: true, sms: false }),
        event('resident_uploaded', 'Resident uploaded documents', { email: true, sms: false }),
      ],
    },
    {
      id: 'vendor_comms',
      title: 'Vendor communications',
      description: 'Vendor responses, declines, and completion evidence.',
      events: [
        event('vendor_responded', 'Vendor responded', { email: true, sms: false }),
        event('vendor_declined', 'Vendor declined assignment', { email: true, sms: true }),
        event('vendor_photos', 'Vendor uploaded completion photos', { email: true, sms: false }),
      ],
    },
  ],
}

export const CRITICAL_SAFETY_ALERTS = [
  'Fire or smoke',
  'Gas leak',
  'Flood or active water leak',
  'No heat',
  'Power outage',
  'Security incident',
  'Emergency maintenance request',
] as const

export const DELIVERY_HEALTH = {
  sent7Days: '1,234',
  deliveryRate: '99.4%',
  unsubscribeRate: '0',
}

function cloneDefaults(): NotificationSettingsState {
  return JSON.parse(JSON.stringify(DEFAULT_NOTIFICATION_SETTINGS)) as NotificationSettingsState
}

export function loadNotificationSettings(): NotificationSettingsState {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return cloneDefaults()
    const parsed = JSON.parse(raw) as NotificationSettingsState
    return {
      delivery: { ...DEFAULT_NOTIFICATION_SETTINGS.delivery, ...parsed.delivery },
      categories: parsed.categories?.length ? parsed.categories : cloneDefaults().categories,
    }
  } catch {
    return cloneDefaults()
  }
}

export function saveNotificationSettings(state: NotificationSettingsState): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {
    // private mode
  }
}

export function countCriticalPushEvents(categories: NotificationEventCategory[]): number {
  return categories.reduce(
    (sum, category) =>
      sum +
      category.events.filter((item) => item.critical && item.channels.push).length,
    0,
  )
}

export function muteCategory(
  categories: NotificationEventCategory[],
  categoryId: string,
): NotificationEventCategory[] {
  return categories.map((category) =>
    category.id !== categoryId
      ? category
      : {
          ...category,
          events: category.events.map((item) => ({
            ...item,
            channels: { email: false, sms: false, push: false },
          })),
        },
  )
}

export function updateEventChannel(
  categories: NotificationEventCategory[],
  categoryId: string,
  eventId: string,
  channel: NotificationChannel,
  enabled: boolean,
): NotificationEventCategory[] {
  return categories.map((category) =>
    category.id !== categoryId
      ? category
      : {
          ...category,
          events: category.events.map((item) =>
            item.id !== eventId
              ? item
              : { ...item, channels: { ...item.channels, [channel]: enabled } },
          ),
        },
  )
}
