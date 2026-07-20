/**
 * Entity Resolution & Root Cause Investigation for Ask Ulo.
 * Specific entities (unit, WO, resident, vendor, property, lease, inspection)
 * must be fully investigated — never answered with portfolio KPIs.
 */

export type ResolvedEntityKind =
  | "unit"
  | "work_order"
  | "resident"
  | "vendor"
  | "property"
  | "lease"
  | "inspection"

export type ResolvedEntity = {
  kind: ResolvedEntityKind
  /** Normalized display label, e.g. "Unit 304", "WO-1234". */
  label: string
  /** Raw token used for matching (unit number, WO id fragment, name). */
  raw: string
}

export type EntityInvestigationPlan = {
  /** True when the question names a specific entity that must be investigated. */
  isEntityInvestigation: boolean
  entities: ResolvedEntity[]
  /** Optional maintenance category hint (plumbing, hvac, …). */
  categoryHint: string | null
  /** What the user wants (why stalled, status, history, …). */
  intentSummary: string
  investigationChecklist: string[]
  rejectsPortfolioData: boolean
  confidence: "high" | "medium" | "low"
}

export const ENTITY_INVESTIGATION_GUIDE = `
## Entity Resolution & Root Cause Investigation (critical)

When the user asks about a specific entity, fully investigate THAT entity before
considering any broader portfolio information.

Specific entities include:
- Unit 304 / Apt 12B
- Work Order WO-1234
- Resident Jane Smith
- Vendor ABC Plumbing
- Maple Heights (a named property)
- Lease L-204
- Inspection INS-45

These questions require entity-specific investigation.
Do NOT answer them with portfolio summaries or nearby dashboard metrics.

### Step 1 — Resolve the entity
Extract every explicit entity from the prompt (unit, work order, resident, vendor,
property, lease, inspection) plus any category (plumbing, HVAC, electrical).
State the investigation intent (e.g. why resolution has not occurred).

### Step 2 — Investigation checklist (do not stop after finding the ticket)
For maintenance questions examine every available signal in the packets:
locate the request(s), current status, status/workflow/vendor history, vendor responses,
SLA / aging, escalations, notes, messages, appointments, photos, invoices,
completion blockers, related / duplicate tickets, previous repairs.

### Step 3 — Root cause (never report only current status)
Identify WHY progress stopped. Possible causes:
vendor never accepted / declined, waiting for landlord approval or resident availability,
part on backorder, insurance pending, work order paused, inspection required first,
duplicate ticket, escalation, no vendor assigned, resident cancelled, unknown.
If the true cause cannot be determined, say exactly what information is missing.

### Step 4 — Explain naturally
Do not list raw fields.
Bad: Status / Assigned / Vendor / Metro Plumbing
Good: "It looks like the repair stalled after it was assigned to Metro Plumbing.
The vendor hasn't accepted the job yet, so no work has been scheduled."

### Step 5 — Why it matters
Always explain operational impact (damage risk, resident satisfaction, compliance, cost).

### Step 6 — Recommend the next action
Recommend the next operational decision based on the actual blocker
(follow up with vendor, reassign, order parts, approve estimate, contact resident,
schedule inspection, escalate).

### Never answer entity questions with portfolio data
If the prompt references a specific unit, work order, resident, vendor, property,
lease, or inspection, do NOT respond with:
portfolio summaries, maintenance totals, property health scores,
general recommendations, or dashboard KPIs.
Those are invalid responses.

### Definition of success
The user should finish believing you explained what stalled on their specific issue —
not that you found a related dashboard card.
`.trim()

