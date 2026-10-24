/**
 * Setup-welcome recipients that cannot receive a message.
 * example.com is reserved. NANP 555-0100–0199 is fictional.
 * A later retry skips these addresses and still sends a new deliverable one.
 */

const RESERVED_EMAIL_DOMAINS = ['example.com', 'example.org', 'example.net'] as const

export function isReservedWelcomeEmail(email: string | null | undefined): boolean {
  const normalized = (email ?? '').trim().toLowerCase()
  const at = normalized.lastIndexOf('@')
  if (at <= 0 || at === normalized.length - 1) return false
  const domain = normalized.slice(at + 1)
  if (domain === 'localhost' || domain.endsWith('.localhost')) return true
  return RESERVED_EMAIL_DOMAINS.some(
    (reserved) => domain === reserved || domain.endsWith(`.${reserved}`),
  )
}

/** NANP 555-0100 through 555-0199 cannot receive SMS. */
export function isFictionalWelcomePhone(phone: string | null | undefined): boolean {
  const digits = (phone ?? '').replace(/\D/g, '')
  const national = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits
  if (national.length !== 10) return false
  const line = national.slice(6)
  return national.slice(3, 6) === '555' && line >= '0100' && line <= '0199'
}

export type WelcomeRecipientPlan = {
  smsToSend: string[]
  emailToSend: string[]
  smsSkipped: string[]
  emailSkipped: string[]
}

export function planLandlordWelcomeDelivery(input: {
  phones: string[]
  emails: string[]
  priorSmsSent?: string[]
  priorEmailSent?: string[]
  priorSmsSkipped?: string[]
  priorEmailSkipped?: string[]
  forceEmail?: boolean
}): WelcomeRecipientPlan {
  const smsSent = new Set(input.priorSmsSent ?? [])
  const emailSent = new Set((input.priorEmailSent ?? []).map((email) => email.toLowerCase()))
  const smsSkipped = new Set(input.priorSmsSkipped ?? [])
  const emailSkipped = new Set(
    (input.priorEmailSkipped ?? []).map((email) => email.toLowerCase()),
  )
  const blockAllSms = smsSent.size > 0
  const blockAllEmail = emailSent.size > 0 && input.forceEmail !== true

  const smsToSend: string[] = []
  const emailToSend: string[] = []
  const nextSmsSkipped: string[] = []
  const nextEmailSkipped: string[] = []
  const seenSms = new Set<string>()
  const seenEmail = new Set<string>()

  for (const phone of input.phones) {
    const normalized = phone.trim()
    if (!normalized || seenSms.has(normalized)) continue
    seenSms.add(normalized)
    if (blockAllSms || smsSent.has(normalized) || smsSkipped.has(normalized)) continue
    if (isFictionalWelcomePhone(normalized)) {
      nextSmsSkipped.push(normalized)
      continue
    }
    smsToSend.push(normalized)
  }

  for (const email of input.emails) {
    const normalized = email.trim().toLowerCase()
    if (!normalized || seenEmail.has(normalized)) continue
    seenEmail.add(normalized)
    if (blockAllEmail || emailSent.has(normalized) || emailSkipped.has(normalized)) continue
    if (isReservedWelcomeEmail(normalized)) {
      nextEmailSkipped.push(normalized)
      continue
    }
    emailToSend.push(normalized)
  }

  return {
    smsToSend,
    emailToSend,
    smsSkipped: nextSmsSkipped,
    emailSkipped: nextEmailSkipped,
  }
}

export function landlordWelcomeContactsAreUndeliverable(input: {
  emails?: Array<string | null | undefined>
  phones?: Array<string | null | undefined>
}): boolean {
  const emails = (input.emails ?? []).map((email) => (email ?? '').trim()).filter(Boolean)
  const phones = (input.phones ?? []).map((phone) => (phone ?? '').trim()).filter(Boolean)
  if (emails.length === 0 && phones.length === 0) return false
  return (
    emails.every((email) => isReservedWelcomeEmail(email)) &&
    phones.every((phone) => isFictionalWelcomePhone(phone))
  )
}

export function undeliverableWelcomeStatus(input: {
  emails?: Array<string | null | undefined>
  phones?: Array<string | null | undefined>
}): string {
  const emails = (input.emails ?? []).map((email) => (email ?? '').trim()).filter(Boolean)
  const phones = (input.phones ?? []).map((phone) => (phone ?? '').trim()).filter(Boolean)
  if (emails.length > 0 && phones.length > 0) {
    return 'the welcome message was not sent because the email and phone on this account cannot receive messages'
  }
  if (emails.length > 0) {
    return 'the welcome message was not sent because the email on this account cannot receive messages'
  }
  return 'the welcome message was not sent because the phone on this account cannot receive messages'
}
