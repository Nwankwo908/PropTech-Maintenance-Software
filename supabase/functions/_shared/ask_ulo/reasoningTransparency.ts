/**
 * Reasoning Transparency — plain-English evidence for analytical Ask Ulo answers.
 * Explains why a conclusion makes sense using observable portfolio evidence.
 * Never exposes retrieval, graphs, packets, filters, or other implementation details.
 */

import type { AskUloIntent } from "./intent.ts"
import type { AskUloReasoningMode } from "./reasoningMode.ts"

export type AskUloConfidence = "High" | "Medium" | "Low"

export type TransparencyEvidence = {
  /** Human-readable evidence bullets (what was looked at / found). */
  evidenceLines: string[]
  missing: string[]
  confidence: AskUloConfidence
  confidenceNote: string
  findingLine: string | null
  /** Prefer "Why I reached this conclusion" unless a softer tone fits. */
  sectionTitle: "Why I reached this conclusion" | "Here's what I found" | "Why I'm saying this"
}

export type TransparencyPacketHints = {
  intent: AskUloIntent
  reasoningMode?: AskUloReasoningMode
  narrowFactual?: boolean
  toolsUsed?: string[]
  propertyRanking?: {
    available: boolean
    canRank: boolean
    missingData: string[]
    portfolioOpenWorkOrders: number
    top: {
      building: string
      whyLines?: string[]
      criticalWorkOrders?: number
      escalatedWorkflows?: number
      openWorkOrders?: number
    } | null
  } | null
  unitMaintenanceRanking?: {
    available: boolean
    canRank: boolean
    missingData: string[]
    timeframeLabel: string
    top: {
      unitLabel: string
      building: string
      totalRequests: number
      openRequests: number
    } | null
  } | null
  portfolioBriefing?: {
    available: boolean
    healthScore: number | null
    facts?: Record<string, unknown>
  } | null
  ops?: { bullets: string[] } | null
  property?: { buildingName: string | null; bullets: string[] } | null
  market?: { available: boolean; gapNote: string | null } | null
  priceHistory?: { available: boolean } | null
  rentHistory?: { available: boolean } | null
  legal?: { bullets: string[] } | null
  structured?: { bullets: string[] } | null
}

/** Strip developer / system jargon from landlord-facing text. */
export function humanizeOpsLanguage(raw: string): string {
  let s = raw
  s = s.replace(/\boperations\s+graph\b/gi, "recent property activity")
  s = s.replace(/\bops\s+graph\b/gi, "recent property activity")
  s = s.replace(/\bretrieved\s+packets?\b/gi, "the records available for this analysis")
  s = s.replace(/\bproperty\s+health\s+filter\b/gi, "looking across your portfolio")
  s = s.replace(/\bworkflow\s+signals?\b/gi, "current operational activity")
  s = s.replace(/\bworkflow\s+runs?\b/gi, "active operations")
  s = s.replace(/\bvector\s+search\b/gi, "search")
  s = s.replace(/\bembeddings?\b/gi, "search")
  s = s.replace(/\bretrieval\b/gi, "available information")
  s = s.replace(/\bproperty_priority\b/gi, "priority")
  s = s.replace(/\bunit_maintenance_ranking\b/gi, "unit ranking")
  s = s.replace(/\bexecutive_briefing\b/gi, "portfolio briefing")

  // Industry jargon → the action they represent (unless the landlord used the term first)
  s = s.replace(/\bvendor\s+SLAs?\b/gi, "vendor response deadlines")
  s = s.replace(/\bSLAs?\b/gi, "vendor response deadline")
  s = s.replace(
    /\bescalated\s+workflows?\b/gi,
    "items that require your attention",
  )
  s = s.replace(
    /\bescalated\s+(?:items?|runs?|operations?)\b/gi,
    "items that require your attention",
  )
  s = s.replace(
    /\baging(?:\/overdue)?\s+(?:work\s*orders?|requests?|tickets?)\b/gi,
    "repair requests that have been waiting longer than expected",
  )
  s = s.replace(
    /\baging\s+past\s+the\s+(?:72-hour\s*\/\s*)?due-date\s+target\b/gi,
    "waiting longer than expected",
  )
  s = s.replace(/\bvendor\s+reassignments?\b/gi, "assigning the job to a different vendor")
  s = s.replace(
    /\breassign(?:ing|ed)?\s+(?:the\s+)?vendors?\b/gi,
    "assign the job to a different vendor",
  )
  s = s.replace(/\breassign\s+vendors\b/gi, "assign the job to a different vendor")
  s = s.replace(/\bTriage\b/g, "Review first")
  s = s.replace(/\btriage\b/g, "review first")

  // Soften table-ish missing-data phrases
  s = s.replace(
    /property assignments on open work orders/gi,
    "which properties those maintenance requests belong to",
  )
  s = s.replace(
    /property assignments on active workflows/gi,
    "which properties those active operations belong to",
  )
  s = s.replace(
    /named properties \/ buildings in portfolio/gi,
    "named properties in your portfolio",
  )
  s = s.replace(
    /complete property-level assignments for ranking/gi,
    "property-level maintenance detail needed to compare buildings",
  )
  s = s.replace(
    /Property Health score \(insufficient unit signals\)/gi,
    "enough unit-level detail to compute a portfolio health score",
  )
  // Preserve newlines (answers are markdown); only tidy horizontal runs of spaces.
  return s.replace(/[^\S\n]{2,}/g, " ").replace(/[ \t]+\n/g, "\n").trim()
}

