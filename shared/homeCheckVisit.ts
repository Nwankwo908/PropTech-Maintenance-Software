import {
  HOME_CHECK_PHOTOS,
  homeCheckCaptureSms,
  homeCheckSlotName,
  nextHomeCheckSlot,
  type HomeCheckSlot,
} from './homeCheck.ts'

/** Landlord-facing Home Check status, in order. */
export const HOME_CHECK_LANDLORD_STATUSES = [
  'Awaiting vendor acceptance',
  'Scheduling visit',
  'Visit scheduled',
  'Home Check in progress',
  'Completed',
] as const

export type HomeCheckLandlordStatus = (typeof HOME_CHECK_LANDLORD_STATUSES)[number]

export type HomeCheckVisitPhase =
  | 'awaiting_acceptance'
  | 'scheduling'
  | 'scheduled'
  | 'in_progress'
  | 'declined'

export type HomeCheckVisitAwaiting = 'vendor_window' | 'tenant_confirm' | 'vendor_confirm'

export type HomeCheckVisit = {
  phase: HomeCheckVisitPhase
  inviteSentAt?: string | null
  acceptedAt?: string | null
  declinedAt?: string | null
  proposedWindow?: string | null
  proposedBy?: 'vendor' | 'tenant' | null
  awaiting?: HomeCheckVisitAwaiting | null
  confirmedWindow?: string | null
  confirmedAt?: string | null
  /** When photo instructions may be sent. */
  visitAt?: string | null
  detailsSentAt?: string | null
  photoPromptSentAt?: string | null
  tenantPhone?: string | null
  tenantReady?: boolean | null
  lastReplyId?: string | null
}

export type HomeCheckVisitMessage = {
  to: 'vendor' | 'tenant' | 'landlord'
  body: string
}

export type HomeCheckVisitEvent =
  | { type: 'vendor_yes'; at: string; replyId: string; tenantReady: boolean }
  | { type: 'vendor_no'; at: string; replyId: string }
  | { type: 'vendor_window'; at: string; replyId: string; window: string; visitAt: string }
  | { type: 'vendor_unparsed'; replyId: string }
  | { type: 'tenant_yes'; at: string; replyId: string }
  | { type: 'tenant_no'; at: string; replyId: string }
  | { type: 'tenant_window'; at: string; replyId: string; window: string; visitAt: string }
  | { type: 'visit_due'; at: string }

export function homeCheckVendorAcceptanceSms(location: string): string {
  const place = location.trim() || 'this property'
  return [
    `Hi, this is Ulo. Can you complete a Home Check at ${place}?`,
    'The visit involves taking 4 equipment photos. No repairs or hands-on equipment work are authorized.',
    'Reply YES to accept or NO to decline. If you accept, we’ll coordinate a visit time with the tenant and confirm it with you. You’ll receive photo instructions by text when it’s time for the visit.',
  ].join('\n\n')
}

export function readHomeCheckVisit(value: unknown): HomeCheckVisit | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const phase = (value as { phase?: unknown }).phase
  if (
    phase !== 'awaiting_acceptance' &&
    phase !== 'scheduling' &&
    phase !== 'scheduled' &&
    phase !== 'in_progress' &&
    phase !== 'declined'
  ) {
    return null
  }
  return value as HomeCheckVisit
}

export function homeCheckAcceptanceAlreadySent(visit: HomeCheckVisit | null): boolean {
  return Boolean(visit?.inviteSentAt)
}

/** Short YES/NO or a day-and-time reply. Ordinary repair texts stay out of this flow. */
export function mightBeHomeCheckVisitReply(body: string): boolean {
  const text = body.trim()
  if (!text || text.length > 160) return false
  if (/^(?:yes|no)\b/i.test(text)) return true
  if (text.split(/\s+/).length > 12) return false
  return /\b(?:mon|tue|wed|thu|fri|sat|sun)(?:day|sday|nesday|rsday|urday)?\b|\b(?:today|tomorrow)\b|\b\d{1,2}(?::\d{2})?\s*(?:am|pm)\b/i.test(text)
}

export function homeCheckVisitAllowsPhotos(visit: HomeCheckVisit | null): boolean {
  if (!visit) return true
  return visit.phase === 'in_progress'
}

export function homeCheckVisitPhotoDue(visit: HomeCheckVisit | null, nowMs: number): boolean {
  if (!visit || visit.phase !== 'scheduled' || visit.photoPromptSentAt) return false
  const at = Date.parse(visit.visitAt || '')
  return Number.isFinite(at) && at <= nowMs
}

export function homeCheckWorkflowStep(phase: HomeCheckVisitPhase): string {
  switch (phase) {
    case 'awaiting_acceptance':
      return 'awaiting_vendor_acceptance'
    case 'scheduling':
      return 'scheduling_visit'
    case 'scheduled':
      return 'visit_scheduled'
    case 'in_progress':
      return 'home_check_in_progress'
    case 'declined':
      return 'vendor_declined'
  }
}

