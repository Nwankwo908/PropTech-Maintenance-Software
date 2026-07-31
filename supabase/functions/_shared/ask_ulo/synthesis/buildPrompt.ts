/**
 * buildPrompt — controls what the model receives.
 * Style contracts come from formatAnswer; evidence organization from retrieval.
 * synthesizeAnswer.ts only calls OpenAI with the messages built here.
 */

import type { AskUloIntent } from "../routing/detectIntent.ts"
import type { AskUloToolPackets } from "./toolPackets.ts"
import {
  ANSWER_STYLE_GUIDE,
  RESPONSE_POLISH_GUIDE,
} from "./formatAnswer.ts"
import { trailingStyleConstraints } from "./conversationStyle.ts"
import { styleBlueprintsForIntent } from "./styleBlueprints.ts"
import { synthesizeTemperatureForIntent } from "./synthesizeTemperature.ts"
import {
  PLAIN_LANGUAGE_OPS_GUIDE,
  REASONING_TRANSPARENCY_GUIDE,
} from "./reasoningTransparency.ts"
import { DYNAMIC_RESPONSE_GUIDE } from "../routing/dynamicResponse.ts"
import { REASONING_FIRST_GUIDE } from "../tools/_shared/reasoningFirst.ts"
import {
  TASK_COMPLETION_CONTRACT,
  taskContractPromptBlock,
} from "../tools/maintenance/taskCompletion.ts"
import {
  ENTITY_INVESTIGATION_GUIDE,
  entityInvestigationPromptBlock,
} from "../tools/maintenance/entityInvestigation.ts"
import {
  INVESTIGATION_DEFINITION_GUIDE,
  investigationDefinitionPromptBlock,
} from "../tools/_shared/investigationDefinition.ts"
import {
  RESPONSE_SUFFICIENCY_GUIDE,
  responseSufficiencyPromptBlock,
} from "../quality/checkCompleteness.ts"
import {
  MISSING_INFO_COMMUNICATION_GUIDE,
  missingInfoCommunicationPromptBlock,
} from "../guards/refusalBuilder.ts"
import {
  DEEP_OPERATIONAL_INVESTIGATION_GUIDE,
  deepOperationalInvestigationPromptBlock,
} from "../tools/maintenance/deepOperationalInvestigation.ts"
import { investigationPlaybookPromptBlock } from "../routing/investigationPlaybooks.ts"
import { NEVER_IGNORE_ULO_INTELLIGENCE_GUIDE } from "../retrieval/knowledgeHierarchy.ts"
import { RECURRING_REPAIRS_GUIDE } from "../tools/maintenance/recurringRepairsLookup.ts"
import { REPAIRS_TO_APPROVE_GUIDE } from "../tools/maintenance/repairsToApproveLookup.ts"
import { MISSING_UPDATES_GUIDE } from "../tools/maintenance/missingUpdatesLookup.ts"
import { SUBJECT_MATCH_GUIDE } from "../routing/detectSubject.ts"
import { QUESTION_CONTEXTUALIZATION_GUIDE } from "../tools/_shared/questionMetricContext.ts"
import { VENDOR_RESPONSE_SPEED_GUIDE } from "../tools/vendors/vendorResponseSpeedLookup.ts"
import { VENDOR_BEST_GUIDE } from "../tools/vendors/vendorBestLookup.ts"
import { VENDOR_COMPLETION_GUIDE } from "../tools/vendors/vendorCompletionLookup.ts"
import { VENDOR_INACTIVE_GUIDE } from "../tools/vendors/vendorInactiveLookup.ts"
import { VENDOR_OVERLOAD_GUIDE } from "../tools/vendors/vendorOverloadLookup.ts"
import { fairHousingSynthesizeRules } from "../guards/fairHousingSafety.ts"
import { humanDecisionSynthesizeRules } from "../guards/humanDecisionSafety.ts"
import {
  redactHistoryForExternalAi,
  redactPiiForExternalAi,
} from "../quality/privacyRedact.ts"
import { formatOrganizedEvidenceBlock } from "../retrieval/buildEvidencePacket.ts"

export type AskUloChatMessage = {
  role: "system" | "user" | "assistant"
  content: string
}

export type AskUloBuiltPrompt = {
  messages: AskUloChatMessage[]
  temperature: number
  model: string
}

