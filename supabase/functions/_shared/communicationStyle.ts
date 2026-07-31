/**
 * Edge-compatible copy of landlord communication style helpers.
 * Keep in sync with src/lib/communicationStyle.ts for outbound SMS/email.
 */

export type CommunicationStyle =
  | "calm_professional"
  | "friendly_conversational"
  | "direct_action_oriented"

export type CommunicationAudience = "resident" | "vendor" | "landlord" | "staff"
export type CommunicationChannel = "sms" | "email"
export type CommunicationSeverity = "normal" | "action_required" | "urgent" | "emergency"
export type CommunicationEventType =
  | "activation_undeliverable"
  | "work_order_approved"
  | "generic_update"
  | "generic_action"
  | "generic_urgent"

export const DEFAULT_COMMUNICATION_STYLE: CommunicationStyle = "calm_professional"

export function normalizeCommunicationStyle(raw: unknown): CommunicationStyle {
  const v = String(raw ?? "").trim().toLowerCase().replace(/-/g, "_")
  if (v === "friendly_conversational" || v === "friendly") return "friendly_conversational"
  if (v === "direct_action_oriented" || v === "direct") return "direct_action_oriented"
  if (v === "calm_professional" || v === "calm" || v === "professional") {
    return "calm_professional"
  }
  return DEFAULT_COMMUNICATION_STYLE
}

export type OperationalMessageFacts = {
  landlordName?: string | null
  residentName?: string | null
  unitLabel?: string | null
  propertyName?: string | null
  workOrderNumber?: string | null
  issueSummary?: string | null
  deepLink?: string | null
  requiredLegalFooter?: string | null
}

export type BuildOperationalMessageInput = {
  style: CommunicationStyle
  audience: CommunicationAudience
  channel: CommunicationChannel
  eventType: CommunicationEventType
  severity: CommunicationSeverity
  facts: OperationalMessageFacts
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
  return (facts.unitLabel ?? "").trim() || "—"
}

function residentLabel(facts: OperationalMessageFacts): string {
  return (facts.residentName ?? "").trim() || "the resident"
}

function propertyLabel(facts: OperationalMessageFacts): string {
  return (facts.propertyName ?? "").trim() || "your property"
}

function workOrderLabel(facts: OperationalMessageFacts): string {
  return (facts.workOrderNumber ?? "").trim() || "this work order"
}

function issueLabel(facts: OperationalMessageFacts): string {
  return (facts.issueSummary ?? "").trim() || "this issue"
}

function firstName(raw: string | null | undefined): string | null {
  const t = (raw ?? "").trim()
  if (!t) return null
  return t.split(/\s+/)[0] ?? null
}

function withLegalFooter(body: string, facts: OperationalMessageFacts): string {
  const footer = (facts.requiredLegalFooter ?? "").trim()
  if (!footer) return body.trim()
  return `${body.trim()}\n\n${footer}`
}

function appendDeepLink(
  body: string,
  facts: OperationalMessageFacts,
  channel: CommunicationChannel,
): string {
  const link = (facts.deepLink ?? "").trim()
  if (!link || channel !== "email") return body
  return `${body.trim()}\n\nOpen details:\n${link}`
}

function buildActivationUndeliverable(
  style: CommunicationStyle,
  severity: CommunicationSeverity,
  facts: OperationalMessageFacts,
  channel: CommunicationChannel,
): BuiltOperationalMessage {
  const unit = unitLabel(facts)
  const resident = residentLabel(facts)
  const landlordFirst = firstName(facts.landlordName) ?? "there"

  if (style === "friendly_conversational") {
    return {
      subject: channel === "email"
        ? `We couldn’t reach the resident in Unit ${unit}`
        : null,
      body: withLegalFooter(
        appendDeepLink(
          `Hi ${landlordFirst}, we couldn’t reach ${resident} in Unit ${unit} by text. Please check their phone number, then resend the welcome message when you’re ready.`,
          facts,
          channel,
        ),
        facts,
      ),
      style,
      eventType: "activation_undeliverable",
      severity,
      channel,
      audience: "landlord",
    }
  }

  if (style === "direct_action_oriented") {
    return {
      subject: channel === "email"
        ? `Action required — Update phone for Unit ${unit}`
        : null,
      body: withLegalFooter(
        appendDeepLink(
          `Action needed: The activation text for Unit ${unit} was undeliverable. Verify the resident’s phone number and resend the invitation.`,
          facts,
          channel,
        ),
        facts,
      ),
      style,
      eventType: "activation_undeliverable",
      severity,
      channel,
      audience: "landlord",
    }
  }

  return {
    subject: channel === "email"
      ? `Resident phone needs attention — Unit ${unit}`
      : null,
    body: withLegalFooter(
      appendDeepLink(
        `Hi ${landlordFirst}, Ulo couldn’t deliver the activation text to ${resident} in Unit ${unit}. Please verify their phone number before resending.`,
        facts,
        channel,
      ),
      facts,
    ),
    style,
    eventType: "activation_undeliverable",
    severity,
    channel,
    audience: "landlord",
  }
}