export function homeCheckLandlordStatus(
  step: string | null | undefined,
  runStatus?: string | null,
): HomeCheckLandlordStatus {
  const normalized = (step ?? '').trim().toLowerCase()
  if (
    runStatus === 'completed' ||
    normalized === 'completed' ||
    normalized === 'four_photos_received'
  ) {
    return 'Completed'
  }
  if (normalized === 'awaiting_vendor_acceptance') return 'Awaiting vendor acceptance'
  if (normalized === 'scheduling_visit') return 'Scheduling visit'
  if (normalized === 'visit_scheduled') return 'Visit scheduled'
  return 'Home Check in progress'
}

/** First text after the visit time, then one acknowledgement per saved photo. */
export function homeCheckVisitPhotoSms(input: {
  location: string
  company: string
  savedSlot?: HomeCheckSlot | null
  filled: readonly string[]
}): string {
  if (!input.savedSlot) {
    const next = nextHomeCheckSlot(input.filled) ?? HOME_CHECK_PHOTOS[0].slot
    return homeCheckCaptureSms({
      role: 'contractor',
      location: input.location,
      company: input.company,
      reference: '',
      nextPhoto: next,
    })
  }
  const saved = `Saved as ${homeCheckSlotName(input.savedSlot)} for ${input.location}.`
  const next = nextHomeCheckSlot([...input.filled, input.savedSlot])
  return next
    ? `${saved} Next, send a photo of ${homeCheckSlotName(next)}.`
    : `${saved} All four photos are in. Any leaks, unusual noises or smells? Reply NONE, YES + details, or UNSURE.`
}

function unchanged(visit: HomeCheckVisit): { visit: HomeCheckVisit; messages: HomeCheckVisitMessage[]; close: boolean } {
  return { visit, messages: [], close: false }
}

function availabilityAsk(): string {
  return [
    'Thank you. What’s your earliest availability?',
    'Reply with a day and arrival window (e.g. Wed 9am–12pm) or an exact time (e.g. Wed at 10am).',
    'We’ll confirm that time with the tenant before you go.',
  ].join('\n\n')
}

function visitDetails(location: string, window: string): string {
  return [
    `The Home Check at ${location} is set for ${window}.`,
    'Photos only. No repairs or hands-on equipment work are authorized.',
    'Photo instructions will arrive by text when it’s time for the visit.',
  ].join('\n\n')
}

function confirmBoth(
  visit: HomeCheckVisit,
  input: { at: string; replyId: string; location: string; window: string; visitAt: string },
): { visit: HomeCheckVisit; messages: HomeCheckVisitMessage[]; close: boolean } {
  const next: HomeCheckVisit = {
    ...visit,
    phase: 'scheduled',
    awaiting: null,
    proposedWindow: input.window,
    confirmedWindow: input.window,
    confirmedAt: input.at,
    visitAt: input.visitAt,
    detailsSentAt: input.at,
    lastReplyId: input.replyId,
  }
  const details = visitDetails(input.location, input.window)
  return {
    visit: next,
    close: false,
    messages: [
      { to: 'vendor', body: details },
      { to: 'tenant', body: details },
    ],
  }
}

