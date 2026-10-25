/** Invite copy shared by delivery and the send-invite preview. */

function firstNameOf(fullName?: string | null): string | null {
  const trimmed = fullName?.trim()
  if (!trimmed) return null
  return trimmed.split(/\s+/)[0] ?? null
}

/** Post-onboarding welcome / activation SMS. */
export function composeTenantWelcomeSms(params: {
  tenantName?: string | null
  companyName?: string | null
}): string {
  const first = firstNameOf(params.tenantName)
  const company = params.companyName?.trim()
  const greeting = first ? `Hi ${first}` : 'Hi there'
  const team = company
    ? `this is the property management team at ${company}.`
    : 'this is your property management team.'

  return (
    `${greeting} — ${team}\n\n` +
    `🏠 NEED A REPAIR?\n` +
    `Reply YES to activate maintenance requests and important home updates.\n\n` +
    `📲 SAVE THIS NUMBER\n` +
    `Save us as "Ulo Assistant" so you can easily find us when you need help.\n\n` +
    `Once activated, just text this number anytime you need a repair or have a question about your home.\n\n` +
    `NO — Opt out | HELP — Help | STOP — Unsubscribe\n` +
    `Msg & data rates may apply.`
  )
}

export function inviteSmsCopy(input: {
  vendorName: string | null
  companyName: string | null
  link: string
}): string {
  const greeting = input.vendorName ? `Hi ${input.vendorName},` : 'Hi,'
  const team = input.companyName
    ? `This is the property management team at ${input.companyName}.`
    : 'This is the property management team.'
  return [
    greeting,
    '',
    team,
    '',
    "We'd like to invite you to join our preferred vendor network on Ulo. " +
      'Before receiving job requests, please confirm your business details and credentials: (2 min)',
    '',
    input.link,
  ].join('\n')
}

export function inviteEmailCopy(input: {
  vendorName: string | null
  companyName: string | null
  link: string
}): { subject: string; text: string; html: string } {
  const vendor = input.vendorName || 'there'
  const company = input.companyName || 'Our property management team'
  const subject = "You're invited to join our vendor network"
  const steps = [
    'Verifying your professional license',
    'Uploading your insurance certificate',
    'Providing a W-9 (optional)',
    'Setting up your payout account',
    'Confirming the services you offer and the areas you serve',
  ]
  const text = [
    `Hi ${vendor},`,
    '',
    `${company} would like to add you to our preferred vendor network on Ulo.`,
    '',
    'Complete a quick verification to become eligible to receive work orders from our team.',
    '',
    'The process takes about 5 minutes and includes:',
    ...steps.map((step) => `• ${step}`),
    '',
    "Once everything is verified, you'll be eligible to receive work orders through Ulo.",
    '',
    `Start verification: ${input.link}`,
    '',
    "If the button doesn't work, copy and paste this link into your browser:",
    input.link,
    '',
    'Thank you,',
    company,
  ].join('\n')

  const stepsHtml = steps
    .map((step) => `<li style="margin:4px 0">${step}</li>`)
    .join('')

  const html = `
    <div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#0a0a0a;line-height:1.6;max-width:520px;margin:0 auto">
      <p>Hi ${vendor},</p>
      <p><strong>${company}</strong> would like to add you to our preferred vendor network on Ulo.</p>
      <p>Complete a quick verification to become eligible to receive work orders from our team.</p>
      <p style="margin-bottom:6px">The process takes about <strong>5 minutes</strong> and includes:</p>
      <ul style="margin:0 0 8px 20px;padding:0">${stepsHtml}</ul>
      <p>Once everything is verified, you'll be eligible to receive work orders through Ulo.</p>
      <p style="margin:24px 0">
        <a href="${input.link}" style="background:#186179;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:600;display:inline-block">Start Verification</a>
      </p>
      <p style="color:#6a7282;font-size:13px">If the button doesn't work, copy and paste this link into your browser:<br/>${input.link}</p>
      <p>Thank you,<br/>${company}</p>
    </div>
  `.trim()

  return { subject, text, html }
}
