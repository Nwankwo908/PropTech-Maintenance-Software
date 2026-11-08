import {
  isGeneralistTrade,
  isPestControlIssue,
} from '../../shared/maintenance/vendorTrades.ts'

/** How long a tenant or vendor text can sit before it needs a reply. */
export const NEEDS_YOUR_RESPONSE_WAIT_MS = 4 * 60 * 60 * 1000

const NOT_A_TENANT_OR_VENDOR_THREAD = new Set(['ai_copilot', 'landlord_update'])

export type NeedsResponseMessage = {
  id?: string
  direction: string
  createdAtMs: number
  text?: string
  /** Set when this text is a direct reply to an older message. */
  replyToMessageId?: string
  /** The work order this text belongs to is already completed. */
  workOrderCompleted?: boolean
  /** A generalist was offered for pest work. */
  generalistPestOffer?: boolean
}

export type UnansweredLandlordTopic = {
  messageId: string
  text: string
  createdAtMs: number
}

/**
 * True when this thread is with a tenant or vendor, it is still open, their
 * message is the latest one, and neither the property team nor Ulo has replied
 * for at least four hours.
 *
 * Messages must be newest first. A later outbound message is a reply from
 * either side and does not count.
 */
export function threadNeedsYourResponse(input: {
  conversationType: string
  closed: boolean
  messages: NeedsResponseMessage[] | undefined
  atMs: number
}): boolean {
  if (input.closed) return false
  const conversationType = input.conversationType.trim()
  if (NOT_A_TENANT_OR_VENDOR_THREAD.has(conversationType)) return false
  const latest = input.messages?.find((message) => message.createdAtMs <= input.atMs)
  if (!latest || latest.direction !== 'inbound') return false
  return input.atMs - latest.createdAtMs >= NEEDS_YOUR_RESPONSE_WAIT_MS
}

function normalizedTopicText(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim().toLowerCase()
}