export const ASK_ULO_ANSWER_MODEL = "gpt-4o"

/** System-prompt style + domain guides (voice lives in formatAnswer ANSWER_STYLE_GUIDE). */
const FORMATTING_GUIDE =
  ANSWER_STYLE_GUIDE +
  "\n\n" +
  "\n\n" +
  // Conversation / anti-slop style is appended AFTER evidence (recency) — not here.
  INVESTIGATION_DEFINITION_GUIDE +
  "\n\n" +
  RESPONSE_SUFFICIENCY_GUIDE +
  "\n\n" +
  MISSING_INFO_COMMUNICATION_GUIDE +
  "\n\n" +
  NEVER_IGNORE_ULO_INTELLIGENCE_GUIDE +
  "\n\n" +
  RECURRING_REPAIRS_GUIDE +
  "\n\n" +
  REPAIRS_TO_APPROVE_GUIDE +
  "\n\n" +
  MISSING_UPDATES_GUIDE +
  "\n\n" +
  SUBJECT_MATCH_GUIDE +
  "\n\n" +
  QUESTION_CONTEXTUALIZATION_GUIDE +
  "\n\n" +
  VENDOR_RESPONSE_SPEED_GUIDE +
  "\n\n" +
  VENDOR_BEST_GUIDE +
  "\n\n" +
  VENDOR_COMPLETION_GUIDE +
  "\n\n" +
  VENDOR_INACTIVE_GUIDE +
  "\n\n" +
  VENDOR_OVERLOAD_GUIDE +
  "\n\n" +
  DEEP_OPERATIONAL_INVESTIGATION_GUIDE +
  "\n\n" +
  TASK_COMPLETION_CONTRACT +
  "\n\n" +
  ENTITY_INVESTIGATION_GUIDE +
  "\n\n" +
  REASONING_FIRST_GUIDE +
  "\n\n" +
  DYNAMIC_RESPONSE_GUIDE +
  "\n\n" +
  REASONING_TRANSPARENCY_GUIDE +
  "\n\n" +
  PLAIN_LANGUAGE_OPS_GUIDE +
  "\n\n" +
  RESPONSE_POLISH_GUIDE