/** Style guide: translate ops jargon into the action it represents. */
export const PLAIN_LANGUAGE_OPS_GUIDE = `
## Plain language (global writing rule)
Avoid industry jargon unless the user specifically used that term first.
Translate operational terms into the action they represent.

Never say → Say instead:
- "SLA" / "vendor SLA" → "vendor response deadline"
- "expected response time expired" → "the vendor response deadline has passed"
- "pending accept" / "waiting on accept" → "hasn't responded yet" / "waiting for the vendor to accept the job"
- "vendor_assigned" → "waiting for the vendor to respond"
- "in_progress" → "work is currently underway"
- "review_required" → "waiting for your approval"
- "workflow escalated" → "this job needs your attention"
- "~3d ago" / "last assigned ~0d" → "about 3 days ago" / "assigned today"
- "Triage" → "review first" or "prioritize"
- "Escalated workflow" → "requires your attention" / "needs your decision"
- "Aging work order" → "repair request that's been waiting longer than expected"
- "Vendor reassignment" → "assign the job to a different vendor"

Lead with the takeaway. Never say "I'm listing…", "I searched…", or "Based on…".

Also prefer: "maintenance request" over "work order" when speaking casually,
"open request" over "ticket", and "looking across your portfolio" over system filter names.
Never say "I found N matching records" — state the operational insight instead.
`.trim()

/** Analytical intents / modes that may include evidence transparency. */
export function requiresReasoningTransparency(input: {
  intent: AskUloIntent
  reasoningMode?: AskUloReasoningMode
  narrowFactual?: boolean
}): boolean {
  // Dynamic responses: never force Why I reached / Confidence onto every answer.
  if (input.narrowFactual) return false
  if (input.intent === "period_summary") return false
  if (input.intent === "unit_maintenance_ranking") return false

  // Only auto-append when ranking/diagnosis answers often omit evidence.
  const mode = input.reasoningMode
  if (mode === "comparison_ranking" || mode === "diagnosis") {
    return input.intent === "property_priority"
  }

  return false
}

function pickSectionTitle(
  hints: TransparencyPacketHints,
): TransparencyEvidence["sectionTitle"] {
  if (hints.reasoningMode === "diagnosis") return "Why I'm saying this"
  if (hints.intent === "legal") return "Why I'm saying this"
  return "Why I reached this conclusion"
}

