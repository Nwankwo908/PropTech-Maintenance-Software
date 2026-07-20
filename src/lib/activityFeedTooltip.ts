export type ActivityFeedTooltipEvent = {
  eventType: string
  category:
    | 'maintenance'
    | 'rent'
    | 'move_in'
    | 'move_out'
    | 'inspection'
    | 'vendor'
    | 'admin'
  message: string | null
  unitLabel: string | null
  building: string | null
  residentName: string | null
  vendorName: string | null
}

export type FeedTooltipField = {
  label: string
  value: string
}

export type FeedTooltipCopy = {
  title: string
  /** Plain sentence; wrap key details in **double asterisks** for emphasis. */
  summary: string
  fields: FeedTooltipField[]
  actionLabel: string | null
}

export type FeedTooltipDestination =
  | { kind: 'workflow'; runId: string }
  | { kind: 'property'; path: string }

type EventCopyTemplate = {
  title: string
  summary: (ctx: FeedCopyContext) => string
  status?: string
  actionLabel?: string
}

type FeedCopyContext = {
  vendor: string | null
  resident: string | null
  unit: string | null
  building: string | null
  location: string | null
}

function cleanUnitLabel(unitLabel: string | null): string | null {
  const raw = unitLabel?.trim()
  if (!raw) return null
  return raw.replace(/^unit\s+/i, '').trim() || raw
}

function formatLocation(unit: string | null, building: string | null): string | null {
  if (unit && building) return `Unit ${unit}, ${building}`
  if (unit) return `Unit ${unit}`
  if (building) return building
  return null
}

function humanizeEventKey(eventType: string): string {
  const leaf = eventType.includes('.') ? eventType.slice(eventType.lastIndexOf('.') + 1) : eventType
  const words = leaf
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .trim()
    .toLowerCase()
  if (!words) return 'Activity update'
  return words.replace(/\b\w/g, (ch) => ch.toUpperCase())
}

function buildContext(event: ActivityFeedTooltipEvent): FeedCopyContext {
  const unit = cleanUnitLabel(event.unitLabel)
  const building = event.building?.trim() || null
  return {
    vendor: event.vendorName?.trim() || null,
    resident: event.residentName?.trim() || null,
    unit,
    building,
    location: formatLocation(unit, building),
  }
}

const EVENT_COPY: Record<string, EventCopyTemplate> = {
  'vendor.external_assigned': {
    title: 'Outside vendor assigned',
    summary: ({ vendor, location }) =>
      vendor && location
        ? `**${vendor}** was assigned to the work order at **${location}**.`
        : vendor
          ? `**${vendor}** was assigned to a work order.`
          : location
            ? `An outside vendor was assigned to the work order at **${location}**.`
            : 'An outside vendor was assigned to a work order.',
    status: 'Assigned',
    actionLabel: 'Click to view work order',
  },
  'maintenance.sla_auto_reassigned': {
    title: 'Work order reassigned',
    summary: ({ vendor, location }) => {
      const vendorBit = vendor ? ` Ulo assigned it to **${vendor}**.` : ' Ulo assigned it to a backup vendor.'
      const where = location ? ` at **${location}**` : ''
      return `The original vendor did not respond in time${where}.${vendorBit}`
    },
    status: 'Reassigned',
    actionLabel: 'Click to view work order',
  },
  'vendor.declined': {
    title: 'Vendor declined the job',
    summary: ({ vendor, location }) => {
      const who = vendor ? `**${vendor}**` : 'The assigned vendor'
      const where = location ? ` for **${location}**` : ''
      return `${who} declined the work order${where}. Ulo is looking for another available vendor.`
    },
    status: 'Declined',
    actionLabel: 'Click to view work order',
  },
  'vendor.accepted': {
    title: 'Vendor accepted the job',
    summary: ({ vendor, location }) => {
      const who = vendor ? `**${vendor}**` : 'The vendor'
      const where = location ? ` for **${location}**` : ''
      return `${who} accepted the work order${where} and is ready to move forward.`
    },
    status: 'Accepted',
    actionLabel: 'Click to view work order',
  },
  'maintenance.completed': {
    title: 'Repair completed',
    summary: ({ location }) =>
      location
        ? `The work order was marked complete at **${location}**.`
        : 'The work order was marked complete.',
    status: 'Completed',
    actionLabel: 'Click to view work order',
  },
  'maintenance.created': {
    title: 'New maintenance request',
    summary: ({ location }) =>
      location
        ? `A new maintenance request was submitted for **${location}**.`
        : 'A new maintenance request was submitted.',
    status: 'Open',
    actionLabel: 'Click to view work order',
  },
  'rent.late_escalated': {
    title: 'Rent is still overdue',
    summary: ({ resident, location }) => {
      const who = resident ? ` for **${resident}**` : ''
      const where = location ? ` at **${location}**` : ''
      return `The payment${who}${where} passed the grace period and now needs attention.`
    },
    status: 'Needs attention',
    actionLabel: 'Review payment',
  },
  'rent.reminder_sent': {
    title: 'Rent reminder sent',
    summary: ({ resident, location }) => {
      const who = resident ? ` to **${resident}**` : ''
      const where = location ? ` for **${location}**` : ''
      return `Ulo sent a rent reminder${who}${where}.`
    },
    status: 'Reminder sent',
    actionLabel: 'Review payment',
  },
  'lease_renewal.escalated': {
    title: 'Lease renewal needs a decision',
    summary: ({ resident, location }) => {
      const who = resident ? ` for **${resident}**` : ''
      const where = location ? ` at **${location}**` : ''
      return `The lease renewal${who}${where} has not been resolved and now needs review.`
    },
    status: 'Needs review',
    actionLabel: 'Review renewal',
  },
  'inspection.scheduled': {
    title: 'Inspection scheduled',
    summary: ({ location }) =>
      location
        ? `An inspection was scheduled for **${location}**.`
        : 'An inspection was scheduled for the property.',
    status: 'Scheduled',
    actionLabel: 'View workflow',
  },
  'move_in.checklist_sent': {
    title: 'Move-in checklist sent',
    summary: ({ resident, location }) => {
      const who = resident ? ` to **${resident}**` : ''
      const where = location ? ` for **${location}**` : ''
      return `Ulo sent the move-in checklist${who}${where}.`
    },
    status: 'Checklist sent',
    actionLabel: 'View workflow',
  },
  'move_out.started': {
    title: 'Move-out started',
    summary: ({ resident, location }) => {
      const who = resident ? ` for **${resident}**` : ''
      const where = location ? ` at **${location}**` : ''
      return `A move-out workflow${who}${where} is now underway.`
    },
    status: 'In progress',
    actionLabel: 'View workflow',
  },
  'unit.registered': {
    title: 'Unit registered',
    summary: ({ unit, building }) => {
      if (unit && building) return `**Unit ${unit}** was added at **${building}**.`
      if (building) return `A unit was registered at **${building}**.`
      if (unit) return `**Unit ${unit}** was registered in your portfolio.`
      return 'A unit was registered in your portfolio.'
    },
    status: 'Registered',
    actionLabel: 'View property',
  },
  'vendor.insurance_verification_started': {
    title: 'Insurance verification started',
    summary: ({ vendor }) =>
      vendor
        ? `Ulo started verifying insurance documents for **${vendor}**.`
        : 'Ulo started verifying the vendor’s insurance documents.',
    status: 'In review',
    actionLabel: 'View workflow',
  },
}