const UNIT_RE =
  /\b(?:unit|apt\.?|apartment|suite|#)\s*([A-Za-z]?\d{1,5}[A-Za-z]?)\b/gi

const WORK_ORDER_RE =
  /\b(?:WO[- ]?|#)?([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\b/gi

const WORK_ORDER_SHORT_RE =
  /\b(?:work\s*order|ticket|maintenance\s+request)\s+(?:#|WO[- ]?)?([A-Za-z0-9-]{3,20})\b|\bWO[- ]([A-Za-z0-9]{3,12})\b/gi

const RESIDENT_RE =
  /\b(?:resident|tenant)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\b/g

const VENDOR_RE =
  /\b(?:vendor|contractor)\s+([A-Z][A-Za-z0-9&.'-]*(?:\s+[A-Z][A-Za-z0-9&.'-]*){0,3})/g

const LEASE_RE =
  /\b(?:lease)\s+(?:#|L[- ]?)?([A-Za-z0-9-]{2,20})\b|\bL[- ](\d{2,8})\b/gi

const INSPECTION_RE =
  /\b(?:inspection)\s+(?:#|INS[- ]?)?([A-Za-z0-9-]{2,20})\b|\bINS[- ](\d{2,8})\b/gi

const PROPERTY_AT_RE =
  /\b(?:at|for|of|on)\s+([A-Z][A-Za-z0-9&.' -]{2,40}?)\b(?=\s+(?:unit|apt|apartment|building|property|'s|,|\?|$))/g

const PROPERTY_NAMED_RE =
  /\b(?:at|for|of|on)\s+([A-Z][A-Za-z0-9&.' -]{2,40}?)\s+(?:unit|apt|apartment|building|property)\b/g

const PROPERTY_EXPLICIT_RE =
  /\b(?:property|building)\s+([A-Z][A-Za-z0-9&.' -]{2,40}?)\b(?=\s+(?:unit|apt|'s|,|\?|$))/g

const CATEGORY_RE =
  /\b(plumb(?:ing)?|hvac|heat(?:ing)?|air\s*cond(?:itioning)?|\bac\b|electric(?:al)?|appliances?|roof(?:ing)?|pest|lock(?:s|smith)?|carpentry|paint(?:ing)?|floor(?:ing)?|leak(?:s|ing)?|water\s*heater|furnace)\b/i

const INVESTIGATION_INTENT_RE =
  /\b(why|how\s+come|what(?:'s|\s+is)\s+(?:going\s+on|happening|the\s+(?:status|holdup|blocker))|hasn'?t|have(?:n'?t|\s+not)|not\s+(?:been\s+)?(?:resolv|fix|complet|schedul|accept)|stall(?:ed|ing)?|delay(?:ed|ing)?|stuck|waiting\s+(?:on|for)|root\s+cause|what(?:'s|\s+is)\s+blocking|follow[- ]?up\s+on|status\s+of|look\s+into|investigate)\b/i

const PORTFOLIO_LEAD_RE =
  /^\s*(?:#{1,3}\s*)?(?:quick\s+answer\s*\n+)?(?:you\s+(?:currently\s+)?have\s+)?(?:\*\*)?\d+(?:\*\*)?\s+open\s+(?:maintenance\s+)?(?:work\s*orders?|tickets?|requests?)\b/im

const PORTFOLIO_HEALTH_LEAD_RE =
  /^\s*(?:#{1,3}\s*)?(?:portfolio\s+)?(?:property\s+)?health(?:\s+score)?\b/im

const PORTFOLIO_SUMMARY_RE =
  /\b(across\s+(?:your|the)\s+portfolio|portfolio\s+(?:summary|overview|totals?)|current\s+kpis?|dashboard\s+metrics?|open\s+maintenance\s+tickets?:\s*\d+)\b/i

function pushUnique(entities: ResolvedEntity[], entity: ResolvedEntity) {
  const key = `${entity.kind}:${entity.raw.toLowerCase()}`
  if (entities.some((e) => `${e.kind}:${e.raw.toLowerCase()}` === key)) return
  entities.push(entity)
}

/**
 * Extract explicit entities from a user question.
 */
export function extractEntitiesFromQuestion(question: string): ResolvedEntity[] {
  const q = question.trim()
  const entities: ResolvedEntity[] = []
  if (!q) return entities

  for (const m of q.matchAll(UNIT_RE)) {
    const raw = (m[1] ?? "").trim()
    if (!raw) continue
    pushUnique(entities, { kind: "unit", label: `Unit ${raw}`, raw })
  }

  for (const m of q.matchAll(WORK_ORDER_RE)) {
    const raw = (m[1] ?? "").trim()
    if (!raw) continue
    pushUnique(entities, {
      kind: "work_order",
      label: `WO-${raw.replace(/-/g, "").slice(0, 4).toUpperCase()}`,
      raw,
    })
  }

  for (const m of q.matchAll(WORK_ORDER_SHORT_RE)) {
    const raw = (m[1] ?? m[2] ?? "").trim()
    if (!raw || /^(the|a|an|my|our|this|that)$/i.test(raw)) continue
    pushUnique(entities, {
      kind: "work_order",
      label: /^WO/i.test(raw) ? raw.toUpperCase() : `WO-${raw}`,
      raw,
    })
  }

  for (const m of q.matchAll(RESIDENT_RE)) {
    const raw = (m[1] ?? "").trim()
    if (!raw) continue
    pushUnique(entities, { kind: "resident", label: raw, raw })
  }

  for (const m of q.matchAll(VENDOR_RE)) {
    let raw = (m[1] ?? "").trim().replace(/[.,;:!?]+$/, "")
    // Drop trailing verbs mistakenly captured as part of a title case token
    raw = raw.replace(
      /\s+(Has|Hasn'?t|Have|Haven'?t|Is|Was|For|On|With|Accepted|Declined|Assigned)$/i,
      "",
    ).trim()
    if (!raw || raw.length < 3) continue
    pushUnique(entities, { kind: "vendor", label: raw, raw })
  }

  for (const m of q.matchAll(LEASE_RE)) {
    const raw = (m[1] ?? m[2] ?? "").trim()
    if (!raw) continue
    pushUnique(entities, {
      kind: "lease",
      label: /^L/i.test(raw) ? raw.toUpperCase() : `L-${raw}`,
      raw,
    })
  }

  for (const m of q.matchAll(INSPECTION_RE)) {
    const raw = (m[1] ?? m[2] ?? "").trim()
    if (!raw) continue
    pushUnique(entities, {
      kind: "inspection",
      label: /^INS/i.test(raw) ? raw.toUpperCase() : `INS-${raw}`,
      raw,
    })
  }

  for (const m of q.matchAll(PROPERTY_NAMED_RE)) {
    const raw = (m[1] ?? "").trim().replace(/[.,;:!?]+$/, "")
    if (!raw || raw.length < 3) continue
    if (/^(the|this|that|my|our|a|an)$/i.test(raw)) continue
    pushUnique(entities, { kind: "property", label: raw, raw })
  }

  for (const m of q.matchAll(PROPERTY_AT_RE)) {
    const raw = (m[1] ?? "").trim().replace(/[.,;:!?]+$/, "")
    if (!raw || raw.length < 3) continue
    if (/^(the|this|that|my|our|a|an|unit|apt|apartment)$/i.test(raw)) continue
    // Avoid grabbing "Unit 304" style tokens already captured
    if (/^unit\s+/i.test(raw) || /^\d+$/.test(raw)) continue
    pushUnique(entities, { kind: "property", label: raw, raw })
  }

  for (const m of q.matchAll(PROPERTY_EXPLICIT_RE)) {
    const raw = (m[1] ?? "").trim().replace(/[.,;:!?]+$/, "")
    if (!raw || raw.length < 3) continue
    pushUnique(entities, { kind: "property", label: raw, raw })
  }

  return entities
}

function categoryHint(question: string): string | null {
  const m = question.match(CATEGORY_RE)
  if (!m?.[1]) return null
  const raw = m[1].toLowerCase()
  if (/plumb/.test(raw)) return "plumbing"
  if (/hvac|heat|air\s*cond|\bac\b|furnace/.test(raw)) return "hvac"
  if (/electric/.test(raw)) return "electrical"
  if (/leak|water\s*heater/.test(raw)) return "plumbing"
  return raw.replace(/\s+/g, "_")
}

function maintenanceChecklist(): string[] {
  return [
    "Locate the maintenance request(s) for this entity",
    "Current status",
    "Status / workflow / vendor assignment history",
    "Vendor responses and acceptance",
    "SLA / aging timers",
    "Escalations and internal notes",
    "Messages, appointments, photos, invoices when present",
    "Completion blockers, related / duplicate tickets, previous repairs",
    "Determine root cause — why progress stopped (not status alone)",
    "Explain naturally, why it matters, and the next operational action",
  ]
}

function intentSummaryFor(question: string, entities: ResolvedEntity[]): string {
  if (INVESTIGATION_INTENT_RE.test(question)) {
    return "Determine why resolution / progress has not occurred for the named entity"
  }
  if (entities.some((e) => e.kind === "work_order")) {
    return "Investigate the named work order end-to-end"
  }
  if (entities.some((e) => e.kind === "unit")) {
    return "Investigate maintenance activity for the named unit"
  }
  return "Investigate the named entity with full context before any portfolio view"
}

/**
 * True when the question names a specific entity that must be investigated
 * (not a portfolio ranking like "which units have the most tickets").
 */
export function isEntityInvestigationQuestion(question: string): boolean {
  return classifyEntityInvestigation(question).isEntityInvestigation
}

/**
 * Classify whether this turn requires entity-specific root-cause investigation.
 */
export function classifyEntityInvestigation(question: string): EntityInvestigationPlan {
  const q = question.trim()
  if (!q) {
    return {
      isEntityInvestigation: false,
      entities: [],
      categoryHint: null,
      intentSummary: "",
      investigationChecklist: [],
      rejectsPortfolioData: false,
      confidence: "low",
    }
  }

  // Ranking / portfolio volume questions are NOT single-entity investigations.
  if (
    /\b(which\s+units?|units?\s+with\s+the\s+(?:most|highest|least)|most\s+maintenance\s+(?:requests?|tickets?))\b/i
      .test(q)
  ) {
    return {
      isEntityInvestigation: false,
      entities: [],
      categoryHint: null,
      intentSummary: "",
      investigationChecklist: [],
      rejectsPortfolioData: false,
      confidence: "low",
    }
  }

  if (/\b(which\s+work\s*order|oldest|longest[- ]waiting)\b/i.test(q)) {
    return {
      isEntityInvestigation: false,
      entities: [],
      categoryHint: null,
      intentSummary: "",
      investigationChecklist: [],
      rejectsPortfolioData: false,
      confidence: "low",
    }
  }

  const entities = extractEntitiesFromQuestion(q)
  if (entities.length === 0) {
    return {
      isEntityInvestigation: false,
      entities: [],
      categoryHint: null,
      intentSummary: "",
      investigationChecklist: [],
      rejectsPortfolioData: false,
      confidence: "low",
    }
  }

  const hasInvestigationCue =
    INVESTIGATION_INTENT_RE.test(q) ||
    entities.some(
      (e) =>
        e.kind === "work_order" ||
        e.kind === "unit" ||
        e.kind === "inspection" ||
        e.kind === "lease",
    ) ||
    (entities.length > 0 &&
      /\b(plumb|hvac|repair|leak|ticket|work\s*order|maintenance|issue|vendor|stall|delay|status)\b/i.test(
        q,
      ))

  if (!hasInvestigationCue) {
    return {
      isEntityInvestigation: false,
      entities,
      categoryHint: categoryHint(q),
      intentSummary: "",
      investigationChecklist: [],
      rejectsPortfolioData: false,
      confidence: "low",
    }
  }

  const cat = categoryHint(q)
  return {
    isEntityInvestigation: true,
    entities,
    categoryHint: cat,
    intentSummary: intentSummaryFor(q, entities),
    investigationChecklist: maintenanceChecklist(),
    rejectsPortfolioData: true,
    confidence:
      entities.some((e) => e.kind === "unit" || e.kind === "work_order") &&
      INVESTIGATION_INTENT_RE.test(q)
        ? "high"
        : "medium",
  }
}

/** True when draft looks like a forbidden portfolio substitute. */
export function looksLikePortfolioSubstitute(answer: string): boolean {
  const text = answer.trim()
  if (!text) return true
  if (PORTFOLIO_LEAD_RE.test(text)) return true
  if (PORTFOLIO_HEALTH_LEAD_RE.test(text)) return true
  if (PORTFOLIO_SUMMARY_RE.test(text) && !/\b(unit\s+\d|WO-|stalled|hasn't accepted|root cause)\b/i.test(text)) {
    return true
  }
  return false
}

/**
 * QC: entity investigation answers must not be portfolio KPI dumps.
 */
export function evaluateEntityInvestigationQc(input: {
  question: string
  answer: string
  packetSatisfied?: boolean
}): {
  status: "pass" | "fail" | "warn" | "skip"
  summary: string
  plan: EntityInvestigationPlan
} {
  const plan = classifyEntityInvestigation(input.question)
  if (!plan.isEntityInvestigation) {
    return {
      status: "skip",
      summary: "Not an entity-specific investigation question.",
      plan,
    }
  }

  if (input.packetSatisfied) {
    return {
      status: "pass",
      summary: `Entity investigation packet available for ${plan.entities.map((e) => e.label).join(", ")}.`,
      plan,
    }
  }

  const answer = input.answer.trim()
  if (!answer) {
    return {
      status: "fail",
      summary: "Empty answer — entity not investigated.",
      plan,
    }
  }

  if (
    /\b(do not have|don't have|could not|couldn't|missing|unavailable|not enough data|need .+ to|no (?:open )?ticket|couldn't find)\b/i
      .test(answer) &&
    !looksLikePortfolioSubstitute(answer)
  ) {
    return {
      status: "pass",
      summary: "Answer states missing entity data instead of substituting portfolio KPIs.",
      plan,
    }
  }

  if (looksLikePortfolioSubstitute(answer)) {
    return {
      status: "fail",
      summary:
        "Draft substitutes portfolio totals / health / dashboard KPIs instead of investigating the named entity.",
      plan,
    }
  }

  const entityMentioned = plan.entities.some((e) => {
    const raw = e.raw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    const label = e.label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    return new RegExp(`\\b(${raw}|${label})\\b`, "i").test(answer)
  })

  if (!entityMentioned) {
    return {
      status: "fail",
      summary:
        "Entity investigation answered without naming the requested entity or stating missing data.",
      plan,
    }
  }

  // Prefer root-cause language over bare status dumps.
  const hasRootCauseSignal =
    /\b(because|stalled|hasn't|haven't|waiting for|never accepted|no vendor|blocked|pending|still open|hasn't moved|root cause|what(?:'s| is) missing)\b/i
      .test(answer)
  if (!hasRootCauseSignal && answer.split(/\n/).filter((l) => l.trim()).length <= 4) {
    return {
      status: "warn",
      summary: "Answer names the entity but may be reporting status without root cause.",
      plan,
    }
  }

  return {
    status: "pass",
    summary: `Answer appears to investigate ${plan.entities.map((e) => e.label).join(", ")}.`,
    plan,
  }
}

/** Prompt block for this turn's entity investigation plan. */
export function entityInvestigationPromptBlock(question: string): string {
  const plan = classifyEntityInvestigation(question)
  if (!plan.isEntityInvestigation) return ""
  return (
    `ENTITY_INVESTIGATION:\n` +
    `entities: ${plan.entities.map((e) => `${e.kind}=${e.label}`).join("; ")}\n` +
    (plan.categoryHint ? `category: ${plan.categoryHint}\n` : "") +
    `intent: ${plan.intentSummary}\n` +
    `checklist:\n${plan.investigationChecklist.map((s) => `- ${s}`).join("\n")}\n` +
    `FORBIDDEN: portfolio summaries, open-ticket totals, health scores, dashboard KPIs, generic recommendations.\n` +
    `REQUIRED: root cause (why progress stopped), why it matters, next operational action — or exact missing data.\n`
  )
}