function withoutComplianceFooter(raw: string): string {
  return raw
    .replace(/\breply\s+help\b[^.]*(?:\.|$)/gi, ' ')
    .replace(/\breply\s+stop\b[^.]*(?:\.|$)/gi, ' ')
    .replace(/msg\s*&\s*data rates may apply\.?/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function normalizeAskText(raw: string): string {
  return raw.replace(/[\u2018\u2019]/g, "'").replace(/\s+/g, ' ').trim()
}

/**
 * Sent to a number Ulo does not recognize, not to the landlord.
 * The reply is for that sender (company name, unit, or saving their number).
 */
function isUnrecognizedSenderPrompt(raw: string): boolean {
  const text = normalizeAskText(raw)
  if (!text) return false
  if (/reply with your company name/i.test(text)) return true
  if (/don'?t recognize this phone number|do not recognize this phone number/i.test(text)) return true
  if (/save this phone number as a contact/i.test(text)) return true
  if (/reply\s+yes\s+to\s+save\s+this\s+number/i.test(text)) return true
  if (
    /couldn'?t match|could not match|wasn'?t able to match|was not able to match/i.test(text) &&
    /vendor profile|property account|this number|this phone|that unit/i.test(text)
  ) {
    return true
  }
  return false
}

/**
 * Rent reminders and payment follow-ups are paused.
 * A rent question, receipt check, or payment-method ask does not need a reply.
 */
function isRentQuestion(raw: string): boolean {
  const text = normalizeAskText(raw)
  if (!text) return false
  if (/\brent\b/i.test(text)) return true
  if (/what was your payment method/i.test(text)) return true
  if (/\breply\s+zelle\b/i.test(text)) return true
  if (/how much did you receive/i.test(text)) return true
  if (/how much did you pay/i.test(text)) return true
  if (/did you receive it/i.test(text)) return true
  if (/\breply\s+yes,\s*no,\s*or\s+partial\b/i.test(text)) return true
  if (/\breply\s+paid\b/i.test(text) && /\bpartial\b/i.test(text)) return true
  return false
}

/**
 * Asks the resident to describe a repair. The landlord is not the audience.
 */
function isResidentHelpPrompt(raw: string): boolean {
  const text = normalizeAskText(raw)
  if (!text) return false
  if (/how can we help with your maintenance issue/i.test(text)) return true
  if (/what do you need\b[^?]{0,120}\brepair\b/i.test(text)) return true
  if (/tell me what'?s going on with your unit/i.test(text)) return true
  if (/what kind of issue is it/i.test(text)) return true
  if (/short description of what'?s going on/i.test(text)) return true
  if (/tell me what'?s going on \(a photo/i.test(text)) return true
  return false
}

/**
 * True when the text asks the landlord to answer.
 * A notice, a confirmation, an unrecognized-sender prompt, a resident help
 * question, a rent question, or a STOP/HELP footer does not.
 */
export function landlordTextAsksForReply(raw: string): boolean {
  const text = withoutComplianceFooter(raw)
  if (!text) return false
  if (isUnrecognizedSenderPrompt(text)) return false
  if (isResidentHelpPrompt(text)) return false
  if (isRentQuestion(text)) return false
  if (/\?/.test(text)) return true
  return /\breply\s+(?!help\b|stop\b)\S+/i.test(text)
}

function outboundNeedsReply(message: NeedsResponseMessage): boolean {
  if (message.workOrderCompleted || message.generalistPestOffer) return false
  if (message.replyToMessageId?.trim()) return false
  const text = (message.text ?? '').trim()
  if (!text) return true
  return landlordTextAsksForReply(text)
}

/** A repair is completed only when the work order itself is completed. */
export function isCompletedWorkOrderStatus(status: string | null | undefined): boolean {
  return (status ?? '').trim().toLowerCase() === 'completed'
}

/** Vendor named in a landlord choice text, such as "Ivanhomesolutions can take the Pest issue". */
export function offeredVendorNameFromAsk(raw: string): string | null {
  const text = raw.replace(/\s+/g, ' ').trim()
  const canTake = text.match(/([A-Za-z0-9][A-Za-z0-9 '&’.-]{0,80}?)\s+can take\b/i)
  const fromOffer = canTake?.[1]?.trim()
  if (fromOffer) return fromOffer
  const send = text.match(/\bsend (?:the job|this) to\s+([A-Za-z0-9][A-Za-z0-9 '&’.-]*?)(?:\s*[—–-]|\.|$)/i)
  return send?.[1]?.trim() || null
}

export function compactVendorName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '')
}

/**
 * True when this text offers a generalist for pest work.
 * A pest specialist offered for the same job still counts.
 * An unknown vendor is left in place.
 */
export function isGeneralistOfferedPestWork(input: {
  text: string
  vendorFound: boolean
  vendorCategory?: string | null
  issueCategory?: string | null
}): boolean {
  if (!input.vendorFound) return false
  const pest =
    isPestControlIssue(input.issueCategory) || /\bpest\b/i.test(normalizeAskText(input.text))
  if (!pest) return false
  return isGeneralistTrade(input.vendorCategory)
}

/** Ticket named on a landlord text, when the send stored one. */
export function workOrderIdFromMessagePayload(raw: unknown): string | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const record = raw as Record<string, unknown>
  for (const key of ['ticket_id', 'maintenance_request_id'] as const) {
    const id = record[key]
    if (typeof id === 'string' && id.trim()) return id.trim()
  }
  return undefined
}

/** Read the older message a dashboard reply was sent to. */
export function replyToMessageIdFromPayload(raw: unknown): string | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const id = (raw as { reply_to_message_id?: unknown }).reply_to_message_id
  return typeof id === 'string' && id.trim() ? id.trim() : undefined
}

function directReplyTargets(messages: NeedsResponseMessage[]): Set<string> {
  const targets = new Set<string>()
  for (const message of messages) {
    const id = message.replyToMessageId?.trim()
    if (id) targets.add(id)
  }
  return targets
}

/**
 * One plain sentence for a waiting text, before a model rewrite.
 * Drops the greeting and keeps the ask.
 */
export function conciseTopicSentence(raw: string): string {
  let text = raw.replace(/\s+/g, ' ').trim()
  text = text.replace(/^hi\s+[^,.]{1,48},\s*/i, '')
  text = text.replace(/^this is the property management team at [^.]+\.\s*/i, '')
  text = text.replace(/^this is ulo\.\s*/i, '')
  text = text.replace(/^ulo:\s*/i, '')
  const sentences = text.split(/(?<=[.!?])\s+/).map((part) => part.trim()).filter(Boolean)
  const sentence =
    sentences.find((part) => landlordTextAsksForReply(part)) || sentences[0] || text
  if (!sentence) return 'A text from Ulo is waiting for a reply.'
  const finished = /[.!?]$/.test(sentence) ? sentence : `${sentence}.`
  return finished.length > 180 ? `${finished.slice(0, 177).trim()}…` : finished
}

function isWaitingOutbound(
  ordered: NeedsResponseMessage[],
  index: number,
  directTargets: Set<string>,
): boolean {
  const message = ordered[index]
  if (message.direction.trim().toLowerCase() !== 'outbound') return false
  if (!outboundNeedsReply(message)) return false
  const id = message.id?.trim()
  if (id && directTargets.has(id)) return false
  // A confirmation between the ask and the reply does not keep the ask open.
  // Another ask does: a later reply answers the newer ask, not the older one.
  for (let cursor = index + 1; cursor < ordered.length; cursor += 1) {
    const next = ordered[cursor]
    const direction = next.direction.trim().toLowerCase()
    if (direction === 'inbound') return false
    if (direction === 'outbound' && outboundNeedsReply(next)) return true
  }
  return true
}

/**
 * Waiting topics across the whole landlord thread, oldest first.
 * A reply clears the ask it follows. A confirmation in between does not block
 * that reply. A later reply does not clear an older ask when another ask came
 * first. A direct reply also clears the older text it names.
 * Identical texts are one topic.
 * A text on a completed work order does not count.
 */
export function unansweredLandlordTopics(
  messages: NeedsResponseMessage[] | undefined,
): UnansweredLandlordTopic[] {
  if (!messages?.length) return []
  const ordered = [...messages].sort((a, b) => a.createdAtMs - b.createdAtMs)
  const directTargets = directReplyTargets(ordered)
  const seen = new Set<string>()
  const topics: UnansweredLandlordTopic[] = []
  for (let index = 0; index < ordered.length; index += 1) {
    if (!isWaitingOutbound(ordered, index, directTargets)) continue
    const message = ordered[index]
    const text = (message.text ?? '').replace(/\s+/g, ' ').trim()
    if (!text) continue
    const key = normalizedTopicText(text)
    if (seen.has(key)) continue
    seen.add(key)
    topics.push({
      messageId: (message.id ?? '').trim(),
      text,
      createdAtMs: message.createdAtMs,
    })
  }
  return topics
}

/**
 * Ulo may send a confirmation while a reply is still open.
 * Ulo may not ask something else until the landlord answers the open ask.
 */
export function landlordMaySendText(
  history: NeedsResponseMessage[] | undefined,
  nextText: string,
): boolean {
  const text = nextText.replace(/\s+/g, ' ').trim()
  if (text && !landlordTextAsksForReply(text)) return true
  return unansweredLandlordTopics(history).length === 0
}

/**
 * Every text from Ulo on the landlord thread that did not get a reply.
 * A reply clears the ask it follows. A confirmation in between does not block
 * that reply. A later reply does not clear an older ask when another ask came
 * first. Outbound is Ulo; inbound is the landlord.
 */
export function countUnansweredLandlordMessages(
  messages: NeedsResponseMessage[] | undefined,
): number {
  if (!messages?.length) return 0
  const ordered = [...messages].sort((a, b) => a.createdAtMs - b.createdAtMs)
  const directTargets = directReplyTargets(ordered)
  let count = 0
  for (let index = 0; index < ordered.length; index += 1) {
    if (isWaitingOutbound(ordered, index, directTargets)) count += 1
  }
  return count
}
