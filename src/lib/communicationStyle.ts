/**
 * Landlord communication style — tone layer for Ulo operational SMS/email.
 * Style never changes factual content, legal language, or workflow logic.
 */

export type CommunicationStyle =
  | 'calm_professional'
  | 'friendly_conversational'
  | 'direct_action_oriented'

export type CommunicationAudience = 'resident' | 'vendor' | 'landlord' | 'staff'

export type CommunicationChannel = 'sms' | 'email'

export type CommunicationSeverity = 'normal' | 'action_required' | 'urgent' | 'emergency'

export type CommunicationEventType =
  | 'activation_undeliverable'
  | 'work_order_approved'
  | 'generic_update'
  | 'generic_action'
  | 'generic_urgent'

export const DEFAULT_COMMUNICATION_STYLE: CommunicationStyle = 'calm_professional'

export const COMMUNICATION_STYLE_OPTIONS: {
  id: CommunicationStyle
  label: string
  description: string
  recommended?: boolean
  smsExample: string
  emailSubjectExample: string
}[] = [
  {
    id: 'calm_professional',
    label: 'Calm and Professional',
    description: 'Clear, respectful, and dependable. Best for everyday property operations.',
    recommended: true,
    smsExample:
      'Hi Marcus, Ulo couldn’t deliver the activation text to the resident in Unit 3A. Please verify their phone number before resending.',
    emailSubjectExample: 'Resident phone needs attention — Unit 3A',
  },
  {
    id: 'friendly_conversational',
    label: 'Friendly and Conversational',
    description: 'Warm, approachable, and easy to understand without feeling too casual.',
    smsExample:
      'Hi Marcus, we couldn’t reach the resident in Unit 3A by text. Please check their phone number, then resend the welcome message when you’re ready.',
    emailSubjectExample: 'We couldn’t reach the resident in Unit 3A',
  },
  {
    id: 'direct_action_oriented',
    label: 'Direct and Action-Oriented',
    description: 'Concise, efficient, and focused on what needs to happen next.',
    smsExample:
      'Action needed: The activation text for Unit 3A was undeliverable. Verify the resident’s phone number and resend the invitation.',
    emailSubjectExample: 'Action required — Update phone for Unit 3A',
  },
]

export function normalizeCommunicationStyle(raw: unknown): CommunicationStyle {
  const v = String(raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/-/g, '_')
  if (v === 'friendly_conversational' || v === 'friendly') return 'friendly_conversational'
  if (v === 'direct_action_oriented' || v === 'direct') return 'direct_action_oriented'
  if (v === 'calm_professional' || v === 'calm' || v === 'professional') {
    return 'calm_professional'
  }
  return DEFAULT_COMMUNICATION_STYLE
}

export function communicationStyleLabel(style: CommunicationStyle): string {
  return (
    COMMUNICATION_STYLE_OPTIONS.find((option) => option.id === style)?.label ??
    'Calm and Professional'
  )
}

export type OperationalMessageFacts = {
  landlordName?: string | null
  residentName?: string | null
  unitLabel?: string | null
  propertyName?: string | null
  workOrderNumber?: string | null
  issueSummary?: string | null
  maskedPhone?: string | null
  deepLink?: string | null
  /** Appended verbatim — never restyled (STOP/HELP, legal footers, etc.). */
  requiredLegalFooter?: string | null
}

export type BuildOperationalMessageInput = {
  style: CommunicationStyle
  audience: CommunicationAudience
  channel: CommunicationChannel
  eventType: CommunicationEventType
  severity: CommunicationSeverity
  facts: OperationalMessageFacts
  requiredAction?: string | null
}

export type BuiltOperationalMessage = {
  subject: string | null
  body: string
  style: CommunicationStyle
  eventType: CommunicationEventType
  severity: CommunicationSeverity
  channel: CommunicationChannel
  audience: CommunicationAudience
}

function unitLabel(facts: OperationalMessageFacts): string {
  return (facts.unitLabel ?? '').trim() || '—'
}

function residentLabel(facts: OperationalMessageFacts): string {
  const name = (facts.residentName ?? '').trim()
  return name || 'the resident'
}

function propertyLabel(facts: OperationalMessageFacts): string {
  return (facts.propertyName ?? '').trim() || 'your property'
}