export function intentSectionGuide(
  intent: AskUloIntent,
  opts?: { narrowFactual?: boolean },
): string {
  if (
    opts?.narrowFactual &&
    (intent === "maintenance" || intent === "ops" || intent === "vendor" || intent === "general")
  ) {
    return `
## Narrow factual ops answer
## Quick Answer
## Recommended Next Steps (only if useful)

Lead with the number or fact requested in one short paragraph.
Do NOT expand into a full portfolio health briefing unless the user asked for one.
Example tone: "You currently have 14 open work orders, including 3 critical issues."
`.trim()
  }

  switch (intent) {
    case "property_price_history":
      return `
## Property price history structure (ONLY these sections)
## Price History (table: Date | Event | Price | Change)
## Summary
## What Changed
## Data Source
## Recommended Next Steps

Rules:
- Use the PRICE HISTORY packet as the source of truth.
- Conversational Summary — what it means for the owner. No inventory dumps.
`.trim()
    case "rent_history":
      return `
## Rent history structure (ONLY these sections)
## Rent History (table)
## Summary
## Data Source
## Recommended Next Steps

Rules: Use the RENT HISTORY packet. Do NOT invent rents. Conversational voice.
`.trim()
    case "price_history_ambiguous":
      return `
Ask ONE short clarification question only: sale/valuation history or rental-price history.
Friendly and brief. Do not guess.
`.trim()
    case "market_rent_estimate":
      return `
## Structure
## Quick Answer
## How I got there
## Things to keep in mind (only if needed)
## Recommended Next Steps

Lead with the rent figure in plain English. No Street View. No inventory dump.
`.trim()
    case "comparable_rentals":
      return `
## Structure
## Quick Answer
## Comparable Rentals (UI cards may render below — keep markdown brief)
## Takeaways
## Recommended Next Steps
`.trim()
    case "market_analysis":
      return `
## Market Analysis structure
## Market Summary (lead with the market answer in plain English)
## Estimated Rent Position
## Comparable Rentals (omit detailed list — UI shows comps)
## Neighborhood Insights (only if grounded; otherwise omit)
## Investment Outlook
## Recommended Next Steps

Lead with the live rent estimate. Property context only if it changes pricing advice.
When MARKET DATA.available is false: say so clearly — do not invent comps.
`.trim()
    case "legal":
      return `
## Role
You are an experienced regional property manager. Explain rules in plain English so operators can decide.
You are not a substitute for counsel — but do not announce that in every answer.

## Conversation pattern (required)
1. Answer the question immediately in plain English (what this means for them).
2. Explain why in one short paragraph. Then ## What this means with the hard rules —
   explain first, name the source second. Never paste statute text as the answer.
3. Optional ## Things to keep in mind — only new info that wasn't already said (agency notes,
   recent city updates). Do not repeat Quick Answer warnings here.
4. Optional ## Looking at your property — only facts that change the recommendation; each line
   says why it matters. Omit if nothing changes the advice.
5. ## Recommended Next Steps — human, actionable ("Before you raise rent, I'd recommend:").
6. Include ## You may want a second opinion if... ONLY when LEGAL_GATE.requireCounsel is true OR
   the question involves eviction, fair housing, discrimination, reasonable accommodation,
   lead hazards, or court filings. Otherwise omit it entirely.

## Source priority (internal — do not lecture the user about hierarchy)
1. Laws and court decisions from the official publisher (legislature, issuing court, city/county clerk, .gov code)
2. Local / city / county codes (prefer local over state over federal when both apply)
3. Housing authority / HUD materials (soft advice, not hard law)
4. Building/safety codes when adopted locally
5. Property / maintenance context — never overrides law
Discovery tools (CourtListener, Municode, Justia, LII, etc.) may appear in retrieval packets only as leads.
Never present mirror / aggregator text as the settled rule. If LEGAL packets are empty or only mirrors,
do not invent the law — say you need an official government source first.
Never invent statutes, dollar caps, or notice periods.
Never offer to send notices, reject applicants, change rents, shut off utilities, or file paperwork.

## Voice extras
- Translate packet text. If a packet still has raw keys or [tags], rewrite them — never echo them.
- Summarize Fair Market Rent as a range unless the user asked for each bedroom size.
- Say "Section 8 Housing Choice Voucher" not "Section 8 / HCV".
- Pending ordinance warning (once only): "⚠ A recent city law may not appear on every government website yet. Ulo checked the newest available information."
- Prefer LEGAL_GATE.recommendedExpertId when suggesting who to involve.
- Do NOT use headings: Requirements, Guidance, Portfolio Context, About Your Property, Sources Used,
  This property, When to involve a human expert.
`.trim()
    case "executive_briefing":
    case "property_health":
      return `
## Executive briefing (use when INTENT is executive_briefing / property_health)
Write like a five-minute owner briefing — complete the task; do not dump a single KPI.

Preferred shape for strategic / forward-looking questions
("what should I worry about", "prioritize", "what am I missing", "next 30 days"):

## Next 30 Days  (or Today / This Week — match the user's horizon)
## Overall Risk
Healthy / Moderate / Elevated / At Risk — one short paragraph on portfolio condition.
## Highest Priority
3–6 concrete risks ranked by urgency (repairs, vendors, leases, COI/insurance, inspections, rent).
## Financial Watch  (omit if nothing material)
## Compliance Watch  (omit if nothing material)
## Recommended Actions
Short, owner-ready actions.

Rules:
- Synthesize across domains in the packets (maintenance, vendors, leases/rent, workflows, compliance).
- Never answer with only the open maintenance count.
- Explain why each priority matters (business impact / resident disruption / cost risk).
- If PORTFOLIO BRIEFING provides a health score, you may reference it lightly — do not invent scores.
- Omit empty watch sections. Recommended Actions only for justified findings.
- Do not force Why I reached / Confidence unless a judgment is non-obvious.
`.trim()
    case "period_summary":
      return `
## Period activity summary (REQUIRED — match PERIOD SUMMARY packet)

## This Week at a Glance  (or This Month / Last N Days — match periodLabel)
### Maintenance
### Vendors
### Rent and Leasing
### Needs Your Attention (only if there are items)

Rules:
- Summarize what *happened* in the period — created, completed, vendor actions, rent/leasing, escalations.
- NEVER answer with only the current open maintenance count.
- Use PERIOD SUMMARY as the source of truth. Disclose periodLabel and date range.
- If canSummarize is false / event history missing: say specifically what is unavailable.
- If no meaningful activity: say so clearly — do not pad with unrelated metrics.
- First sentence must begin the summary of the period.
- Skip Why I reached this conclusion / Confidence unless something is uncertain.
`.trim()
    case "property_priority":
      return `
## Property priority / ranking (match REASONING_MODE)

When comparison_ranking or recommendation:
Lead with the top property, why it ranks first, then optional Also Watch.
When diagnosis:
Lead with what's becoming a problem and what's driving it.

Rules:
- Compare buildings using PROPERTY RANKING. Severity before volume.
- NEVER answer with only a portfolio-wide open-ticket total.
- If canRank is false: say what's missing; do not invent a winner.
- Recommended Actions only if justified.
- Do not force Quick Answer / Confidence / Why I reached unless they help.
`.trim()
    case "unit_maintenance_ranking":
      return `
## Unit maintenance volume ranking

## Quick Answer
## Top Units
## What This May Mean (brief)
## Recommended Next Step (one specific action)

Rules:
- Answer units ranked by maintenance-request count using UNIT MAINTENANCE RANKING.
- NEVER answer with the portfolio open-work-order total.
- Include unit label, building, total in window, most common category, currently open.
- Distinguish total vs recent vs currently open; disclose timeframeLabel.
- If canRank is false: say you could not reliably connect requests to units — no fabricated ranking.
- Skip Confidence / Why I reached unless uncertainty needs explaining.
`.trim()
    case "oldest_waiting_work_order":
      return `
## Oldest waiting work order — skimmable advisor briefing

Layout:
1. First sentence answers (issue + unit/property) — no report title
2. Short story with **bold** on days / vendor
3. ## Why it matters
4. ## Details — compact bullets (Property, Unit, Issue, Vendor, Waiting, Status)
5. ## What I'd do — natural "I'd…" advice

Prefer OLDEST WAITING WORK ORDER packet wording when present.
Never lead with WO-IDs or "Longest Waiting Work Order".
Never answer with open-ticket count alone.
`.trim()
    case "entity_investigation":
      return `
## Entity investigation — root cause for the named entity

Layout:
1. First sentence names the entity and what stalled — no portfolio lead-in
2. Short story of the root cause (why progress stopped — not status alone)
3. ## Why it matters
4. ## Details — entity facts only
5. ## What I'd do — next operational decision for the actual blocker

Prefer ENTITY INVESTIGATION packet wording when present.
Never answer with portfolio summaries, open-ticket totals, health scores, or dashboard KPIs.
If data is missing, say exactly what is unavailable.
`.trim()
    case "maintenance":
      return "Maintenance: conversation + issue + risk + next step. Short when the question is short. Human headings only."
    case "finance":
      return "Financial: conversation + numbers + insight. Keep it tight. Advice as natural prose or ## What I'd do."
    case "ops":
    case "vendor":
      return "Answer first in advisor voice. Supporting facts only when they help skim. Never invent busywork."
    default:
      return "Complete the task in advisor voice with skimmable hierarchy. Vary layout by question type. Never expose jargon or robotic section labels."
  }
}