export function buildTransparencyEvidence(
  hints: TransparencyPacketHints,
): TransparencyEvidence {
  const evidenceLines: string[] = []
  const missing: string[] = []
  const sectionTitle = pickSectionTitle(hints)

  const ranking = hints.propertyRanking
  const unitRanking = hints.unitMaintenanceRanking
  const briefing = hints.portfolioBriefing
  const facts = (briefing?.facts ?? {}) as {
    openWorkOrders?: number
    criticalWorkOrders?: number
    agingWorkOrders?: number
    escalatedWorkflows?: number
    occupancyPct?: number | null
    recurringHotspots?: string[]
  }

  if (unitRanking?.available) {
    evidenceLines.push(
      `maintenance requests by unit over the ${unitRanking.timeframeLabel}`,
    )
    evidenceLines.push("which units those requests belong to")
    evidenceLines.push("most common issue categories and currently open requests")
    if (unitRanking.top) {
      evidenceLines.push(
        `${unitRanking.top.unitLabel} at ${unitRanking.top.building} with ${unitRanking.top.totalRequests} requests (${unitRanking.top.openRequests} currently open)`,
      )
    }
    if (!unitRanking.canRank) {
      for (const m of unitRanking.missingData) missing.push(humanizeOpsLanguage(m))
      if (unitRanking.missingData.length === 0) {
        missing.push("reliable unit assignments on maintenance requests")
      }
    }
  }

  if (ranking?.available) {
    evidenceLines.push(
      "maintenance requests across your properties (including critical and overdue items)",
    )
    evidenceLines.push(
      "active operations that require your attention or are waiting on your decision",
    )
    evidenceLines.push("repeat issues in the last 45 days")
    evidenceLines.push("occupancy pressure and how each property is performing overall")
    if (!ranking.canRank) {
      for (const m of ranking.missingData) missing.push(humanizeOpsLanguage(m))
      if (ranking.missingData.length === 0) {
        missing.push("property-level maintenance detail needed to compare buildings")
      }
    }
  }

  if (briefing?.available) {
    evidenceLines.push("how your portfolio is performing overall")
    evidenceLines.push("open, critical, and overdue maintenance requests")
    evidenceLines.push("active operations and anything that requires your attention")
    evidenceLines.push("recurring maintenance patterns")
    evidenceLines.push("recent automatic actions Ulo already took for you")
    if (briefing.healthScore == null) {
      missing.push("enough unit-level detail to compute a portfolio health score")
    }
  }

  if (
    hints.ops?.bullets.length &&
    !ranking?.available &&
    !unitRanking?.available &&
    !briefing?.available
  ) {
    evidenceLines.push("current open maintenance and operational activity")
  }

  if (hints.property?.bullets.length) {
    evidenceLines.push(
      hints.property.buildingName
        ? `details for ${hints.property.buildingName}`
        : "details for the property in focus",
    )
  }

  if (hints.market) {
    if (hints.market.available) {
      evidenceLines.push("nearby rental listings and market rent estimates")
    } else {
      missing.push(
        humanizeOpsLanguage(hints.market.gapNote ?? "live rental market comps for this area"),
      )
    }
  }

  if (hints.priceHistory) {
    if (hints.priceHistory.available) {
      evidenceLines.push("sale and valuation history for the property")
    } else {
      missing.push("sale and valuation history for the named property")
    }
  }

  if (hints.rentHistory) {
    if (hints.rentHistory.available) {
      evidenceLines.push("how rent has changed over time")
    } else {
      missing.push("rent history for the named property")
    }
  }

  if (hints.legal?.bullets.length || hints.structured?.bullets.length) {
    evidenceLines.push("the applicable local and state rules for this question")
  }

  const uniq = (xs: string[]) => {
    const seen = new Set<string>()
    const out: string[] = []
    for (const x of xs) {
      const k = x.toLowerCase()
      if (seen.has(k)) continue
      seen.add(k)
      out.push(x)
    }
    return out
  }

  const evidenceU = uniq(evidenceLines).map(humanizeOpsLanguage)
  const missingU = uniq(missing).map(humanizeOpsLanguage)

  let confidence: AskUloConfidence = "Medium"
  let confidenceNote =
    "I had access to the maintenance and property activity available for this request."

  if (unitRanking) {
    if (unitRanking.canRank && unitRanking.top) {
      confidence = missingU.length === 0 ? "High" : "Medium"
      confidenceNote =
        confidence === "High"
          ? `I had access to maintenance requests linked to units for the ${unitRanking.timeframeLabel}.`
          : `I could rank units by request volume, but some detail was incomplete (${missingU.slice(0, 2).join("; ")}).`
    } else {
      confidence = "Low"
      confidenceNote =
        "I could see maintenance activity, but I could not reliably connect requests to individual units."
    }
  } else if (ranking) {
    if (ranking.canRank && ranking.top) {
      confidence = missingU.length === 0 ? "High" : "Medium"
      confidenceNote =
        confidence === "High"
          ? "I had access to all maintenance requests, active operations, and recent property activity needed to compare your buildings."
          : `I could compare your properties, but some detail was incomplete (${missingU.slice(0, 2).join("; ")}).`
    } else {
      confidence = "Low"
      confidenceNote =
        "I could only review portfolio totals rather than full property-level detail, so I couldn't reliably rank your buildings."
    }
  } else if (briefing?.available) {
    const open = facts.openWorkOrders ?? 0
    confidence = briefing.healthScore != null && missingU.length === 0 ? "High" : "Medium"
    if (confidence === "High") {
      confidenceNote =
        open === 0
          ? "I had access to all maintenance requests, active operations, and recent property activity for the selected period."
          : "I had access to all maintenance requests, active operations, and recent property activity for your portfolio."
    } else if (missingU.length) {
      confidenceNote = `Some historical or unit-level detail was unavailable (${missingU.slice(0, 2).join("; ")}), so treat secondary metrics carefully.`
    } else {
      confidenceNote =
        "I could identify current issues, but some longer-term portfolio detail was limited."
    }
  } else if (hints.market?.available || hints.priceHistory?.available || hints.rentHistory?.available) {
    confidence = missingU.length === 0 ? "High" : "Medium"
    confidenceNote =
      confidence === "High"
        ? "I had the market and history records needed for this question."
        : `Some requested history was unavailable (${missingU.slice(0, 2).join("; ")}).`
  } else if (hints.legal?.bullets.length || hints.structured?.bullets.length) {
    confidence = "High"
    confidenceNote =
      "I had the applicable rules and compliance records for the jurisdiction in this question."
  } else if (evidenceU.length === 0) {
    confidence = "Low"
    confidenceNote =
      "I could only review summary information, so I couldn't reliably complete this analysis."
    if (missingU.length === 0) {
      missingU.push("enough maintenance and property activity for a full analysis")
    }
  } else if (missingU.length > 0) {
    confidence = "Medium"
    confidenceNote = `I could review what was available, but ${missingU[0]} was incomplete.`
  } else {
    confidence = "High"
    confidenceNote =
      "I had access to all maintenance requests, active operations, and recent property activity needed for this analysis."
  }

  let findingLine: string | null = null
  if (unitRanking?.canRank && unitRanking.top) {
    findingLine =
      `**${unitRanking.top.unitLabel}** at **${unitRanking.top.building}** generated the most maintenance requests in the ${unitRanking.timeframeLabel} (${unitRanking.top.totalRequests} total; ${unitRanking.top.openRequests} currently open).`
  } else if (unitRanking && !unitRanking.canRank) {
    findingLine =
      "I found maintenance activity for the portfolio, but I could not reliably connect the requests to individual units."
  } else if (ranking?.canRank && ranking.top) {
    const why = (ranking.top.whyLines ?? []).slice(0, 2)
    findingLine =
      why.length > 0
        ? `**${ranking.top.building}** stands out because ${why.join("; ").replace(/\.$/, "")}.`
        : `**${ranking.top.building}** stands out with the strongest mix of urgency and business impact across your properties.`
  } else if (ranking && !ranking.canRank) {
    findingLine =
      ranking.portfolioOpenWorkOrders > 0
        ? `I can see **${ranking.portfolioOpenWorkOrders}** open maintenance requests across the portfolio, but I couldn't compare buildings without property-level detail.`
        : "I couldn't compare your properties because property-level maintenance detail wasn't available."
  } else if (briefing?.available) {
    const open = facts.openWorkOrders ?? 0
    if (open === 0 && (facts.criticalWorkOrders ?? 0) === 0) {
      findingLine =
        "Looking across your portfolio, I didn't find open maintenance activity that forms a meaningful problem right now."
    } else if (briefing.healthScore != null) {
      findingLine = `Looking across your portfolio, overall performance is around **${briefing.healthScore}/100**, with the pressure points called out above.`
    } else {
      findingLine =
        "Looking across your portfolio, the main pressure points are the open and aging items above."
    }
  } else if (evidenceU.length > 0) {
    findingLine =
      "That conclusion comes from the maintenance and property activity available for this analysis — not a generic template."
  }

  return {
    evidenceLines: evidenceU,
    missing: missingU,
    confidence,
    confidenceNote,
    findingLine,
    sectionTitle,
  }
}