function workOrderLabel(facts: OperationalMessageFacts): string {
  return (facts.workOrderNumber ?? '').trim() || 'this work order'
}

function issueLabel(facts: OperationalMessageFacts): string {
  return (facts.issueSummary ?? '').trim() || 'this issue'
}

function firstName(raw: string | null | undefined): string | null {
  const t = (raw ?? '').trim()
  if (!t) return null
  return t.split(/\s+/)[0] ?? null
}

function withLegalFooter(body: string, facts: OperationalMessageFacts): string {
  const footer = (facts.requiredLegalFooter ?? '').trim()
  if (!footer) return body.trim()
  return `${body.trim()}\n\n${footer}`
}

function appendDeepLink(body: string, facts: OperationalMessageFacts, channel: CommunicationChannel): string {
  const link = (facts.deepLink ?? '').trim()
  if (!link || channel !== 'email') return body
  return `${body.trim()}\n\nOpen details:\n${link}`
}

function effectiveSeverity(
  severity: CommunicationSeverity,
  eventType: CommunicationEventType,
): CommunicationSeverity {
  if (severity === 'emergency' || severity === 'urgent') return severity
  if (eventType === 'activation_undeliverable') return 'action_required'
  return severity
}

function buildActivationUndeliverable(
  style: CommunicationStyle,
  severity: CommunicationSeverity,
  facts: OperationalMessageFacts,
  channel: CommunicationChannel,
): BuiltOperationalMessage {
  const unit = unitLabel(facts)
  const resident = residentLabel(facts)
  const landlordFirst = firstName(facts.landlordName) ?? 'there'
  const sev = effectiveSeverity(severity, 'activation_undeliverable')

  if (style === 'friendly_conversational') {
    const subject =
      channel === 'email' ? `We couldn’t reach the resident in Unit ${unit}` : null
    const greeting = `Hi ${landlordFirst},`
    const body = [
      greeting,
      `we couldn’t reach ${resident} in Unit ${unit} by text. Please check their phone number, then resend the welcome message when you’re ready.`,
    ].join(' ')
    return {
      subject,
      body: withLegalFooter(appendDeepLink(body, facts, channel), facts),
      style,
      eventType: 'activation_undeliverable',
      severity: sev,
      channel,
      audience: 'landlord',
    }
  }

  if (style === 'direct_action_oriented') {
    const subject =
      channel === 'email' ? `Action required — Update phone for Unit ${unit}` : null
    const body = `Action needed: The activation text for Unit ${unit} was undeliverable. Verify the resident’s phone number and resend the invitation.`
    return {
      subject,
      body: withLegalFooter(appendDeepLink(body, facts, channel), facts),
      style,
      eventType: 'activation_undeliverable',
      severity: sev,
      channel,
      audience: 'landlord',
    }
  }

  // calm_professional (default)
  const subject =
    channel === 'email' ? `Resident phone needs attention — Unit ${unit}` : null
  const body = `Hi ${landlordFirst}, Ulo couldn’t deliver the activation text to ${resident} in Unit ${unit}. Please verify their phone number before resending.`
  return {
    subject,
    body: withLegalFooter(appendDeepLink(body, facts, channel), facts),
    style,
    eventType: 'activation_undeliverable',
    severity: sev,
    channel,
    audience: 'landlord',
  }
}

function buildWorkOrderApproved(
  style: CommunicationStyle,
  severity: CommunicationSeverity,
  facts: OperationalMessageFacts,
  channel: CommunicationChannel,
): BuiltOperationalMessage {
  const wo = workOrderLabel(facts)
  if (style === 'friendly_conversational') {
    return {
      subject: channel === 'email' ? `Your estimate for ${wo} was approved` : null,
      body: withLegalFooter(
        `Good news—your estimate for work order ${wo} was approved. You can continue with the repair.`,
        facts,
      ),
      style,
      eventType: 'work_order_approved',
      severity,
      channel,
      audience: 'vendor',
    }
  }
  if (style === 'direct_action_oriented') {
    return {
      subject: channel === 'email' ? `Update: ${wo} approved` : null,
      body: withLegalFooter(
        `Update: Work order ${wo} was approved. Continue with the repair.`,
        facts,
      ),
      style,
      eventType: 'work_order_approved',
      severity,
      channel,
      audience: 'vendor',
    }
  }
  return {
    subject: channel === 'email' ? `Estimate approved for ${wo}` : null,
    body: withLegalFooter(
      `Your estimate for work order ${wo} was approved. You may now continue with the repair.`,
      facts,
    ),
    style,
    eventType: 'work_order_approved',
    severity,
    channel,
    audience: 'vendor',
  }
}

