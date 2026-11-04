/**
 * Where a resident attachment goes after it arrives.
 * Media-only texts are real messages. They are not blank input and they are
 * not an answer to an unrelated rent or lease reminder.
 */

export type FollowUpRepair = {
  id: string
  label: string
  open: boolean
}

export type AwaitingAttachmentChoice = {
  repairIds: string[]
  mediaPaths: string[]
}

export type FollowUpAttachmentInput = {
  mediaCount: number
  body: string
  repairs: FollowUpRepair[]
  pendingPhotoRepairId?: string | null
  awaitingChoice?: AwaitingAttachmentChoice | null
  /** Intake is still collecting the report. That flow owns the attachment. */
  intakeActive: boolean
  /** PAID / YES / STOP and other replies that belong to a different pending ask. */
  explicitOtherWorkflowReply: boolean
  emergency: boolean
}

export type FollowUpAttachmentDecision =
  | { action: 'skip' }
  | { action: 'attach'; repairId: string; mediaPaths: string[] }
  | { action: 'ask'; repairIds: string[]; mediaPaths: string[] }
  | { action: 'acknowledge' }

const ATTACHMENT_ONLY =
  /^(here|sent|video|photo|picture|pic|pics|attached|attachment|this|ok|okay|thanks|thank you)[.!]?$/i

export function choiceNumber(body: string, optionCount: number): number | null {
  const match = body.trim().match(/^(\d+)\b/)
  if (!match) return null
  const n = Number(match[1])
  if (!Number.isInteger(n) || n < 1 || n > optionCount) return null
  return n
}

export function mergeAttachmentPaths(existing: string[], incoming: string[]): string[] {
  const seen = new Set<string>()
  const next: string[] = []
  for (const raw of [...existing, ...incoming]) {
    const path = raw.trim()
    if (!path || seen.has(path)) continue
    seen.add(path)
    next.push(path)
  }
  return next.slice(0, 24)
}

export function decideFollowUpAttachment(
  input: FollowUpAttachmentInput,
): FollowUpAttachmentDecision {
  const awaiting = input.awaitingChoice
  const pendingMedia = (awaiting?.mediaPaths ?? []).map((path) => path.trim()).filter(Boolean)
  const hasMedia = input.mediaCount > 0 || pendingMedia.length > 0
  if (!hasMedia) return { action: 'skip' }
  if (input.emergency || input.explicitOtherWorkflowReply) return { action: 'skip' }
  if (input.intakeActive) return { action: 'skip' }

  if (awaiting && awaiting.repairIds.length > 1) {
    const picked = choiceNumber(input.body, awaiting.repairIds.length)
    if (picked) {
      return {
        action: 'attach',
        repairId: awaiting.repairIds[picked - 1]!,
        mediaPaths: pendingMedia,
      }
    }
    return { action: 'ask', repairIds: awaiting.repairIds, mediaPaths: pendingMedia }
  }

  if (input.mediaCount <= 0) return { action: 'skip' }

  const pendingId = input.pendingPhotoRepairId?.trim() || ''
  if (pendingId && input.repairs.some((repair) => repair.id === pendingId)) {
    return { action: 'attach', repairId: pendingId, mediaPaths: [] }
  }

  const body = input.body.trim()
  const attachmentShaped = body.length === 0 || ATTACHMENT_ONLY.test(body)
  if (!attachmentShaped) return { action: 'skip' }

  const open = input.repairs.filter((repair) => repair.open)
  if (open.length === 1) {
    return { action: 'attach', repairId: open[0]!.id, mediaPaths: [] }
  }
  if (open.length > 1) {
    return { action: 'ask', repairIds: open.map((repair) => repair.id), mediaPaths: [] }
  }
  return { action: 'acknowledge' }
}

function nounForCount(count: number): string {
  return count === 1 ? 'file' : 'files'
}

export function buildAttachmentReceivedAck(count: number): string {
  const noun = count === 1 ? 'file' : 'files'
  return [
    'Thanks — I got your ' + noun + '.',
    '',
    "I haven't added " + (count === 1 ? 'it' : 'them') + ' to a repair yet.',
  ].join('\n')
}

export function buildAttachmentAddedAck(input: {
  count: number
  repairLabel: string
}): string {
  const noun = nounForCount(input.count)
  const label = input.repairLabel.trim() || 'that repair'
  return `Thanks — I got your ${noun} and added ${input.count === 1 ? 'it' : 'them'} to ${label}.`
}

export function buildAttachmentChoiceAck(input: {
  count: number
  repairs: Array<{ id: string; label: string }>
  repairIds: string[]
}): string {
  const lines = input.repairIds.map((id, index) => {
    const repair = input.repairs.find((row) => row.id === id)
    const label = repair?.label.trim() || 'Repair'
    return `${index + 1}. ${label}`
  })
  const noun = nounForCount(input.count)
  return [
    `Thanks — I got your ${noun}. Which repair should I add ${input.count === 1 ? 'it' : 'them'} to?`,
    '',
    ...lines,
    '',
    'Reply with the number.',
  ].join('\n')
}