/**
 * Markdown: Why I reached this conclusion → Confidence.
 * Finding/evidence first; never expose system jargon.
 */
export function formatReasoningTransparencyMarkdown(
  evidence: TransparencyEvidence,
): string {
  const parts: string[] = []

  parts.push(`## ${evidence.sectionTitle}`)
  if (evidence.evidenceLines.length === 0 && evidence.missing.length > 0) {
    parts.push(
      `I couldn't complete this analysis because ${evidence.missing.join("; ")}.`,
    )
  } else {
    if (evidence.findingLine) {
      parts.push(evidence.findingLine)
      parts.push("")
    }
    parts.push("I looked at:")
    for (const item of evidence.evidenceLines.slice(0, 6)) {
      parts.push(`- ${item}`)
    }
  }

  if (evidence.missing.length > 0 && evidence.evidenceLines.length > 0) {
    parts.push("")
    parts.push("What I couldn't fully review:")
    for (const m of evidence.missing.slice(0, 4)) {
      parts.push(`- ${m}`)
    }
  }

  parts.push("")
  parts.push("## Confidence")
  parts.push(`**${evidence.confidence}**`)
  parts.push("")
  parts.push(evidence.confidenceNote)

  return parts.join("\n")
}

/** Append transparency to an analytical answer (evidence before recommendations). */
export function appendReasoningTransparency(
  answerMarkdown: string,
  hints: TransparencyPacketHints,
): string {
  if (!requiresReasoningTransparency(hints)) return answerMarkdown
  // Already has a landlord-facing evidence section (new or legacy heading).
  if (
    /## (Why I reached this conclusion|Here's what I found|Why I'm saying this|How I analyzed this)\b/i.test(
      answerMarkdown,
    )
  ) {
    return answerMarkdown
  }

  const evidence = buildTransparencyEvidence(hints)
  const block = formatReasoningTransparencyMarkdown(evidence)

  const nextStepRe =
    /\n## (Recommended (?:Next Steps|Actions)|What Ulo Handled|Also Watch)\b/i
  const m = answerMarkdown.match(nextStepRe)
  if (m && m.index != null) {
    return (
      answerMarkdown.slice(0, m.index) +
      "\n\n" +
      block +
      answerMarkdown.slice(m.index)
    )
  }
  return `${answerMarkdown.trimEnd()}\n\n${block}`
}

