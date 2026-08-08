/**
 * Move-out checklist — task state and resident SMS intent parsing.
 */
export const MOVE_OUT_CHECKLIST_ITEM_DEFS = [
  { key: "resident_notified", label: "Resident notified" },
  { key: "instructions_delivered", label: "Move-out instructions delivered" },
  { key: "move_out_date_confirmed", label: "Move-out date confirmed" },
  { key: "cleaning_scheduled", label: "Cleaning scheduled" },
  { key: "keys_returned", label: "Keys returned" },
  { key: "inspection_scheduled", label: "Inspection scheduled" },
  { key: "inspection_completed", label: "Inspection completed" },
  { key: "property_ready_for_turnover", label: "Property ready for turnover" },
] as const

export type MoveOutChecklistItemKey = (typeof MOVE_OUT_CHECKLIST_ITEM_DEFS)[number]["key"]

export type MoveOutChecklistItemState = {
  key: MoveOutChecklistItemKey
  label: string
  complete: boolean
}

export type MoveOutChecklistState = {
  items: MoveOutChecklistItemState[]
  completeCount: number
  requiredCount: number
  allComplete: boolean
}

export function initMoveOutChecklist(afterOutreach = false): MoveOutChecklistState {
  const defaults: Partial<Record<MoveOutChecklistItemKey, boolean>> = afterOutreach
    ? { resident_notified: true, instructions_delivered: true }
    : {}
  const items = MOVE_OUT_CHECKLIST_ITEM_DEFS.map((def) => ({
    key: def.key,
    label: def.label,
    complete: defaults[def.key] === true,
  }))
  return summarizeChecklist(items)
}

export function readMoveOutChecklist(
  metadata: Record<string, unknown> | null | undefined,
): MoveOutChecklistState {
  const raw = metadata?.checklist
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return initMoveOutChecklist()
  }

  const byKey = new Map<MoveOutChecklistItemKey, MoveOutChecklistItemState>()
  for (const def of MOVE_OUT_CHECKLIST_ITEM_DEFS) {
    byKey.set(def.key, { key: def.key, label: def.label, complete: false })
  }

  if (!Array.isArray(raw)) {
    for (const def of MOVE_OUT_CHECKLIST_ITEM_DEFS) {
      if ((raw as Record<string, unknown>)[def.key] === true) {
        byKey.set(def.key, { ...byKey.get(def.key)!, complete: true })
      }
    }
  } else {
    for (const entry of raw) {
      if (!entry || typeof entry !== "object") continue
      const key = (entry as { key?: string }).key
      if (!key || !byKey.has(key as MoveOutChecklistItemKey)) continue
      byKey.set(key as MoveOutChecklistItemKey, {
        key: key as MoveOutChecklistItemKey,
        label: byKey.get(key as MoveOutChecklistItemKey)!.label,
        complete: (entry as { complete?: boolean }).complete === true,
      })
    }
  }

  return summarizeChecklist([...byKey.values()])
}

function summarizeChecklist(items: MoveOutChecklistItemState[]): MoveOutChecklistState {
  const completeCount = items.filter((i) => i.complete).length
  const requiredCount = items.length
  return {
    items,
    completeCount,
    requiredCount,
    allComplete: completeCount === requiredCount,
  }
}

export function checklistToMetadata(state: MoveOutChecklistState): Record<string, unknown> {
  const flat: Record<string, unknown> = {
    complete_count: state.completeCount,
    required_count: state.requiredCount,
    all_complete: state.allComplete,
  }
  for (const item of state.items) {
    flat[item.key] = item.complete
  }
  return flat
}

export function patchMoveOutChecklist(
  state: MoveOutChecklistState,
  patch: Partial<Record<MoveOutChecklistItemKey, boolean>>,
): MoveOutChecklistState {
  return summarizeChecklist(
    state.items.map((item) => ({
      ...item,
      complete: patch[item.key] === true ? true : item.complete,
    })),
  )
}

export type MoveOutResidentReplyIntent =
  | "confirm_date"
  | "vacated"
  | "question"

/** Parse resident SMS for move-out progress. */
export function parseMoveOutResidentReply(body: string): MoveOutResidentReplyIntent {
  const normalized = body.trim().toLowerCase()
  if (!normalized) return "question"

  if (
    /^(yes|yep|y|confirmed|confirm|correct|that's right|that is correct)\b/.test(normalized) ||
    /\b(date is correct|confirm.*date|move.?out date)\b/.test(normalized)
  ) {
    return "confirm_date"
  }

  if (
    /^(done|moved out|move out complete|vacated|all set)\b/.test(normalized) ||
    /\b(keys returned|returned the keys|moved out)\b/.test(normalized)
  ) {
    return "vacated"
  }

  return "question"
}

export function buildMoveOutDateConfirmPrompt(moveOutDate: string | null): string {
  if (!moveOutDate?.trim()) {
    return "Please reply YES to confirm your move-out date, or message us here if it needs to change."
  }
  const formatted = new Date(`${moveOutDate.trim().slice(0, 10)}T12:00:00`)
    .toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })
  return `Please reply YES to confirm your move-out date of ${formatted}, or let us know if it needs to change.`
}