export function reduceHomeCheckVisit(input: {
  visit: HomeCheckVisit
  event: HomeCheckVisitEvent
  location: string
  vendorName: string
}): { visit: HomeCheckVisit; messages: HomeCheckVisitMessage[]; close: boolean } {
  const { visit, event, location } = input
  const vendorName = input.vendorName.trim() || 'The vendor'
  if ('replyId' in event && event.replyId && event.replyId === visit.lastReplyId) {
    return unchanged(visit)
  }

  if (visit.phase === 'awaiting_acceptance') {
    if (event.type === 'vendor_yes') {
      const next: HomeCheckVisit = {
        ...visit,
        phase: 'scheduling',
        acceptedAt: event.at,
        awaiting: 'vendor_window',
        tenantReady: event.tenantReady,
        lastReplyId: event.replyId,
      }
      const messages: HomeCheckVisitMessage[] = [{ to: 'vendor', body: availabilityAsk() }]
      if (!event.tenantReady) {
        messages.push({
          to: 'landlord',
          body: `The vendor accepted the Home Check at ${location}, but this property needs one tenant with a phone number before a visit time can be confirmed.`,
        })
      }
      return { visit: next, messages, close: false }
    }
    if (event.type === 'vendor_no') {
      return {
        visit: {
          ...visit,
          phase: 'declined',
          declinedAt: event.at,
          awaiting: null,
          lastReplyId: event.replyId,
        },
        close: true,
        messages: [
          {
            to: 'vendor',
            body: 'Thanks for letting us know. We’ll ask the property team to choose someone else.',
          },
          {
            to: 'landlord',
            body: `${vendorName} can’t take the Home Check at ${location}. Choose another vendor from the property page when you’re ready.`,
          },
        ],
      }
    }
    return unchanged(visit)
  }

  if (visit.phase !== 'scheduling') return unchanged(visit)

  if (event.type === 'vendor_window' && visit.awaiting === 'vendor_window') {
    if (!visit.tenantReady) {
      return {
        visit: { ...visit, proposedWindow: event.window, proposedBy: 'vendor', lastReplyId: event.replyId },
        close: false,
        messages: [
          {
            to: 'vendor',
            body: `Thanks. We still need one tenant phone number at ${location} before that time can be confirmed.`,
          },
          {
            to: 'landlord',
            body: `${vendorName} can do ${event.window} for the Home Check at ${location}. Add one tenant phone number so Ulo can confirm that time.`,
          },
        ],
      }
    }
    return {
      visit: {
        ...visit,
        proposedWindow: event.window,
        proposedBy: 'vendor',
        visitAt: event.visitAt,
        awaiting: 'tenant_confirm',
        lastReplyId: event.replyId,
      },
      close: false,
      messages: [
        {
          to: 'vendor',
          body: `Thanks. We’re asking the tenant if ${event.window} works.`,
        },
        {
          to: 'tenant',
          body: [
            `Hi, this is Ulo.`,
            `${vendorName} can complete a Home Check at ${location} on ${event.window}. The visit is four equipment photos. No repairs are authorized.`,
            'Reply YES if that time works, or NO if it does not.',
          ].join('\n\n'),
        },
      ],
    }
  }

  if (event.type === 'vendor_unparsed' && (visit.awaiting === 'vendor_window' || visit.awaiting === 'vendor_confirm')) {
    return {
      visit: { ...visit, lastReplyId: event.replyId },
      close: false,
      messages: [{
        to: 'vendor',
        body: 'Reply with a day and arrival window (e.g. Wed 9am–12pm) or an exact time (e.g. Wed at 10am).',
      }],
    }
  }

  if (event.type === 'tenant_yes' && visit.awaiting === 'tenant_confirm' && visit.proposedWindow && visit.visitAt) {
    return confirmBoth(visit, {
      at: event.at,
      replyId: event.replyId,
      location,
      window: visit.proposedWindow,
      visitAt: visit.visitAt,
    })
  }

  if (event.type === 'tenant_no' && visit.awaiting === 'tenant_confirm') {
    return {
      visit: {
        ...visit,
        awaiting: 'vendor_window',
        proposedWindow: null,
        visitAt: null,
        lastReplyId: event.replyId,
      },
      close: false,
      messages: [
        {
          to: 'tenant',
          body: [
            'Thanks for letting us know.',
            'What day and arrival window works for you?',
            'Reply with a day and time (e.g. Thu 1pm–4pm).',
          ].join('\n\n'),
        },
        {
          to: 'vendor',
          body: `The tenant can’t do ${visit.proposedWindow || 'that time'}. We’ll ask for another time and confirm it with you.`,
        },
      ],
    }
  }

  if (event.type === 'tenant_window' && (visit.awaiting === 'vendor_window' || visit.awaiting === 'tenant_confirm')) {
    return {
      visit: {
        ...visit,
        proposedWindow: event.window,
        proposedBy: 'tenant',
        visitAt: event.visitAt,
        awaiting: 'vendor_confirm',
        lastReplyId: event.replyId,
      },
      close: false,
      messages: [{
        to: 'vendor',
        body: [
          `The tenant can do ${event.window} for the Home Check at ${location}.`,
          'Reply YES if that time works, or send another day and arrival window.',
        ].join('\n\n'),
      }],
    }
  }

  if (event.type === 'vendor_yes' && visit.awaiting === 'vendor_confirm' && visit.proposedWindow && visit.visitAt) {
    return confirmBoth(visit, {
      at: event.at,
      replyId: event.replyId,
      location,
      window: visit.proposedWindow,
      visitAt: visit.visitAt,
    })
  }

  if (event.type === 'vendor_window' && visit.awaiting === 'vendor_confirm') {
    return {
      visit: {
        ...visit,
        proposedWindow: event.window,
        proposedBy: 'vendor',
        visitAt: event.visitAt,
        awaiting: 'tenant_confirm',
        lastReplyId: event.replyId,
      },
      close: false,
      messages: [
        {
          to: 'vendor',
          body: `Thanks. We’re asking the tenant if ${event.window} works.`,
        },
        {
          to: 'tenant',
          body: [
            `Hi, this is Ulo.`,
            `${vendorName} can complete a Home Check at ${location} on ${event.window}. The visit is four equipment photos. No repairs are authorized.`,
            'Reply YES if that time works, or NO if it does not.',
          ].join('\n\n'),
        },
      ],
    }
  }

  return unchanged(visit)
}

export function beginHomeCheckPhotoVisit(visit: HomeCheckVisit, at: string): HomeCheckVisit {
  return {
    ...visit,
    phase: 'in_progress',
    photoPromptSentAt: at,
    lastReplyId: `photo:${at}`,
  }
}
