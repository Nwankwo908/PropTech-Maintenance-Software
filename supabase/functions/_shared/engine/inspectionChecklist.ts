/**
 * Inspection checklist — task state and resident SMS intent parsing.
 */
export const INSPECTION_CHECKLIST_ITEM_DEFS = [
  { key: "notice_sent", label: "Inspection notice sent" },
  { key: "access_confirmed", label: "Unit access confirmed" },
  { key: "inspection_started", label: "Inspection started" },
  { key: "outcome_recorded", label: "Outcome recorded" },
  { key: "follow_up_created", label: "Follow-up work created" },
] as const

export type InspectionChecklistItemKey =
  (typeof INSPECTION_CHECKLIST_ITEM_DEFS)[number]["key"]

export type InspectionChecklistItemState = {
  key: InspectionChecklistItemKey
  label: string
  complete: boolean
}

export type InspectionChecklistState = {
  items: InspectionChecklistItemState[]
  completeCount: number
  requiredCount: number
  allComplete: boolean
}

export type InspectionOutcome =
  | "passed"
  | "failed"
  | "partial"
  | "no_show"
  | "rescheduled"

export function initInspectionChecklist(afterNotice = false): InspectionChecklistState {
  const defaults: Partial<Record<InspectionChecklistItemKey, boolean>> = afterNotice
    ? { notice_sent: true }
    : {}
  const items = INSPECTION_CHECKLIST_ITEM_DEFS.map((def) => ({
    key: def.key,
    label: def.label,
    complete: defaults[def.key] === true,
  }))
  return summarizeChecklist(items)
}

export function readInspectionChecklist(
  metadata: Record<string, unknown> | null | undefined,
): InspectionChecklistState {
  const raw = metadata?.checklist
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return initInspectionChecklist()
  }

  const byKey = new Map<InspectionChecklistItemKey, InspectionChecklistItemState>()
  for (const def of INSPECTION_CHECKLIST_ITEM_DEFS) {
    byKey.set(def.key, { key: def.key, label: def.label, complete: false })
  }

  if (!Array.isArray(raw)) {
    for (const def of INSPECTION_CHECKLIST_ITEM_DEFS) {
      if ((raw as Record<string, unknown>)[def.key] === true) {
        byKey.set(def.key, { ...byKey.get(def.key)!, complete: true })
      }
    }
  } else {
    for (const entry of raw) {
      if (!entry || typeof entry !== "object") continue
      const key = (entry as { key?: string }).key
      if (!key || !byKey.has(key as InspectionChecklistItemKey)) continue
      byKey.set(key as InspectionChecklistItemKey, {
        key: key as InspectionChecklistItemKey,
        label: byKey.get(key as InspectionChecklistItemKey)!.label,
        complete: (entry as { complete?: boolean }).complete === true,
      })
    }
  }

  return summarizeChecklist([...byKey.values()])
}

function summarizeChecklist(items: InspectionChecklistItemState[]): InspectionChecklistState {
  const completeCount = items.filter((i) => i.complete).length
  const requiredCount = items.length
  return {
    items,
    completeCount,
    requiredCount,
    allComplete: completeCount === requiredCount,
  }
}

export function checklistToMetadata(state: InspectionChecklistState): Record<string, unknown> {
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

export function patchInspectionChecklist(
  state: InspectionChecklistState,
  patch: Partial<Record<InspectionChecklistItemKey, boolean>>,
): InspectionChecklistState {
  return summarizeChecklist(
    state.items.map((item) => ({
      ...item,
      complete: patch[item.key] === true ? true : item.complete,
    })),
  )
}

export type InspectionResidentReplyIntent =
  | "start"
  | "complete"
  | "reschedule"
  | "question"

/** Parse resident SMS for inspection progress. */
export function parseInspectionResidentReply(body: string): InspectionResidentReplyIntent {
  const normalized = body.trim().toLowerCase()
  if (!normalized) return "question"

  if (
    /^(start|ready|begin|go)\b/.test(normalized) ||
    /\b(i'?m ready|let'?s start)\b/.test(normalized)
  ) {
    return "start"
  }

  if (
    /^(done|complete|finished|all set)\b/.test(normalized) ||
    /\b(inspection complete|walk.?through done)\b/.test(normalized)
  ) {
    return "complete"
  }

  if (
    /^(reschedule|later|different time)\b/.test(normalized) ||
    /\b(need to reschedule|change the time|can't make it)\b/.test(normalized)
  ) {
    return "reschedule"
  }

  return "question"
}

export function buildInspectionStartGuideSms(input: {
  residentName: string
  unitLabel?: string | null
}): string {
  const name = input.residentName.trim() || "there"
  const unitPhrase = input.unitLabel?.trim()
    ? `Unit ${input.unitLabel.trim()}`
    : "your unit"
  return [
    `Thanks ${name} — let's walk through ${unitPhrase} over text.`,
    "",
    "Reply with any issues you notice (leaks, damage, appliances, etc.).",
    "When you're finished, reply DONE and we'll record the inspection.",
  ].join("\n")
}

export function normalizeInspectionOutcome(value: string | null | undefined): InspectionOutcome | null {
  const normalized = value?.trim().toLowerCase()
  if (
    normalized === "passed" ||
    normalized === "failed" ||
    normalized === "partial" ||
    normalized === "no_show" ||
    normalized === "rescheduled"
  ) {
    return normalized
  }
  return null
}