/** System-prompt rules for OpenAI synthesis — landlord voice, no implementation details. */
export const REASONING_TRANSPARENCY_GUIDE = `
## Advisor voice + evidence (when useful — not every answer)
Write like an experienced regional property manager advising a landlord colleague.
Never sound like a database, API, analytics dashboard, or LLM.

### Never expose to the landlord
retrieval, packets, graphs, filters, vector search, embeddings, prompt routing,
database tables, workflow signals (as a phrase), "Operations Graph", "Property Health filter",
INTENT labels, or other implementation details.

### Do NOT force these sections on every answer
Skip unless they improve THIS specific answer:
- Why I reached this conclusion
- Confidence
- Recommended Next Steps / Quick Answer

When you do explain evidence, name the actual data:
"I reviewed 18 workflow events and 12 maintenance requests between July 6 and July 12."
Avoid filler: "That conclusion comes from the maintenance and property activity available for this analysis."

### When ranking or diagnosing properties
Lead with the finding, then brief evidence (counts, properties, severity).
Recommend action ONLY if findings justify it.
If nothing meaningful is wrong: say **No action is needed right now**.

### Missing data
If required information isn't available, say so clearly and do not invent trends or rankings.

### Never
- Bare ticket/property counts or one KPI as a substitute for the asked task
- Generic filler recommendations
- Industry jargon (SLA, triage, escalated workflow, aging WO) unless the user said it first
`.trim()
