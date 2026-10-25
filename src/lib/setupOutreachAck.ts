/** Shared copy for Send invite SMS outreach acknowledgement. */

export type SetupOutreachRecipientKind = 'resident' | 'vendor'

export function setupOutreachAckTitle(_kind: SetupOutreachRecipientKind): string {
  return 'Before you send this invite'
}

export function setupOutreachAckBody(kind: SetupOutreachRecipientKind): string {
  const who = kind === 'resident' ? 'resident' : 'vendor'
  return `You're about to send a text to this ${who}. Ask them to save our number in their contacts so the message does not go to Unknown Sender or Filtered Unknown.`
}

export function setupOutreachAckConfirmLabel(input: {
  kind: SetupOutreachRecipientKind
  retry?: boolean
}): string {
  if (input.retry) return 'Retry invite'
  return 'Send invite'
}