function buildUrgent(
  style: CommunicationStyle,
  severity: CommunicationSeverity,
  facts: OperationalMessageFacts,
  channel: CommunicationChannel,
  eventType: CommunicationEventType,
): BuiltOperationalMessage {
  const issue = issueLabel(facts)
  const property = propertyLabel(facts)
  const isEmergency = severity === 'emergency'
  const lead = isEmergency ? 'Emergency' : 'Urgent'

  if (style === 'friendly_conversational' && !isEmergency) {
    return {
      subject: channel === 'email' ? `${lead}: attention needed at ${property}` : null,
      body: withLegalFooter(
        `We need your attention on an urgent issue at ${property}. Please review the request as soon as you can.`,
        facts,
      ),
      style,
      eventType,
      severity,
      channel,
      audience: 'landlord',
    }
  }

  if (style === 'direct_action_oriented') {
    return {
      subject: channel === 'email' ? `${lead}: ${issue} at ${property}` : null,
      body: withLegalFooter(
        `${lead}: Review ${issue} at ${property} immediately.`,
        facts,
      ),
      style,
      eventType,
      severity,
      channel,
      audience: 'landlord',
    }
  }

  // Calm (and friendly emergencies) — lead with urgency, stay composed.
  return {
    subject: channel === 'email' ? `${lead} attention needed — ${property}` : null,
    body: withLegalFooter(
      `${lead} attention is needed for ${issue} at ${property}. Please review the request as soon as possible.`,
      facts,
    ),
    style,
    eventType,
    severity,
    channel,
    audience: 'landlord',
  }
}

/**
 * Central style layer for operational messages.
 * Facts and legal footers are preserved; only framing/tone changes.
 */
export function buildOperationalMessage(
  input: BuildOperationalMessageInput,
): BuiltOperationalMessage {
  const style = normalizeCommunicationStyle(input.style)
  const severity = input.severity
  const facts = input.facts

  if (severity === 'urgent' || severity === 'emergency') {
    return buildUrgent(style, severity, facts, input.channel, input.eventType)
  }

  switch (input.eventType) {
    case 'activation_undeliverable':
      return buildActivationUndeliverable(style, severity, facts, input.channel)
    case 'work_order_approved':
      return buildWorkOrderApproved(style, severity, facts, input.channel)
    default:
      return buildActivationUndeliverable(style, severity, facts, input.channel)
  }
}

/** Live preview copy for the onboarding / settings picker. */
export function buildCommunicationStylePreview(style: CommunicationStyle): {
  sms: string
  emailSubject: string
  emailBody: string
} {
  const sms = buildOperationalMessage({
    style,
    audience: 'landlord',
    channel: 'sms',
    eventType: 'activation_undeliverable',
    severity: 'action_required',
    facts: {
      landlordName: 'Marcus',
      residentName: 'the resident',
      unitLabel: '3A',
    },
  })
  const email = buildOperationalMessage({
    style,
    audience: 'landlord',
    channel: 'email',
    eventType: 'activation_undeliverable',
    severity: 'action_required',
    facts: {
      landlordName: 'Marcus',
      residentName: 'the resident',
      unitLabel: '3A',
      deepLink: 'https://www.ulohome.io/admin/residents',
    },
  })
  return {
    sms: sms.body,
    emailSubject: email.subject ?? '',
    emailBody: email.body,
  }
}

/** Extract invariant facts that must match across styles for the same event. */
export function extractInvariantTokens(body: string): string[] {
  const tokens: string[] = []
  const unit = body.match(/Unit\s+[A-Za-z0-9-]+/i)
  if (unit) tokens.push(unit[0].replace(/\s+/g, ' '))
  const wo = body.match(/work order\s+[A-Za-z0-9-]+/i)
  if (wo) tokens.push(wo[0].replace(/\s+/g, ' '))
  return tokens
}
