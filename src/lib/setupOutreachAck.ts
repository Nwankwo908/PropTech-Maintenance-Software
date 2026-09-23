/** Shared copy for Setup Resident / Setup Vendor SMS outreach acknowledgement. */

export type SetupOutreachRecipientKind = 'resident' | 'vendor'

export function setupOutreachAckTitle(kind: SetupOutreachRecipientKind): string {
  return kind === 'resident' ? 'Before you set up this resident' : 'Before you set up this vendor'
}

export function setupOutreachAckBody(kind: SetupOutreachRecipientKind): string {
  const who = kind === 'resident' ? 'resident' : 'vendor'
  return `You're about to send a text to this ${who}. Ask them to save our number in their contacts so the message does not go to Unknown Sender or Filtered Unknown.`
}

export function setupOutreachAckCheckboxLabel(kind: SetupOutreachRecipientKind): string {
  const who = kind === 'resident' ? 'resident' : 'vendor'
  return `I will remind the ${who} to save our number so texts are not filtered as unknown.`
}

export function setupOutreachAckConfirmLabel(input: {
  kind: SetupOutreachRecipientKind
  retry?: boolean
}): string {
  if (input.retry) return 'Retry setup'
  return input.kind === 'resident' ? 'Setup Resident' : 'Setup Vendor'
}
