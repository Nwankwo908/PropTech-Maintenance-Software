/**
 * Deliberate safety boundaries: Ulo explains and recommends; it does not
 * auto-execute consequential landlord actions that should stay human-controlled.
 */

export type AskUloBlockedActionId =
  | "eviction_notice"
  | "reject_applicant"
  | "change_rent"
  | "shutoff_utilities"
  | "file_legal_paperwork"
  | "lockout"

export type AskUloBlockedAction = {
  id: AskUloBlockedActionId
  label: string
}

/** Imperative / “do it for me” cues — not “explain how / what does the law say”. */
const AUTO_EXEC_RE =
  /\b((?:please\s+)?(?:just\s+)?(?:go\s+ahead\s+and\s+)?(?:send|file|submit|execute|issue|serve|mail|email|text|deliver|post)|automatically\s+(?:send|file|reject|deny|change|raise|lower|shut)|do\s+it\s+for\s+me|on\s+my\s+behalf|take\s+care\s+of\s+(?:this|that|it)|handle\s+(?:this|that|it)\s+for\s+me|(?:reject|deny|approve)\s+(?:this|the|that)\s+applicant\s+now|change\s+(?:the\s+)?rent\s+(?:to|now)|shut\s+(?:off|down)\s+(?:the\s+)?(?:water|gas|electric|power|utilities))\b/i

const EXPLAIN_ONLY_RE =
  /\b(what\s+(?:does|do|is|are)|explain|how\s+(?:do|does|should|can)\s+i|what\s+(?:notice|law|rule|requirement)|am\s+i\s+(?:allowed|required)|help\s+me\s+understand|tell\s+me\s+about)\b/i

/** Draft / template writing — not execution of the underlying consequential action. */
const DRAFT_ONLY_RE =
  /\b(draft|write|compose|prepare|create)\b.{0,48}\b(notice|message|email|letter|template|checklist|reminder|response)\b/i

const ACTIONS: Array<{
  id: AskUloBlockedActionId
  label: string
  re: RegExp
}> = [
  {
    id: "eviction_notice",
    label: "send or serve eviction / quit notices",
    re: /\b((?:eviction|quit|vacate|pay\s+or\s+quit|notice\s+to\s+(?:quit|vacate)|unlawful\s+detainer)\s*(?:notice|letter|paperwork)?|(?:notice|letter)\s+(?:of\s+)?eviction)\b/i,
  },
  {
    id: "reject_applicant",
    label: "reject or deny rental applicants",
    re: /\b((?:reject|deny|decline)\s+(?:(?:this|the|that|an?)\s+)?(?:rental\s+)?(?:applicant|application)|adverse\s+action\s+(?:letter|notice)|turn\s+(?:this\s+)?applicant\s+down)\b/i,
  },
  {
    id: "change_rent",
    label: "change rent prices",
    re: /\b((?:change|raise|lower|increase|decrease|set|update)\s+(?:the\s+)?(?:rent|monthly\s+rent|rental\s+rate)|rent\s+(?:increase|decrease)\s+(?:notice\s+)?(?:now|for\s+me|automatically))\b/i,
  },
  {
    id: "shutoff_utilities",
    label: "shut off utilities",
    re: /\b((?:shut\s*(?:ting)?\s*off|turn\s*off|cut\s*off|disconnect)\s+(?:the\s+)?(?:water|gas|electric(?:ity)?|power|utilities|utility)|(?:water|utility)\s+shut[\s-]?off\s+notice)\b/i,
  },
  {
    id: "file_legal_paperwork",
    label: "file legal paperwork",
    re: /\b(file\s+(?:an?\s+)?(?:eviction|unlawful\s+detainer|court|lawsuit|complaint|legal\s+paperwork)|submit\s+(?:court|legal)\s+(?:filing|paperwork)|file\s+with\s+(?:the\s+)?court)\b/i,
  },
  {
    id: "lockout",
    label: "lock out a tenant",
    re: /\b(lock\s*out|change\s+(?:the\s+)?locks|self[\s-]?help\s+eviction)\b/i,
  },
]

export type AskUloActionBoundary = {
  blocked: boolean
  actions: AskUloBlockedAction[]
  reason: "auto_execute_request" | null
}

export function detectAskUloActionBoundary(text: string): AskUloActionBoundary {
  const corpus = text.trim()
  if (!corpus) {
    return { blocked: false, actions: [], reason: null }
  }

  // Pure explain / research questions stay allowed even if they mention eviction, rent, etc.
  if (EXPLAIN_ONLY_RE.test(corpus) && !AUTO_EXEC_RE.test(corpus)) {
    return { blocked: false, actions: [], reason: null }
  }

  // "Draft a water shutoff notice" is writing help — not shutting off utilities.
  if (
    DRAFT_ONLY_RE.test(corpus) &&
    !/\b(send|serve|file|mail|deliver|execute)\b.{0,24}\b(notice|eviction|letter)\b/i.test(corpus)
  ) {
    return { blocked: false, actions: [], reason: null }
  }

  const matched: AskUloBlockedAction[] = []
  for (const a of ACTIONS) {
    if (a.re.test(corpus)) matched.push({ id: a.id, label: a.label })
  }
  if (matched.length === 0) {
    return { blocked: false, actions: [], reason: null }
  }

  const wantsAuto = AUTO_EXEC_RE.test(corpus)
  // Strong standalone imperatives already covered by AUTO_EXEC_RE for most cases;
  // lockout / shutoff / file-with-court often are inherently action requests.
  const inherentlyAction =
    matched.some((m) =>
      m.id === "lockout" ||
      m.id === "shutoff_utilities" ||
      m.id === "file_legal_paperwork"
    ) && !EXPLAIN_ONLY_RE.test(corpus) && !DRAFT_ONLY_RE.test(corpus)

  if (!wantsAuto && !inherentlyAction) {
    return { blocked: false, actions: [], reason: null }
  }

  return {
    blocked: true,
    actions: matched,
    reason: "auto_execute_request",
  }
}

export function formatActionBoundaryMarkdown(boundary: AskUloActionBoundary): string {
  const labels =
    boundary.actions.length > 0
      ? boundary.actions.map((a) => a.label).join("; ")
      : "that consequential action"

  return [
    "## I keep you in control",
    `I won’t automatically **${labels}**. That’s a deliberate safety choice — people stay accountable for high-stakes decisions that can affect tenants and fair-housing risk.`,
    "",
    "## What I can do instead",
    "- Explain what the law or local rules say (with jurisdiction + sources).",
    "- Flag risks and what to double-check.",
    "- Organize the facts and recommend clear next steps for you to take.",
    "- Draft a notice or checklist for you to review and send yourself.",
    "",
    "## Next Steps",
    "- Ask me to explain the rule or checklist for this situation.",
    "- Ask me to **draft** the notice — I’ll write it; you stay in control of sending it.",
    "- When you’re ready to act, do it yourself (or with counsel) — I’ll help you prepare, not execute.",
  ].join("\n")
}
