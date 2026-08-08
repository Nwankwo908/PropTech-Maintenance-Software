/**
 * Move-in checklist — task state shared by the engine and SMS replies.
 */
export const MOVE_IN_CHECKLIST_ITEM_DEFS = [
  { key: "keys", label: "Pick up keys or confirm access instructions" },
  { key: "utilities", label: "Set up utilities in your name" },
  { key: "inspection_prep", label: "Prepare the unit for move-in inspection" },
] as const

export type MoveInChecklistItemKey = (typeof MOVE_IN_CHECKLIST_ITEM_DEFS)[number]["key"]

export type MoveInChecklistItemState = {
  key: MoveInChecklistItemKey
  label: string
  complete: boolean
}

export type MoveInChecklistState = {
  items: MoveInChecklistItemState[]
  completeCount: number
  requiredCount: number
  allComplete: boolean
}

export function initMoveInChecklist(): MoveInChecklistState {
  const items = MOVE_IN_CHECKLIST_ITEM_DEFS.map((def) => ({
    key: def.key,
    label: def.label,
    complete: false,
  }))
  return summarizeChecklist(items)
}

export function readMoveInChecklist(metadata: Record<string, unknown> | null | undefined): MoveInChecklistState {
  const raw = metadata?.checklist
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return initMoveInChecklist()
  }
  const itemsRaw = (raw as { items?: unknown }).items
  if (!Array.isArray(itemsRaw)) {
    return initMoveInChecklist()
  }

  const byKey = new Map<MoveInChecklistItemKey, MoveInChecklistItemState>()
  for (const def of MOVE_IN_CHECKLIST_ITEM_DEFS) {
    byKey.set(def.key, { key: def.key, label: def.label, complete: false })
  }

  for (const entry of itemsRaw) {
    if (!entry || typeof entry !== "object") continue
    const key = (entry as { key?: string }).key
    if (!key || !byKey.has(key as MoveInChecklistItemKey)) continue
    byKey.set(key as MoveInChecklistItemKey, {
      key: key as MoveInChecklistItemKey,
      label: byKey.get(key as MoveInChecklistItemKey)!.label,
      complete: (entry as { complete?: boolean }).complete === true,
    })
  }

  return summarizeChecklist([...byKey.values()])
}

function summarizeChecklist(items: MoveInChecklistItemState[]): MoveInChecklistState {
  const completeCount = items.filter((i) => i.complete).length
  const requiredCount = items.length
  return {
    items,
    completeCount,
    requiredCount,
    allComplete: completeCount === requiredCount,
  }
}

export function markMoveInChecklistComplete(
  state: MoveInChecklistState,
): MoveInChecklistState {
  return summarizeChecklist(
    state.items.map((item) => ({ ...item, complete: true })),
  )
}

export function checklistToMetadata(state: MoveInChecklistState): Record<string, unknown> {
  return {
    items: state.items.map((item) => ({
      key: item.key,
      label: item.label,
      complete: item.complete,
    })),
    complete_count: state.completeCount,
    required_count: state.requiredCount,
    all_complete: state.allComplete,
  }
}

export function buildMoveInChecklistSms(input: {
  residentName: string
  companyName?: string | null
  unitLabel?: string | null
  moveInDate?: string | null
}): string {
  const name = input.residentName.trim() || "there"
  const unit = input.unitLabel?.trim()
  const unitPart = unit ? ` for unit ${unit}` : ""
  let datePart = ""
  if (input.moveInDate?.trim()) {
    const formatted = new Date(`${input.moveInDate.trim().slice(0, 10)}T12:00:00`)
      .toLocaleDateString("en-US", { month: "long", day: "numeric" })
    datePart = ` Your move-in date is ${formatted}.`
  }
  const team = input.companyName?.trim()
    ? `This is the property management team at ${input.companyName.trim()}.`
    : "This is the property management team."

  const bullets = MOVE_IN_CHECKLIST_ITEM_DEFS.map((item) => `· ${item.label}`)

  return [
    `Hi ${name},`,
    "",
    team,
    "",
    `Welcome${unitPart}.${datePart}`,
    "",
    "Here is your move-in checklist:",
    ...bullets,
    "",
    "Reply DONE when you've finished these steps, or message us here if you need help.",
  ].join("\n")
}

/** Resident SMS intent for move-in checklist progress. */
export function parseMoveInResidentReply(body: string): "complete_all" | "question" {
  const normalized = body.trim().toLowerCase()
  if (!normalized) return "question"
  if (
    /^(done|complete|completed|finished|all set|yes|yep|ok|okay)\b/.test(normalized) ||
    /\b(all done|checklist done|move.?in complete)\b/.test(normalized)
  ) {
    return "complete_all"
  }
  return "question"
}

export function incompleteChecklistLabels(state: MoveInChecklistState): string[] {
  return state.items.filter((i) => !i.complete).map((i) => i.label)
}