function fallbackSummary(event: ActivityFeedTooltipEvent, ctx: FeedCopyContext): string {
  if (event.message?.trim()) return event.message.trim()
  const title = humanizeEventKey(event.eventType).toLowerCase()
  if (ctx.location) return `Ulo recorded “${title}” for **${ctx.location}**.`
  if (ctx.vendor) return `Ulo recorded “${title}” for **${ctx.vendor}**.`
  return `Ulo recorded this update: ${title}.`
}

function defaultActionLabel(
  event: ActivityFeedTooltipEvent,
  destination: FeedTooltipDestination | null,
): string | null {
  if (!destination) return null
  if (destination.kind === 'property') return 'View property'
  if (event.eventType.startsWith('rent.')) return 'Review payment'
  if (event.eventType.includes('lease_renewal') || event.eventType.startsWith('lease.')) {
    return 'Review renewal'
  }
  if (
    event.eventType.startsWith('maintenance.') ||
    event.eventType.startsWith('vendor.') ||
    event.category === 'maintenance' ||
    event.category === 'vendor'
  ) {
    return 'Click to view work order'
  }
  return 'View workflow'
}

function buildFields(
  ctx: FeedCopyContext,
  status: string | null,
): FeedTooltipField[] {
  const fields: FeedTooltipField[] = []
  if (ctx.building) fields.push({ label: 'Property', value: ctx.building })
  if (ctx.unit) fields.push({ label: 'Unit', value: ctx.unit })
  if (ctx.vendor) fields.push({ label: 'Vendor', value: ctx.vendor })
  if (ctx.resident) fields.push({ label: 'Resident', value: ctx.resident })
  if (status) fields.push({ label: 'Status', value: status })
  return fields
}

export function buildActivityFeedTooltipCopy(
  event: ActivityFeedTooltipEvent,
  destination: FeedTooltipDestination | null,
): FeedTooltipCopy {
  const ctx = buildContext(event)
  const template = EVENT_COPY[event.eventType]
  const title = template?.title ?? humanizeEventKey(event.eventType)
  const summary = template?.summary(ctx) ?? fallbackSummary(event, ctx)
  const status = template?.status ?? null
  const actionLabel =
    destination == null
      ? null
      : (template?.actionLabel ?? defaultActionLabel(event, destination))

  return {
    title,
    summary,
    fields: buildFields(ctx, status),
    actionLabel,
  }
}

/** Split a summary that uses **bold** markers into text nodes for React. */
export function splitEmphasizedText(text: string): Array<{ text: string; bold: boolean }> {
  const parts: Array<{ text: string; bold: boolean }> = []
  const pattern = /\*\*(.+?)\*\*/g
  let lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = pattern.exec(text)) != null) {
    if (match.index > lastIndex) {
      parts.push({ text: text.slice(lastIndex, match.index), bold: false })
    }
    parts.push({ text: match[1], bold: true })
    lastIndex = match.index + match[0].length
  }
  if (lastIndex < text.length) {
    parts.push({ text: text.slice(lastIndex), bold: false })
  }
  return parts.length ? parts : [{ text, bold: false }]
}