/**
 * Build the full chat payload for OpenAI — sole owner of "what the model receives".
 */
export function buildAskUloPrompt(packets: AskUloToolPackets): AskUloBuiltPrompt {
  const system =
    `You are Ulo, an experienced regional property manager for landlords — a trusted colleague, not a legal report.\n\n` +
    FORMATTING_GUIDE +
    `\n\n` +
    intentSectionGuide(packets.intent, { narrowFactual: Boolean(packets.narrowFactual) })

  const historyRaw = (packets.history ?? [])
    .filter((m) => m.content.trim() && (m.role === "user" || m.role === "assistant"))
    .slice(-12)
  const { history, redacted: historyRedacted } = redactHistoryForExternalAi(historyRaw)
  const questionRedacted = redactPiiForExternalAi(packets.question)

  const organized = packets.evidencePacket
  const hasOrganizedEvidence = Boolean(
    organized &&
      (organized.meta.hasEvidence ||
        organized.internal.length > 0 ||
        organized.legal.length > 0 ||
        organized.market.length > 0 ||
        organized.missing.length > 0),
  )

  const clipDetail = (s: string, max = 3200): string => {
    const t = s.trim()
    if (t.length <= max) return t
    return `${t.slice(0, max)}\n…(truncated)`
  }

  /** Specialty packets that still carry structure the organizer may not fully flatten. */
  const supportingSections: string[] = []
  const pushSection = (title: string, body: string | null | undefined) => {
    if (!body?.trim()) return
    supportingSections.push(`${title}:\n${clipDetail(body)}`)
  }

  if (packets.market && (packets.market.available || packets.market.bullets.length > 0)) {
    pushSection(
      "LIVE MARKET DATA",
      `available: ${packets.market.available}\n` +
        `provider: ${packets.market.provider ?? "none"}\n` +
        `gapNote: ${packets.market.gapNote ?? "(none)"}\n` +
        packets.market.bullets.join("\n"),
    )
  }
  if (packets.priceHistory?.markdown || packets.priceHistory?.available) {
    pushSection(
      "PRICE HISTORY",
      `available: ${packets.priceHistory.available}\n` +
        `needsClarification: ${packets.priceHistory.needsClarification}\n` +
        `gapNote: ${packets.priceHistory.gapNote ?? "(none)"}\n` +
        `markdown:\n${packets.priceHistory.markdown}\n` +
        `bullets:\n${packets.priceHistory.bullets.join("\n")}`,
    )
  }
  if (packets.rentHistory?.markdown || packets.rentHistory?.available) {
    pushSection(
      "RENT HISTORY",
      `available: ${packets.rentHistory.available}\n` +
        `gapNote: ${packets.rentHistory.gapNote ?? "(none)"}\n` +
        `markdown:\n${packets.rentHistory.markdown}\n` +
        `bullets:\n${packets.rentHistory.bullets.join("\n")}`,
    )
  }
  if (packets.portfolioBriefing?.available && packets.portfolioBriefing.markdown) {
    pushSection(
      "PORTFOLIO BRIEFING",
      `assessment: ${packets.portfolioBriefing.assessment}\n` +
        `healthScore: ${packets.portfolioBriefing.healthScore ?? "unavailable"}\n` +
        `markdown:\n${packets.portfolioBriefing.markdown}`,
    )
  }
  if (packets.propertyRanking?.available) {
    pushSection(
      "PROPERTY RANKING",
      `canRank: ${packets.propertyRanking.canRank}\n` +
        `missingData: ${JSON.stringify(packets.propertyRanking.missingData)}\n` +
        `top: ${JSON.stringify(packets.propertyRanking.top)}\n` +
        `watch: ${JSON.stringify(packets.propertyRanking.watch)}\n` +
        `markdown:\n${packets.propertyRanking.markdown}`,
    )
  }
  if (packets.unitMaintenanceRanking?.available) {
    pushSection(
      "UNIT MAINTENANCE RANKING",
      `canRank: ${packets.unitMaintenanceRanking.canRank}\n` +
        `missingData: ${JSON.stringify(packets.unitMaintenanceRanking.missingData)}\n` +
        `timeframeLabel: ${packets.unitMaintenanceRanking.timeframeLabel}\n` +
        `ranked: ${JSON.stringify(packets.unitMaintenanceRanking.ranked?.slice(0, 12))}\n` +
        `markdown:\n${packets.unitMaintenanceRanking.markdown}`,
    )
  }
  if (packets.periodSummary?.available) {
    pushSection(
      "PERIOD SUMMARY",
      `canSummarize: ${packets.periodSummary.canSummarize}\n` +
        `periodLabel: ${packets.periodSummary.periodLabel}\n` +
        `facts: ${JSON.stringify(packets.periodSummary.facts)}\n` +
        `markdown:\n${packets.periodSummary.markdown}`,
    )
  }
  if (packets.oldestWaitingWorkOrder?.available) {
    pushSection(
      "OLDEST WAITING WORK ORDER",
      `found: ${packets.oldestWaitingWorkOrder.found}\n` +
        `oldest: ${JSON.stringify(packets.oldestWaitingWorkOrder.oldest)}\n` +
        `markdown:\n${packets.oldestWaitingWorkOrder.markdown}`,
    )
  }
  if (packets.entityInvestigation?.available) {
    pushSection(
      "ENTITY INVESTIGATION",
      `found: ${packets.entityInvestigation.found}\n` +
        `primary: ${JSON.stringify(packets.entityInvestigation.primary)}\n` +
        `markdown:\n${packets.entityInvestigation.markdown}`,
    )
  }
  if (packets.deepOpsInvestigation?.available && packets.deepOpsInvestigation.found) {
    pushSection(
      "DEEP OPS INVESTIGATION",
      `found: ${packets.deepOpsInvestigation.found}\n` +
        `ticketCount: ${packets.deepOpsInvestigation.ticketCount}\n` +
        `missingFields: ${JSON.stringify(packets.deepOpsInvestigation.missingFields)}\n` +
        `markdown:\n${packets.deepOpsInvestigation.markdown}`,
    )
  }
  if (packets.propertyInsights?.found) {
    pushSection(
      "PROPERTY INSIGHTS",
      `markdown:\n${packets.propertyInsights.markdown}\n` +
        `bullets:\n${packets.propertyInsights.bullets.join("\n")}`,
    )
  }
  if (packets.recurringRepairs?.found) {
    pushSection(
      "RECURRING REPAIRS",
      `markdown:\n${packets.recurringRepairs.markdown}`,
    )
  }
  if (packets.repairsToApprove?.found) {
    pushSection(
      "REPAIRS TO APPROVE",
      `markdown:\n${packets.repairsToApprove.markdown}`,
    )
  }
  if (packets.missingUpdates?.found) {
    pushSection(
      "MISSING UPDATES",
      `markdown:\n${packets.missingUpdates.markdown}`,
    )
  }
  for (const [title, pkt] of [
    ["VENDOR BEST", packets.vendorBest],
    ["VENDOR COMPLETION", packets.vendorCompletion],
    ["VENDOR INACTIVE", packets.vendorInactive],
    ["VENDOR OVERLOAD", packets.vendorOverload],
    ["VENDOR VERIFICATION", packets.vendorVerification],
    ["VENDOR RESPONSE SPEED", packets.vendorResponseSpeed],
  ] as const) {
    if (pkt?.found && pkt.markdown) {
      pushSection(title, `markdown:\n${pkt.markdown}`)
    }
  }
  if (packets.legal?.bullets?.length && !hasOrganizedEvidence) {
    pushSection(
      `LEGAL RAG (${packets.legal.mode})`,
      packets.legal.bullets.join("\n"),
    )
  }
  if (packets.structured?.bullets?.length && !hasOrganizedEvidence) {
    pushSection("STRUCTURED COMPLIANCE", packets.structured.bullets.join("\n"))
  }
  if (packets.ops?.bullets?.length && !hasOrganizedEvidence) {
    pushSection("OPS / LEASING IMPACT", packets.ops.bullets.join("\n"))
  }
  if (packets.property?.bullets?.length && !hasOrganizedEvidence) {
    pushSection("PROPERTY SNAPSHOT", packets.property.bullets.join("\n"))
  }

  const playbookBlock = packets.investigationPlaybook
    ? `id: ${packets.investigationPlaybook.id}; preferTier1=${packets.investigationPlaybook.preferTier1Answer}; deepOpsPrimary=${packets.investigationPlaybook.deepOpsPrimary}`
    : "none"

  const supportingDetail =
    supportingSections.length > 0
      ? (hasOrganizedEvidence
        ? "SUPPORTING DETAIL (secondary — only if ORGANIZED EVIDENCE is incomplete for this ask):\n\n"
        : "RETRIEVAL DETAIL (no organized evidence packet — ground answers here):\n\n") +
        supportingSections.join("\n\n")
      : ""

  const toolBrief =
    `INTENT: ${packets.intent} (${packets.intentLabel}) — answer this goal only.\n` +
    (packets.question ? taskContractPromptBlock(packets.question) : "") +
    (packets.question ? investigationDefinitionPromptBlock(packets.question) : "") +
    (packets.question ? responseSufficiencyPromptBlock(packets.question) : "") +
    missingInfoCommunicationPromptBlock() +
    (packets.question ? investigationPlaybookPromptBlock(packets.question) : "") +
    (packets.question ? deepOperationalInvestigationPromptBlock(packets.question) : "") +
    (packets.question ? entityInvestigationPromptBlock(packets.question) : "") +
    `REASONING_MODE: ${packets.reasoningMode ?? "factual"} — never echo mode/intent labels to the user.\n` +
    `RESPONSE_FORMAT: ${packets.responseFormat ?? "adaptive"} — never echo this label.\n` +
    `INVESTIGATION PLAYBOOK: ${playbookBlock}\n` +
    (hasOrganizedEvidence
      ? "FACT SOURCE: Prefer ORGANIZED EVIDENCE (internal / legal / market / missing). " +
        "Use SUPPORTING DETAIL only for structure the organizer omitted (tables, rankings, deep ticket fields).\n" +
        "Never invent facts that appear under MISSING.\n"
      : "FACT SOURCE: Use RETRIEVAL DETAIL below. Do not invent rents, laws, or rankings.\n") +
    `First sentence must answer or begin completing the user's request.\n` +
    (packets.narrowFactual
      ? "RESPONSE_MODE: narrow_factual — keep Quick Answer short; do not expand into a portfolio briefing.\n"
      : "") +
    (packets.legalGate
      ? `LEGAL_GATE: ${packets.legalGate.status}; officialSourceCount=${packets.legalGate.officialSourceCount}; ` +
        `primaryOfficial=${packets.legalGate.primaryOfficialCount ?? "?"}; ` +
        `agencyGuidance=${packets.legalGate.agencyGuidanceCount ?? "?"}; ` +
        `requireCounsel=${packets.legalGate.requireCounsel ? "true" : "false"}; ` +
        `sensitiveTopics=${
          (packets.legalGate.sensitiveTopics ?? []).map((t) => t.id).join(",") || "none"
        }\n` +
        (packets.legalGate.counselNote
          ? `COUNSEL_NOTE: ${packets.legalGate.counselNote}\n`
          : "")
      : "") +
    `${fairHousingSynthesizeRules(packets.fairHousing ?? null)}\n` +
    `${humanDecisionSynthesizeRules(packets.humanDecision ?? null)}\n` +
    (packets.screeningIsolation
      ? "PRIVACY: screening_isolation=true — criteria-level guidance only; no screening PII.\n"
      : "") +
    `\n` +
    `Jurisdiction context:\n${JSON.stringify(packets.jurisdiction)}\n\n` +
    `Tools used: ${packets.toolsUsed.join(", ") || "none"}\n\n` +
    (organized ? `${formatOrganizedEvidenceBlock(organized)}\n\n` : "") +
    (supportingDetail ? `${supportingDetail}\n` : "")

  const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
    { role: "system", content: system },
  ]

  for (const turn of history) {
    messages.push({
      role: turn.role,
      content: turn.content.slice(0, 4000),
    })
  }

  // Dynamic few-shots only for intents that still go through OpenAI synthesis.
  for (const shot of styleBlueprintsForIntent(packets.intent)) {
    messages.push({
      role: shot.role,
      content: shot.content,
    })
  }

  messages.push({
    role: "user",
    content:
      `${questionRedacted.text}\n\n` +
      `---\n` +
      `Ground the answer in ORGANIZED EVIDENCE when present; use SUPPORTING DETAIL only for missing structure.\n` +
      `Do not invent rents, comps, valuations, or laws. Translate into plain English — never echo raw keys,\n` +
      `tags like [official], usd_per_month, portfolio sample, ops, workflow, or requirement/guidance labels.\n` +
      (questionRedacted.redacted || historyRedacted
        ? `Note: some personal identifiers were redacted before this request for privacy.\n`
        : "") +
      (packets.intent === "legal"
        ? `End legal answers with a short "## Where this applies" covering location, source authority (law vs guidance), and currency when known.\n`
        : "") +
      toolBrief +
      `\n\n---\n` +
      `FINAL STYLE CONSTRAINTS (read last — obey these over any stiff phrasing habits):\n` +
      trailingStyleConstraints(),
  })

  const temperature = synthesizeTemperatureForIntent(packets.intent)
  return {
    messages,
    temperature,
    model: ASK_ULO_ANSWER_MODEL,
  }
}
