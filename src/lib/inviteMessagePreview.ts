import {
  composeTenantWelcomeSms,
  inviteEmailCopy,
  inviteSmsCopy,
} from '@shared/outreach/inviteMessages'

export type InvitePreviewChannel = 'sms' | 'email' | 'both'

export function inviteChannelFromContact(
  phone?: string | null,
  email?: string | null,
): InvitePreviewChannel {
  const hasPhone = Boolean(phone?.trim())
  const hasEmail = Boolean(email?.trim())
  if (hasPhone && hasEmail) return 'both'
  if (hasEmail) return 'email'
  return 'sms'
}

export type InvitePreviewBlock = {
  label: string
  subject?: string
  body: string
}

/** The message a Send invite action will deliver. */
export function buildInvitePreview(input: {
  kind: 'resident' | 'vendor'
  recipientName?: string | null
  companyName?: string | null
  channel?: InvitePreviewChannel
  link?: string
}): InvitePreviewBlock[] {
  if (input.kind === 'resident') {
    return [{
      label: 'Text',
      body: composeTenantWelcomeSms({
        tenantName: input.recipientName,
        companyName: input.companyName,
      }),
    }]
  }

  const link = input.link?.trim() || 'https://www.ulohome.io/v/…'
  const channel = input.channel ?? 'both'
  const blocks: InvitePreviewBlock[] = []
  if (channel === 'sms' || channel === 'both') {
    blocks.push({
      label: 'Text',
      body: inviteSmsCopy({
        vendorName: input.recipientName?.trim() || null,
        companyName: input.companyName ?? null,
        link,
      }),
    })
  }
  if (channel === 'email' || channel === 'both') {
    const email = inviteEmailCopy({
      vendorName: input.recipientName?.trim() || null,
      companyName: input.companyName ?? null,
      link,
    })
    blocks.push({
      label: 'Email',
      subject: email.subject,
      body: email.text,
    })
  }
  return blocks
}