function buildWorkOrderApproved(
  style: CommunicationStyle,
  severity: CommunicationSeverity,
  facts: OperationalMessageFacts,
  channel: CommunicationChannel,
): BuiltOperationalMessage {
  const wo = workOrderLabel(facts)
  if (style === "friendly_conversational") {
    return {
      subject: channel === "email" ? `Your estimate for ${wo} was approved` : null,
      body: withLegalFooter(
        `Good news—your estimate for work order ${wo} was approved. You can continue with the repair.`,
        facts,
      ),
      style,
      eventType: "work_order_approved",
      severity,
      channel,
      audience: "vendor",
    }
  }
  if (style === "direct_action_oriented") {
    return {
      subject: channel === "email" ? `Update: ${wo} approved` : null,
      body: withLegalFooter(
        `Update: Work order ${wo} was approved. Continue with the repair.`,
        facts,
      ),
      style,
      eventType: "work_order_approved",
      severity,
      channel,
      audience: "vendor",
    }
  }
  return {
    subject: channel === "email" ? `Estimate approved for ${wo}` : null,
    body: withLegalFooter(
      `Your estimate for work order ${wo} was approved. You may now continue with the repair.`,
      facts,
    ),
    style,
    eventType: "work_order_approved",
    severity,
    channel,
    audience: "vendor",
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
  const isEmergency = severity === "emergency"
  const lead = isEmergency ? "Emergency" : "Urgent"

  if (style === "friendly_conversational" && !isEmergency) {
    return {
      subject: channel === "email" ? `${lead}: attention needed at ${property}` : null,
      body: withLegalFooter(
        `We need your attention on an urgent issue at ${property}. Please review the request as soon as you can.`,
        facts,
      ),
      style,
      eventType,
      severity,
      channel,
      audience: "landlord",
    }
  }

  if (style === "direct_action_oriented") {
    return {
      subject: channel === "email" ? `${lead}: ${issue} at ${property}` : null,
      body: withLegalFooter(`${lead}: Review ${issue} at ${property} immediately.`, facts),
      style,
      eventType,
      severity,
      channel,
      audience: "landlord",
    }
  }

  return {
    subject: channel === "email" ? `${lead} attention needed — ${property}` : null,
    body: withLegalFooter(
      `${lead} attention is needed for ${issue} at ${property}. Please review the request as soon as possible.`,
      facts,
    ),
    style,
    eventType,
    severity,
    channel,
    audience: "landlord",
  }
}

export function buildOperationalMessage(
  input: BuildOperationalMessageInput,
): BuiltOperationalMessage {
  const style = normalizeCommunicationStyle(input.style)
  if (input.severity === "urgent" || input.severity === "emergency") {
    return buildUrgent(style, input.severity, input.facts, input.channel, input.eventType)
  }
  switch (input.eventType) {
    case "activation_undeliverable":
      return buildActivationUndeliverable(style, input.severity, input.facts, input.channel)
    case "work_order_approved":
      return buildWorkOrderApproved(style, input.severity, input.facts, input.channel)
    default:
      return buildActivationUndeliverable(style, input.severity, input.facts, input.channel)
  }
}

export function buildCommunicationStylePreview(style: CommunicationStyle): {
  sms: string
  emailSubject: string
  emailBody: string
} {
  const sms = buildOperationalMessage({
    style,
    audience: "landlord",
    channel: "sms",
    eventType: "activation_undeliverable",
    severity: "action_required",
    facts: { landlordName: "Marcus", residentName: "the resident", unitLabel: "3A" },
  })
  const email = buildOperationalMessage({
    style,
    audience: "landlord",
    channel: "email",
    eventType: "activation_undeliverable",
    severity: "action_required",
    facts: {
      landlordName: "Marcus",
      residentName: "the resident",
      unitLabel: "3A",
      deepLink: "https://www.ulohome.io/admin/residents",
    },
  })
  return { sms: sms.body, emailSubject: email.subject ?? "", emailBody: email.body }
}
