/**
 * Synthesize Ask Ulo answer from tool packets (OpenAI gpt-4o or deterministic fallback).
 * Answers follow user intent — never dump unrelated ops/legal packets.
 */

import type { AskUloIntent } from "./intent.ts"
import type { AskUloReasoningMode } from "./reasoningMode.ts"
import {
  appendReasoningTransparency,
  humanizeOpsLanguage,
  PLAIN_LANGUAGE_OPS_GUIDE,
  REASONING_TRANSPARENCY_GUIDE,
  type TransparencyPacketHints,
} from "./reasoningTransparency.ts"
import { DYNAMIC_RESPONSE_GUIDE, type AskUloResponseFormat } from "./dynamicResponse.ts"
import { REASONING_FIRST_GUIDE } from "./reasoningFirst.ts"
import {
  TASK_COMPLETION_CONTRACT,
  taskContractPromptBlock,
} from "./taskCompletion.ts"
import {
  ENTITY_INVESTIGATION_GUIDE,
  entityInvestigationPromptBlock,
} from "./entityInvestigation.ts"
import {
  INVESTIGATION_DEFINITION_GUIDE,
  investigationDefinitionPromptBlock,
} from "./investigationDefinition.ts"
import {
  RESPONSE_SUFFICIENCY_GUIDE,
  responseSufficiencyPromptBlock,
} from "./responseSufficiency.ts"
import {
  MISSING_INFO_COMMUNICATION_GUIDE,
  missingInfoCommunicationPromptBlock,
  incompleteEntityRootCauseAnswer,
  incompleteOldestWaitingAnswer,
} from "./missingInfoCommunication.ts"
import {
  resolveIncompleteRankingSignal,
  buildPropertyRankingIncompleteSignal,
  buildUnitRankingIncompleteSignal,
} from "./incompleteEvidence.ts"
import {
  DEEP_OPERATIONAL_INVESTIGATION_GUIDE,
  deepOperationalInvestigationPromptBlock,
} from "./deepOperationalInvestigation.ts"
import {
  investigationPlaybookPromptBlock,
} from "./investigationPlaybooks.ts"
import { NEVER_IGNORE_ULO_INTELLIGENCE_GUIDE } from "./knowledgeHierarchy.ts"
import { RECURRING_REPAIRS_GUIDE } from "./recurringRepairsLookup.ts"
import { REPAIRS_TO_APPROVE_GUIDE } from "./repairsToApproveLookup.ts"
import { MISSING_UPDATES_GUIDE } from "./missingUpdatesLookup.ts"
import {
  SUBJECT_MATCH_GUIDE,
  detectQuestionSubject,
} from "./questionSubjectMatch.ts"
import {
  QUESTION_CONTEXTUALIZATION_GUIDE,
  isAnyVendorMetricQuestion,
} from "./questionMetricContext.ts"
import {
  VENDOR_RESPONSE_SPEED_GUIDE,
} from "./vendorResponseSpeedLookup.ts"
import {
  VENDOR_BEST_GUIDE,
} from "./vendorBestLookup.ts"
import {
  VENDOR_COMPLETION_GUIDE,
} from "./vendorCompletionLookup.ts"
import {
  VENDOR_INACTIVE_GUIDE,
} from "./vendorInactiveLookup.ts"
import {
  VENDOR_OVERLOAD_GUIDE,
} from "./vendorOverloadLookup.ts"
import { trailingStyleConstraints } from "./conversationStyle.ts"
import { RESPONSE_POLISH_GUIDE, polishAskUloProse } from "./responsePolish.ts"
import { styleBlueprintsForIntent } from "./styleBlueprints.ts"
import { synthesizeTemperatureForIntent } from "./synthesizeTemperature.ts"
import {
  formatCounselHandoffMarkdown,
  type CounselExpertRoleId,
} from "./counselHandoff.ts"
import type { FairHousingSafety } from "./fairHousingSafety.ts"
import { fairHousingSynthesizeRules } from "./fairHousingSafety.ts"
import type { HumanDecisionSafety } from "./humanDecisionSafety.ts"
import { humanDecisionSynthesizeRules } from "./humanDecisionSafety.ts"
import { formatLegalAttributionMarkdown } from "./legalAnswerAttribution.ts"
import {
  redactHistoryForExternalAi,
  redactPiiForExternalAi,
} from "./privacyRedact.ts"
import { classifyLegalSourceTrust } from "./legalSourceTrust.ts"
import type { AskUloCitation } from "./opsGraphLookup.ts"
import type { PriceHistoryEvent } from "./propertyPriceHistory.ts"

export type AskUloHistoryMessage = {
  role: "user" | "assistant"
  content: string
}

export type AskUloTokenUsage = {
  promptTokens: number | null
  completionTokens: number | null
  totalTokens: number | null
}

export type AskUloSynthesis = {
  answer: string
  citations: AskUloCitation[]
  mode: "openai" | "fallback"
  model: string | null
  usage: AskUloTokenUsage | null
  synthesizeMs: number | null
}

export type AskUloToolPackets = {
  question: string
  history?: AskUloHistoryMessage[]
  intent: AskUloIntent
  intentLabel: string
  jurisdiction: {
    countryCode?: string | null
    stateCode: string | null
    countySlug?: string | null
    countyLabel?: string | null
    cityLabel: string | null
    citySlug: string | null
    courtSystem?: string | null
    housingProgram?: string | null
    codeSet?: string | null
  }
  /** Legal intent gate: clarify location or refuse ungrounded answers. */
  legalGate?: {
    status: "ok" | "clarify" | "refuse"
    markdown: string
    officialSourceCount: number
    primaryOfficialCount?: number
    agencyGuidanceCount?: number
    sensitiveTopics?: Array<{ id: string; label: string }>
    requireCounsel?: boolean
    counselNote?: string | null
    recommendedExpertId?: CounselExpertRoleId | null
  } | null
  /** Soft Fair Housing / screening refuse-decision (hard blocks return earlier). */
  fairHousing?: FairHousingSafety | null
  /** Soft refuse for accommodation / eviction strategy / DV / retaliation outcomes. */
  humanDecision?: HumanDecisionSafety | null
  /** When true, omit live ops packets (screening PII isolation). */
  screeningIsolation?: boolean
  ops?: { bullets: string[]; citations: AskUloCitation[] } | null
  legal?: {
    bullets: string[]
    citations: AskUloCitation[]
    mode: string
    pendingOrdinanceCount?: number
  } | null
  structured?: { bullets: string[]; citations: AskUloCitation[]; facts: unknown[] } | null
  property?: {
    bullets: string[]
    citations: AskUloCitation[]
    buildingName: string | null
  } | null
  market?: {
    available: boolean
    provider: "rentcast" | "zillow_rapidapi" | "zillow_research" | null
    bullets: string[]
    citations: AskUloCitation[]
    gapNote: string | null
    estimatedRent: number | null
    rentRangeLow: number | null
    rentRangeHigh: number | null
  } | null
  priceHistory?: {
    available: boolean
    bullets: string[]
    citations: AskUloCitation[]
    events: PriceHistoryEvent[]
    summary: {
      lastSale: number | null
      lastSaleDate: string | null
      currentEstimate: number | null
      appreciationSinceSalePct: number | null
      avgAnnualAppreciationPct: number | null
    }
    drivers: string[]
    gapNote: string | null
    needsClarification: boolean
    clarificationPrompt: string | null
    markdown: string
  } | null
  rentHistory?: {
    available: boolean
    bullets: string[]
    citations: AskUloCitation[]
    gapNote: string | null
    markdown: string
  } | null
  /** Executive portfolio briefing (broad ops / health questions). */
  portfolioBriefing?: {
    available: boolean
    assessment: string
    healthScore: number | null
    healthDelta4w: number | null
    bullets: string[]
    citations: AskUloCitation[]
    markdown: string
    facts: Record<string, unknown>
  } | null
  /** Property-level ranking for comparison / prioritization / diagnosis. */
  propertyRanking?: {
    available: boolean
    canRank: boolean
    missingData: string[]
    bullets: string[]
    citations: AskUloCitation[]
    markdown: string
    portfolioOpenWorkOrders: number
    top: {
      building: string
      whyLines: string[]
      recommendedActions: string[]
      openWorkOrders: number
      criticalWorkOrders: number
      agingWorkOrders: number
      escalatedWorkflows: number
      healthScore: number | null
      healthDelta4w: number | null
    } | null
    watch: Array<{ building: string; whyLines: string[]; openWorkOrders: number }>
  } | null
  /** Unit-level maintenance request volume ranking. */
  unitMaintenanceRanking?: {
    available: boolean
    canRank: boolean
    missingData: string[]
    bullets: string[]
    citations: AskUloCitation[]
    markdown: string
    timeframeLabel: string
    timeframeDays: number
    timeframeIsDefault: boolean
    scopeLabel: string
    unlinkedRequestCount: number
    scopedRequestCount: number
    openInScope: number
    top: {
      unitLabel: string
      building: string
      totalRequests: number
      recentRequests: number
      openRequests: number
      mostCommonCategory: string | null
    } | null
    ranked: Array<{
      unitLabel: string
      building: string
      totalRequests: number
      recentRequests: number
      openRequests: number
      mostCommonCategory: string | null
    }>
  } | null
  /** Period activity summary (this week / this month). */
  periodSummary?: {
    available: boolean
    canSummarize: boolean
    missingData: string[]
    bullets: string[]
    citations: AskUloCitation[]
    markdown: string
    periodLabel: string
    periodDays: number
    periodIsDefault: boolean
    scopeLabel: string
    facts: Record<string, unknown>
  } | null
  /** Oldest unresolved work order (longest waiting). */
  oldestWaitingWorkOrder?: {
    available: boolean
    found: boolean
    missingData: string[]
    bullets: string[]
    citations: AskUloCitation[]
    markdown: string
    openCount: number
    oldest: {
      displayId: string
      building: string
      unit: string | null
      issueCategory: string
      description: string | null
      status: string
      daysWaiting: number
      vendorName: string | null
      reasonWaiting: string
      recommendedAction: string
    } | null
  } | null
  /** Named-entity root-cause investigation (Unit 304, WO-1234, …). */
  entityInvestigation?: {
    available: boolean
    found: boolean
    missingData: string[]
    bullets: string[]
    citations: AskUloCitation[]
    markdown: string
    primary: {
      displayId: string
      building: string
      unit: string | null
      issueCategory: string
      description: string | null
      status: string
      daysOpen: number
      vendorName: string | null
      rootCause: string
      recommendedAction: string
    } | null
  } | null
  /** Category-synonym ops investigation (repair cost / HVAC / plumbing / …). */
  deepOpsInvestigation?: {
    available: boolean
    found: boolean
    missingFields: string[]
    bullets: string[]
    citations: AskUloCitation[]
    markdown: string
    categories: string[]
    isRepairCostQuestion: boolean
    ticketCount: number
    /** Structured work orders — same SoT as workflow detail. */
    workOrders?: Array<{
      workOrderId: string
      maintenanceRequestId: string
      propertyName: string
      unitLabel: string | null
      category: string
      title: string
      description: string
      priority: string | null
      estimatedCost: number | null
      estimatedCostSource: string | null
      repairScope: string
      laborEstimate: string
      workflowStage: string | null
      vendorName: string | null
      slaExpired: boolean
      approvalStatus: string
    }>
    operationalEvidenceJson?: string
  } | null
  /** Overview Property Insights (Recurring / Needs Attention / Prevent). */
  propertyInsights?: {
    available: boolean
    found: boolean
    bullets: string[]
    citations: AskUloCitation[]
    markdown: string
    insights: Array<{
      tag: string
      text: string
      requestCount: number | null
      building: string | null
      unitLabel: string | null
      categoryLabel: string | null
    }>
    sufficientForMaintenanceRisk: boolean
  } | null
  /** Recurring repairs (repair-level open + completed 60d). */
  recurringRepairs?: {
    available: boolean
    found: boolean
    bullets: string[]
    citations: AskUloCitation[]
    markdown: string
    ticketCount: number
    completedTicketCount: number
    completedWorkflowCount: number
    windowDays: number
    patterns: Array<{
      kind: string
      label: string
      repairTypeId?: string
      repairTypeLabel?: string
      count: number
      building: string | null
      unitLabel: string | null
      categoryFamily: string
      completedCount: number
      openCount: number
      reopenedAfterCompletion: boolean
    }>
  } | null
  /** Urgent open repairs + landlord-awaiting workflows to approve first. */
  repairsToApprove?: {
    available: boolean
    found: boolean
    bullets: string[]
    citations: AskUloCitation[]
    markdown: string
    openUrgentCount: number
    awaitingCount: number
    items: Array<{
      kind: string
      label: string
      building: string | null
      unitLabel: string | null
      reason: string
      priority: string | null
    }>
  } | null
  /** Late-rent / arrears residents from users.balance_due + rent_collection. */
  residents?: {
    available: boolean
    found: boolean
    bullets: string[]
    citations: AskUloCitation[]
    markdown: string
    filter: string
    residents: Array<{
      residentId: string
      name: string
      unitLabel: string | null
      propertyName: string | null
      balanceDue: number
      daysOverdue: number | null
      moveInDate?: string | null
      awaitingReplyHours?: number | null
    }>
  } | null
  /** Open work orders stuck without progress / missing updates. */
  missingUpdates?: {
    available: boolean
    found: boolean
    bullets: string[]
    citations: AskUloCitation[]
    markdown: string
    openCount: number
    items: Array<{
      displayId: string
      label: string
      building: string | null
      unitLabel: string | null
      whyMissing: string
      daysWaiting: number
      status: string
    }>
  } | null
  /** Vendors ranked by response speed. */
  vendorResponseSpeed?: {
    available: boolean
    found: boolean
    bullets: string[]
    citations: AskUloCitation[]
    markdown: string
    ranked: Array<{
      vendorId: string
      name: string
      avgResponseMinutes: number | null
      acceptedJobs: number
      completedJobs: number
      responseSpeedScore: number | null
    }>
  } | null
  /** Best vendors by overall score (optional trade filter). */
  vendorBest?: {
    available: boolean
    found: boolean
    bullets: string[]
    citations: AskUloCitation[]
    markdown: string
    tradeSlug: string | null
    tradeLabel: string | null
    ranked: Array<{
      vendorId: string
      name: string
      category: string | null
      vendorScore: number | null
      residentSatisfaction: number | null
      reviewCount: number
      completedJobs: number
      acceptedJobs: number
      avgResponseMinutes: number | null
      completionRate: number | null
    }>
  } | null
  /** Vendors ranked by completion rate. */
  vendorCompletion?: {
    available: boolean
    found: boolean
    bullets: string[]
    citations: AskUloCitation[]
    markdown: string
    ranked: Array<{
      vendorId: string
      name: string
      completionRate: number | null
      completedJobs: number
      acceptedJobs: number
    }>
  } | null
  /** Vendors without recent accepts / pending accept. */
  vendorInactive?: {
    available: boolean
    found: boolean
    bullets: string[]
    citations: AskUloCitation[]
    markdown: string
    ranked: Array<{
      vendorId: string
      name: string
      pendingAcceptJobs: number
      acceptedJobs: number
      lastAssignedAt: string | null
      daysSinceAssigned: number | null
      reason: string
    }>
  } | null
  /** Vendors overloaded by open assigned workload. */
  vendorOverload?: {
    available: boolean
    found: boolean
    bullets: string[]
    citations: AskUloCitation[]
    markdown: string
    ranked: Array<{
      vendorId: string
      name: string
      openJobs: number
      pendingAccept: number
      accepted: number
      inProgress: number
      oldestOpenDays: number | null
    }>
  } | null
  /** Vendor verification / capacity chips from vendor_verifications. */
  vendorVerification?: {
    available: boolean
    found: boolean
    bullets: string[]
    citations: AskUloCitation[]
    markdown: string
    ranked: Array<{
      vendorId: string | null
      name: string
      verificationStatus: string | null
      verificationLabel: string
      capacityLabel: string
      checklistComplete: number
      checklistRequired: number
      missingReasons: string[]
    }>
  } | null
  /** Knowledge hierarchy / investigation playbook for this turn. */
  investigationPlaybook?: {
    id: string
    preferTier1Answer: boolean
    consultTier1First: boolean
    deepOpsPrimary: boolean
  } | null
  /** How to reason about the answer (internal — never echo mode names to the user). */
  reasoningMode?: AskUloReasoningMode
  /** Best response shape for this question (internal). */
  responseFormat?: AskUloResponseFormat
  /** When true, prefer a short Quick Answer (narrow factual ops). */
  narrowFactual?: boolean
  toolsUsed: string[]
}

const ANSWER_MODEL = "gpt-4o"

const FORMATTING_GUIDE = `
## Voice (experienced regional property manager)
You are Ulo — a knowledgeable colleague who knows the landlord's buildings.
Write like you're speaking out loud to a busy property manager. Target ~9th-grade reading level.
Use contractions (you're, you'll, it's, don't). Short paragraphs (max 2–3 sentences each).
One thought per paragraph. Skimmable in under 15 seconds — premium briefing feel.

Lead with the answer in natural prose — never restate the question, never open with report labels
(Quick Answer, Summary, Recommendation, Confidence, Analysis, Conclusion, Reasoning…).
Tell the story with selective **bold** on the key facts; then short human headings
(Why it matters / Details / What I'd do — not Analysis / Confidence).
Match the user's tone. Hide mechanics ("I analyzed…"). Never sound like a database or API dump.

Visual skim path: (1) first sentence = answer (2) bold insight (3) supporting facts (4) what to do next.
Bullets only for lists/rankings/priorities/next steps — not every reply.

Answer what they asked — not every packet you have.
Match the response format to the request (summary, ranking, comparison, short answer, etc.).
Do not force Quick Answer / Why I reached this conclusion / Confidence / Recommended Next Steps
onto every reply — only when those sections help this specific answer (and prefer human headings).
Natural transitions when useful: "Here's the important part.", "Looking across your portfolio…",
"One thing to watch for…", "This matters because…", "Overall…"
Never mention retrieval, packets, graphs, filters, embeddings, or other implementation details.

## Never sound like an AI report
- Never expose raw retrieval: fact keys (hud_fmr_2br), units (usd_per_month), tags ([official],
  [requirement], [guidance], [effective …]), "portfolio context", "ops", "workflow", "demo",
  "pending codification", "agency guidance", "structured facts", "retrieval".
- Translate everything into plain English before the user sees it.
  Bad: hud_fmr_2br: 1850 usd_per_month
  Good: HUD's current Fair Market Rent for a two-bedroom in this area is about **$1,850 per month**.
- Avoid AI punctuation habits: long em dashes (—), slash stacks (Section 8 / HCV), bullet "raw labels",
  double-colon labels, "official • guidance • requirement". Prefer complete sentences.
  Bad: Section 8 / Housing Choice Voucher (HCV)
  Good: Section 8 Housing Choice Voucher
  Bad: Portland — Property Maintenance
  Good: Portland Property Maintenance Code
- Do not repeat the same warning or fact in Quick Answer, Things to Keep in Mind, and Next Steps.
  Mention once, say why it matters, move on.
- Do not copy-paste statute text. Explain first in plain English, then name the source lightly.
  Bad: ORS 90.322 requires…
  Good: In most cases, Oregon landlords must give tenants at least **24 hours' notice** before entering.
  Source: ORS 90.322
- Every bullet must answer "why should you care?" Never list bare inventory facts.
- Prefer complete sentences over fragments ("Company policy" / "Written 60-day notice").
- Don't over-precision: summarize ranges (e.g. FMR by bedroom) unless the user asked for the breakdown.
- Hide technical citations, tiers, and effective dates from the answer body — the UI "View details" /
  Compliance panel shows sources. Do not interrupt reading with [official] or [requirement].
- Prefer headings like What this means / Things to keep in mind / Why this matters / Good to know /
  Next steps. Never use Requirements, Guidance, Portfolio Context, Sources Used, or Ops.
- For LEGAL answers, always include a short "## Where this applies" section stating city/county/state,
  whether sources are law vs government guidance, and currency when known (effective/update dates).
- Humanize recommendations: "Before increasing rent, I'd recommend:" then short action bullets.
- Do NOT end every answer with "I'm not a lawyer" or a legal disclaimer. Only urge a second opinion
  when the topic is eviction, fair housing, discrimination, reasonable accommodation, lead hazards,
  or court filings (or LEGAL_GATE.requireCounsel is true). Otherwise keep the conversation moving.
- Do not invent rents, laws, notice periods, or dollar caps.

## Golden rule: property context supports the answer — it does not replace it
Before including ANY portfolio fact, ask: "Does the user need this to understand the answer?"
If no, omit it. Only surface property information that materially changes the recommendation.
Never lead with address, unit count, occupancy, property type, average rent, or portfolio statistics
unless the user asked for those. Skip the property section entirely when nothing changes the advice.

## Decision support (critical safety)
You help people make informed decisions — you do not make consequential decisions for them.
You MAY: explain what rules say, identify risks, organize information, and recommend next steps.
You MUST NOT claim to (or offer to) automatically: send eviction/legal notices, reject rental
applicants, change rent prices, shut off utilities, lock out tenants, or file legal paperwork.
If asked to do those for them, refuse the execution, explain why humans stay in control, and
offer to explain/checklist/recommend instead.

## Fair Housing / tenant screening (critical)
Never recommend approve or deny based on race, color, religion, sex, disability, familial status,
national origin, or proxies (ZIP/neighborhood, name/accent, “no kids”, blanket voucher bans where
local law protects source of income, etc.). Never invent a pretextual denial reason.
You may explain lawful, written, consistently applied screening criteria and point to company policy
+ counsel. If FAIR_HOUSING_SCREENING_RULES say REFUSE DECISION, do not pick approve/deny — explain
risk and defer.

## Intent (critical)
You are given a classified INTENT for this turn. Answer THAT topic only.
- Conversation history may preserve the active property ("its", "that building") — use it for entity resolution.
- Do NOT reuse a prior market-analysis layout when the new intent is price history, rent history, etc.
- Never paste internal IDs, UUID ticket numbers, or workflow statuses into finance / price / rent answers.
- Prefer LIVE MARKET DATA / PRICE HISTORY / RENT HISTORY packets when present — do not invent figures.

## Formatting
- GitHub-flavored Markdown. Lead with prose; bullets only when they help.
- Default length ~150–350 words unless the user asks for a deep dive or a short answer.
- Bold dollar amounts, notice periods, and key decisions.
- Light callouts when helpful: ✅ **Good news** / ⚠ **Watch out** / 💡 **Tip**
- Recommended Next Steps only when findings justify action — never by default.
- Do NOT include "## Sources Used", raw citation dumps, or a Compliance section — the UI shows those.
`.trim() +
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

function intentSectionGuide(
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

function stripJsonFence(s: string): string {
  const t = s.trim()
  const m = t.match(/^```(?:json)?\s*([\s\S]*?)```$/i)
  return m ? m[1].trim() : t
}

function mergeCitations(packets: AskUloToolPackets): AskUloCitation[] {
  const out: AskUloCitation[] = []
  const seen = new Set<string>()
  for (const group of [
    packets.residents,
    packets.repairsToApprove,
    packets.missingUpdates,
    packets.vendorBest,
    packets.vendorCompletion,
    packets.vendorInactive,
    packets.vendorOverload,
    packets.vendorVerification,
    packets.vendorResponseSpeed,
    packets.recurringRepairs,
    packets.propertyInsights,
    packets.portfolioBriefing,
    packets.periodSummary,
    packets.propertyRanking,
    packets.unitMaintenanceRanking,
    packets.oldestWaitingWorkOrder,
    packets.entityInvestigation,
    packets.deepOpsInvestigation,
    packets.priceHistory,
    packets.rentHistory,
    packets.market,
    packets.ops,
    packets.legal,
    packets.structured,
    packets.property,
  ]) {
    if (!group || !("citations" in group) || !group.citations) continue
    for (const c of group.citations) {
      const key = `${c.tool}|${c.title}|${c.citation ?? ""}|${c.url ?? ""}`
      if (seen.has(key)) continue
      seen.add(key)
      if (c.tool === "legal_rag" || c.tool === "structured") {
        const tier = c.sourceTier ?? classifyLegalSourceTrust(c).tier
        out.push({ ...c, sourceTier: tier })
      } else {
        out.push(c)
      }
    }
  }
  // Prefer official / agency over mirrors in the chip list.
  out.sort((a, b) => {
    const rank = (t?: AskUloCitation["sourceTier"]) => {
      if (t === "primary_official") return 0
      if (t === "agency_guidance") return 1
      if (t === "discovery_mirror") return 2
      if (t === "untrusted") return 3
      return 4
    }
    return rank(a.sourceTier) - rank(b.sourceTier)
  })
  return out
}

function money(n: number): string {
  return `$${Math.round(n).toLocaleString("en-US")}`
}

function packetsToTransparencyHints(packets: AskUloToolPackets): TransparencyPacketHints {
  return {
    intent: packets.intent,
    reasoningMode: packets.reasoningMode,
    narrowFactual: packets.narrowFactual,
    toolsUsed: packets.toolsUsed,
    propertyRanking: packets.propertyRanking
      ? {
          available: packets.propertyRanking.available,
          canRank: packets.propertyRanking.canRank,
          missingData: packets.propertyRanking.missingData,
          portfolioOpenWorkOrders: packets.propertyRanking.portfolioOpenWorkOrders,
          top: packets.propertyRanking.top
            ? {
                building: packets.propertyRanking.top.building,
                whyLines: packets.propertyRanking.top.whyLines,
                criticalWorkOrders: packets.propertyRanking.top.criticalWorkOrders,
                escalatedWorkflows: packets.propertyRanking.top.escalatedWorkflows,
                openWorkOrders: packets.propertyRanking.top.openWorkOrders,
              }
            : null,
        }
      : null,
    unitMaintenanceRanking: packets.unitMaintenanceRanking
      ? {
          available: packets.unitMaintenanceRanking.available,
          canRank: packets.unitMaintenanceRanking.canRank,
          missingData: packets.unitMaintenanceRanking.missingData,
          timeframeLabel: packets.unitMaintenanceRanking.timeframeLabel,
          top: packets.unitMaintenanceRanking.top
            ? {
                unitLabel: packets.unitMaintenanceRanking.top.unitLabel,
                building: packets.unitMaintenanceRanking.top.building,
                totalRequests: packets.unitMaintenanceRanking.top.totalRequests,
                openRequests: packets.unitMaintenanceRanking.top.openRequests,
              }
            : null,
        }
      : null,
    portfolioBriefing: packets.portfolioBriefing
      ? {
          available: packets.portfolioBriefing.available,
          healthScore: packets.portfolioBriefing.healthScore,
          facts: packets.portfolioBriefing.facts,
        }
      : null,
    ops: packets.ops,
    property: packets.property,
    market: packets.market
      ? { available: packets.market.available, gapNote: packets.market.gapNote }
      : null,
    priceHistory: packets.priceHistory
      ? { available: packets.priceHistory.available }
      : null,
    rentHistory: packets.rentHistory
      ? { available: packets.rentHistory.available }
      : null,
    legal: packets.legal,
    structured: packets.structured,
  }
}

/** Ensure analytical answers include Why I reached this conclusion + Confidence. */
export function ensureReasoningTransparency(
  answerMarkdown: string,
  packets: AskUloToolPackets,
): string {
  const withEvidence = appendReasoningTransparency(
    answerMarkdown,
    packetsToTransparencyHints(packets),
  )
  // Landlord-facing polish: translate ops jargon + clip/retrieval leaks.
  // Skip legal answers so statute language stays intact.
  if (packets.intent === "legal") return withEvidence
  return polishAskUloProse(humanizeOpsLanguage(withEvidence))
}

function buildFallbackExecutiveBriefing(packets: AskUloToolPackets): string {
  const b = packets.portfolioBriefing
  if (!b?.available) {
    return [
      "## Overall Assessment",
      "I couldn't assemble a full portfolio briefing from live ops data yet.",
      "",
      "## Recommended Next Steps",
      "- Confirm your portfolio has units and open tickets loaded, then ask again.",
    ].join("\n")
  }

  const facts = b.facts as {
    openWorkOrders?: number
    criticalWorkOrders?: number
    escalatedWorkflows?: number
    occupancyPct?: number | null
    recurringHotspots?: string[]
    recentUloActions?: string[]
    agingWorkOrders?: number
    awaitingDecision?: number
  }

  const parts: string[] = []
  parts.push("## Overall Assessment")
  if (b.healthScore != null) {
    parts.push(
      `Overall, your portfolio is **${b.assessment.toLowerCase()}** at **${b.healthScore}/100**` +
        (facts.criticalWorkOrders
          ? `, with maintenance performance needing attention.`
          : `.`),
    )
  } else {
    parts.push(
      `Overall assessment: **${b.assessment}**. Property Health score is unavailable from current signals.`,
    )
  }

  const goingWell: string[] = []
  if (facts.occupancyPct != null && facts.occupancyPct >= 90) {
    goingWell.push(`Occupancy remains strong at ${facts.occupancyPct}%.`)
  }
  if ((facts.openWorkOrders ?? 0) === 0) {
    goingWell.push("There are no open maintenance work orders right now.")
  }
  if ((facts.escalatedWorkflows ?? 0) === 0 && (facts.openWorkOrders ?? 0) > 0) {
    goingWell.push("Nothing currently requires your urgent decision.")
  }
  parts.push("")
  parts.push("## What's Going Well")
  if (goingWell.length) {
    for (const line of goingWell.slice(0, 3)) parts.push(`- ${line}`)
  } else {
    parts.push("- No strong positive signals stood out in the latest packet beyond baseline operations.")
  }

  parts.push("")
  parts.push("## What Needs Attention")
  const attention: string[] = []
  if ((facts.openWorkOrders ?? 0) > 0) {
    attention.push(
      `You have ${facts.openWorkOrders} open work orders` +
        ((facts.criticalWorkOrders ?? 0) > 0
          ? `, including ${facts.criticalWorkOrders} critical/urgent.`
          : "."),
    )
  }
  if ((facts.escalatedWorkflows ?? 0) > 0) {
    attention.push(
      `${facts.escalatedWorkflows} item(s) require your attention and need follow-up.`,
    )
  }
  if ((facts.awaitingDecision ?? 0) > 0) {
    attention.push(
      `${facts.awaitingDecision} item(s) are waiting on your decision.`,
    )
  }
  if ((facts.agingWorkOrders ?? 0) > 0) {
    attention.push(
      `${facts.agingWorkOrders} repair request(s) have been waiting longer than expected.`,
    )
  }
  for (const h of (facts.recurringHotspots ?? []).slice(0, 2)) {
    attention.push(h)
  }
  if (attention.length) {
    for (const line of attention.slice(0, 5)) parts.push(`- ${line}`)
  } else {
    parts.push("- No critical risks were flagged in the current packet.")
  }

  parts.push("")
  parts.push("## Recommended Next Steps")
  const hasHardRisk =
    (facts.escalatedWorkflows ?? 0) > 0 ||
    (facts.criticalWorkOrders ?? 0) > 0 ||
    (facts.agingWorkOrders ?? 0) > 0 ||
    (facts.recurringHotspots ?? []).length > 0 ||
    (facts.awaitingDecision ?? 0) > 0
  if ((facts.escalatedWorkflows ?? 0) > 0) {
    parts.push(
      "- Follow up on items that require your attention first — assign the job to a different vendor or make the pending decision.",
    )
  }
  if ((facts.criticalWorkOrders ?? 0) > 0) {
    parts.push("- Review critical/urgent requests first and confirm a vendor is on the way.")
  }
  if ((facts.agingWorkOrders ?? 0) > 0) {
    parts.push(
      "- Prioritize repair requests that have been waiting longer than expected.",
    )
  }
  if ((facts.recurringHotspots ?? []).length > 0) {
    parts.push(
      `- Schedule a preventive inspection for the recurring hotspot: ${facts.recurringHotspots![0]}.`,
    )
  }
  if ((facts.awaitingDecision ?? 0) > 0 && !((facts.escalatedWorkflows ?? 0) > 0)) {
    parts.push("- Resolve items waiting on your decision so operations can move forward.")
  }
  if (!hasHardRisk) {
    if ((facts.openWorkOrders ?? 0) === 0) {
      parts.push("- No action is needed right now.")
      parts.push("- Continue monitoring new maintenance requests as they come in.")
    } else {
      parts.push("- Keep an eye on open requests, but nothing here needs emergency escalation today.")
    }
  }

  const actions = facts.recentUloActions ?? []
  if (actions.length) {
    parts.push("")
    parts.push("## What Ulo Handled")
    for (const a of actions.slice(0, 2)) parts.push(`- ${a}`)
  }

  return parts.join("\n")
}

function buildFallbackPropertyPriority(packets: AskUloToolPackets): string {
  const ranking = packets.propertyRanking
  const mode = packets.reasoningMode ?? "comparison_ranking"

  if (!ranking?.available) {
    return (
      buildPropertyRankingIncompleteSignal({
        available: false,
        canRank: false,
        missingData: ["property-level maintenance signals"],
        portfolioOpenWorkOrders: 0,
        reasoningMode: mode,
      })?.markdown ??
      [
        "## Top Priority",
        "I couldn't load property-level signals for a reliable ranking right now.",
      ].join("\n")
    )
  }

  if (!ranking.canRank || !ranking.top) {
    return (
      buildPropertyRankingIncompleteSignal({
        available: ranking.available,
        canRank: false,
        missingData: ranking.missingData,
        portfolioOpenWorkOrders: ranking.portfolioOpenWorkOrders,
        reasoningMode: mode,
      })?.markdown ??
      [
        "## Top Priority",
        "I couldn't reliably compare your properties from portfolio totals alone.",
      ].join("\n")
    )
  }

  const top = ranking.top
  const parts: string[] = []

  if (mode === "diagnosis") {
    parts.push("## What's Becoming a Problem")
    parts.push(
      `**${top.building}** is the clearest operational pressure point right now.`,
    )
    parts.push("")
    parts.push("## What's Driving It")
  } else {
    parts.push(mode === "recommendation" ? "## Do This First" : "## Top Priority")
    parts.push(
      mode === "recommendation"
        ? `If I owned this portfolio, I'd start with **${top.building}**.`
        : `**${top.building} needs your attention first.**`,
    )
    parts.push("")
    parts.push(mode === "recommendation" ? "## Why That First" : "## Why It Ranks First")
  }

  for (const line of top.whyLines.slice(0, 4)) {
    parts.push(`- ${line}`)
  }
  if (top.whyLines.length === 0) {
    parts.push(
      `- ${top.openWorkOrders} open work orders` +
        (top.criticalWorkOrders ? ` including ${top.criticalWorkOrders} critical/urgent` : "") +
        ".",
    )
  }

  parts.push("")
  parts.push("## Recommended Actions")
  top.recommendedActions.forEach((a, i) => {
    parts.push(`${i + 1}. ${a}`)
  })

  if (ranking.watch.length > 0) {
    parts.push("")
    parts.push("## Also Watch")
    for (const w of ranking.watch.slice(0, 2)) {
      const why = w.whyLines[0] ?? `${w.openWorkOrders} open work orders`
      parts.push(`- **${w.building}**: ${why}`)
    }
  }

  return parts.join("\n")
}

function buildFallbackUnitMaintenanceRanking(packets: AskUloToolPackets): string {
  const ranking = packets.unitMaintenanceRanking
  if (ranking && !ranking.canRank) {
    return (
      buildUnitRankingIncompleteSignal({
        available: ranking.available,
        canRank: false,
        missingData: ranking.missingData,
        requestCount: ranking.scopedRequestCount,
        unlinkedRequestCount: ranking.unlinkedRequestCount,
        timeframeLabel: ranking.timeframeLabel,
        scopeLabel: ranking.scopeLabel,
      })?.markdown ??
      ranking.markdown
    )
  }
  if (ranking?.markdown) return ranking.markdown

  return (
    buildUnitRankingIncompleteSignal({
      available: false,
      canRank: false,
      missingData: ["which units those maintenance requests belong to"],
    })?.markdown ??
    [
      "## Quick Answer",
      "I found maintenance activity for the portfolio, but I could not reliably connect the requests to individual units.",
    ].join("\n")
  )
}

function buildFallbackPeriodSummary(packets: AskUloToolPackets): string {
  const summary = packets.periodSummary
  if (summary?.markdown) return summary.markdown

  return [
    "## This Week at a Glance",
    "I can see current maintenance totals, but I do not have the event history needed to create a reliable weekly summary.",
  ].join("\n")
}

/** Deterministic answer when OpenAI is unavailable. */
export function buildFallbackAskUloAnswer(packets: AskUloToolPackets): string {
  if (
    packets.intent === "legal" &&
    packets.legalGate &&
    (packets.legalGate.status === "clarify" || packets.legalGate.status === "refuse") &&
    packets.legalGate.markdown
  ) {
    return packets.legalGate.markdown
  }

  if (
    packets.intent === "property_price_history" ||
    packets.intent === "price_history_ambiguous"
  ) {
    if (packets.priceHistory?.markdown) return packets.priceHistory.markdown
    return [
      "## Price History",
      "I couldn't load sale/valuation history for that property yet.",
      "",
      "## Next Steps",
      "- Name the building (e.g. Maple Heights) and ask again.",
    ].join("\n")
  }

  if (packets.intent === "rent_history") {
    if (packets.rentHistory?.markdown) return packets.rentHistory.markdown
    return [
      "## Rent History",
      packets.rentHistory?.gapNote ?? "Rent history is not available yet.",
    ].join("\n")
  }

  if (packets.intent === "period_summary") {
    return buildFallbackPeriodSummary(packets)
  }

  if (packets.intent === "oldest_waiting_work_order") {
    return (
      packets.oldestWaitingWorkOrder?.markdown ??
      incompleteOldestWaitingAnswer()
    )
  }

  if (packets.intent === "entity_investigation") {
    return (
      packets.entityInvestigation?.markdown ??
      incompleteEntityRootCauseAnswer()
    )
  }

  // Late-rent / resident arrears — never property priority.
  if (packets.residents?.markdown && packets.residents.available) {
    return packets.residents.markdown
  }

  // Repairs to approve immediately — prefer this packet whenever loaded.
  if (packets.repairsToApprove?.markdown && packets.repairsToApprove.available) {
    return packets.repairsToApprove.markdown
  }

  // Missing updates — prefer list packet over deep-ops ticket dumps.
  if (packets.missingUpdates?.markdown && packets.missingUpdates.available) {
    return packets.missingUpdates.markdown
  }

  // Vendors without recent accepts — never portfolio briefing.
  if (packets.vendorInactive?.markdown && packets.vendorInactive.available) {
    return packets.vendorInactive.markdown
  }

  // Overloaded / busiest vendors — never overall “best” score.
  if (packets.vendorOverload?.markdown && packets.vendorOverload.available) {
    return packets.vendorOverload.markdown
  }

  // Vendor verification / compliance chips — never portfolio briefing.
  if (packets.vendorVerification?.markdown && packets.vendorVerification.available) {
    return packets.vendorVerification.markdown
  }

  // Vendor completion rate — never property priority.
  if (packets.vendorCompletion?.markdown && packets.vendorCompletion.available) {
    return packets.vendorCompletion.markdown
  }

  // Vendor best (overall / trade) — never collapse to response-speed-only.
  if (packets.vendorBest?.markdown && packets.vendorBest.available) {
    return packets.vendorBest.markdown
  }

  // Vendor response speed — never substitute property ranking.
  if (packets.vendorResponseSpeed?.markdown && packets.vendorResponseSpeed.available) {
    return packets.vendorResponseSpeed.markdown
  }

  // Recurring repairs: include completed work — prefer this packet whenever loaded.
  if (packets.recurringRepairs?.markdown && packets.recurringRepairs.available) {
    return packets.recurringRepairs.markdown
  }

  const isMarketQuestion =
    packets.intent === "market_rent_estimate" ||
    packets.intent === "comparable_rentals" ||
    packets.intent === "market_analysis" ||
    detectQuestionSubject(packets.question) === "market_intelligence"

  // Tier 1 first: Property Insights already answer maintenance-risk / expense playbooks.
  // Never for market rent / comps questions.
  if (
    !isMarketQuestion &&
    packets.investigationPlaybook?.preferTier1Answer &&
    packets.propertyInsights?.found &&
    packets.propertyInsights.markdown
  ) {
    return packets.propertyInsights.markdown
  }

  if (
    !isMarketQuestion &&
    packets.deepOpsInvestigation?.found &&
    packets.deepOpsInvestigation.markdown
  ) {
    return packets.deepOpsInvestigation.markdown
  }

  if (packets.intent === "unit_maintenance_ranking") {
    return buildFallbackUnitMaintenanceRanking(packets)
  }

  if (packets.intent === "property_priority") {
    return buildFallbackPropertyPriority(packets)
  }

  if (packets.intent === "executive_briefing" || packets.intent === "property_health") {
    return buildFallbackExecutiveBriefing(packets)
  }

  // Ranking-style questions that somehow kept another intent still use the packet.
  if (packets.entityInvestigation?.markdown) {
    return packets.entityInvestigation.markdown
  }

  if (packets.oldestWaitingWorkOrder?.markdown) {
    return packets.oldestWaitingWorkOrder.markdown
  }

  if (packets.periodSummary) {
    return buildFallbackPeriodSummary(packets)
  }

  if (packets.unitMaintenanceRanking) {
    return buildFallbackUnitMaintenanceRanking(packets)
  }

  if (
    packets.propertyRanking &&
    !isAnyVendorMetricQuestion(packets.question) &&
    detectQuestionSubject(packets.question) !== "vendor" &&
    (packets.reasoningMode === "comparison_ranking" ||
      packets.reasoningMode === "diagnosis" ||
      packets.reasoningMode === "recommendation")
  ) {
    return buildFallbackPropertyPriority(packets)
  }

  // Never answer a vendor question with a portfolio briefing packet.
  if (
    detectQuestionSubject(packets.question) === "vendor" &&
    packets.portfolioBriefing?.markdown
  ) {
    // Prefer any vendor packet already handled above; if we got here, say what's missing.
    return [
      "I need vendor activity data to answer that — not a portfolio health summary.",
      "",
      "### What I'd do",
      "Ask which vendors haven't accepted jobs, who responds fastest, or who has the best completion rate, and I'll rank from vendor scores.",
    ].join("\n")
  }

  if (packets.narrowFactual && packets.ops?.bullets.length) {
    const openLine =
      packets.ops.bullets.find((b) => /open maintenance tickets/i.test(b)) ??
      packets.ops.bullets[0]
    return [
      "## Quick Answer",
      humanizeRetrievalLine(openLine),
      "",
      "## Recommended Next Steps",
      "- Review critical and overdue items first.",
    ].join("\n")
  }

  const j = packets.jurisdiction
  const parts: string[] = []

  if (packets.intent === "comparable_rentals") {
    parts.push("## Comparable Rentals")
    if (packets.market?.available) {
      parts.push("Here are nearby rentals grounded in live market data.")
      parts.push("_Interactive comps with View Listing links appear below._")
    } else {
      parts.push(packets.market?.gapNote ?? "Live comps aren't available yet.")
    }
    parts.push("## Next Steps")
    parts.push("- Ask for a full market analysis if you want Street View and rent positioning.")
    return parts.join("\n")
  }

  if (packets.intent === "market_rent_estimate") {
    parts.push("## Quick Answer")
    if (packets.market?.estimatedRent != null) {
      parts.push(
        `I'd price around **${money(packets.market.estimatedRent)}/mo**` +
          (packets.market.rentRangeLow != null && packets.market.rentRangeHigh != null
            ? ` (typical range ${money(packets.market.rentRangeLow)}–${money(packets.market.rentRangeHigh)})`
            : "") +
          ".",
      )
    } else {
      parts.push(packets.market?.gapNote ?? "I don't have a live rent estimate yet.")
    }
    parts.push("## Next Steps")
    parts.push("- Ask for comps if you want to inspect nearby listings.")
    return parts.join("\n")
  }

  if (packets.intent === "market_analysis") {
    parts.push("## Market Summary")
    const building = packets.property?.buildingName
    const place = [j.cityLabel, j.stateCode].filter(Boolean).join(", ")

    if (packets.market?.available && packets.market.estimatedRent != null) {
      const src =
        packets.market.provider === "zillow_research"
          ? "Zillow Research (ZORI)"
          : packets.market.provider === "zillow_rapidapi"
            ? "Zillow listings"
            : packets.market.provider === "rentcast"
              ? "RentCast"
              : "live market data"
      parts.push(
        `I'd price around **${money(packets.market.estimatedRent)}/mo` +
          (packets.market.rentRangeLow != null && packets.market.rentRangeHigh != null
            ? `** (typical range ${money(packets.market.rentRangeLow)}–${money(packets.market.rentRangeHigh)})`
            : "**") +
          (place ? ` based on ${src} for **${place}**.` : ` based on ${src}.`),
      )
    } else if (packets.market?.available) {
      parts.push(
        place
          ? `Here's a live rental-market read for **${place}**.`
          : "Here's a live rental-market read from the comps I could pull.",
      )
    } else {
      parts.push(
        packets.market?.gapNote ??
          "Live rental market comps aren't available yet for this request.",
      )
    }

    if (packets.market?.available) {
      parts.push("## Estimated Rent Position")
      for (const b of packets.market.bullets) {
        if (/^comparable rentals:/i.test(b)) continue
        if (b.startsWith("- ")) continue
        if (/market data provider/i.test(b)) continue
        parts.push(`- ${b}`)
      }

      const material = selectMaterialPropertyBullets([
        ...(packets.property?.bullets ?? []),
        ...(packets.ops?.bullets ?? []),
      ]).slice(0, 4)
      if (material.length) {
        parts.push("## How this applies to your property")
        if (building) {
          parts.push(
            `A few details at **${building}** that can change pricing or timing:`,
          )
        }
        for (const b of material) parts.push(`- ${b}`)
      }

      const compLines = packets.market.bullets.filter((b) => b.startsWith("- "))
      if (compLines.length) {
        parts.push("## Comparable Rentals")
        parts.push("_Interactive comps with View Listing links appear below._")
      }
    } else if (packets.market?.gapNote) {
      parts.push("## What's Missing")
      parts.push(`- ${packets.market.gapNote}`)
    }

    parts.push("## Recommended Next Steps")
    if (packets.market?.available && packets.market.estimatedRent != null) {
      parts.push(
        `- Price renewals and vacant units with the ${money(packets.market.estimatedRent)}/mo market estimate in mind.`,
      )
      parts.push("- Review the comps below for unit mix and amenity gaps.")
    } else {
      parts.push(
        "- Retry with a full street address, or set `RENTCAST_API_KEY` for listing-level comps.",
      )
    }
    parts.push("- Ask for price history if you want sale/valuation over time.")
    return parts.join("\n")
  }

  if (packets.intent === "legal") {
    const placeBits = [
      j.cityLabel,
      j.countyLabel ? `${j.countyLabel} County` : null,
      j.stateCode === "OR" ? "Oregon" : j.stateCode,
    ].filter(Boolean)
    const place = placeBits.join(", ")
    const building = packets.property?.buildingName
    const ruleLead =
      packets.structured?.bullets[0] ??
      ((packets.legalGate?.primaryOfficialCount ?? 0) > 0
        ? packets.legal?.bullets[0]
        : null) ??
      null
    const pendingOrdinance = (packets.legal?.pendingOrdinanceCount ?? 0) > 0
    const sensitiveIds = new Set(
      (packets.legalGate?.sensitiveTopics ?? []).map((t) => t.id),
    )
    const highStakes =
      Boolean(packets.legalGate?.requireCounsel) ||
      sensitiveIds.has("eviction") ||
      sensitiveIds.has("fair_housing") ||
      sensitiveIds.has("disability_accommodation") ||
      sensitiveIds.has("lead_environmental") ||
      sensitiveIds.has("tenant_screening") ||
      sensitiveIds.has("application_denial") ||
      sensitiveIds.has("domestic_violence") ||
      sensitiveIds.has("retaliation") ||
      sensitiveIds.has("illegal_self_help") ||
      Boolean(packets.fairHousing?.refuseDecision) ||
      Boolean(packets.humanDecision?.refuseDecision)

    if (packets.fairHousing?.refuseDecision) {
      parts.push("## I won’t decide approve or deny")
      parts.push(
        "I can explain lawful screening rules and Fair Housing risk, but **you** (with company policy and counsel) make the applicant decision. I won’t recommend approve/deny based on protected traits or proxies.",
      )
      parts.push("")
    }
    if (packets.humanDecision?.refuseDecision) {
      parts.push("## I won’t make this decision")
      parts.push(
        "This is a high-stakes housing situation. I can explain the rules and organize the facts, but a qualified professional must decide the outcome.",
      )
      parts.push("")
    }

    parts.push("## Quick Answer")
    if (packets.legalGate?.requireCounsel && packets.legalGate.counselNote) {
      parts.push(`⚠ **Watch out:** ${packets.legalGate.counselNote}`)
    } else if (pendingOrdinance) {
      parts.push(
        "⚠ **Watch out:** A recent city law may not appear on every government website yet. Ulo checked the newest available information.",
      )
    }
    if (ruleLead) {
      const plain = humanizeRetrievalLine(ruleLead)
      parts.push(
        place
          ? `Here's what matters under the local rules for **${place}**.`
          : "Here's what matters under the rules I could confirm.",
      )
      parts.push(plain)
    } else if (place) {
      parts.push(
        `I don't have a clear rule I can confirm yet for **${place}**. I'd double-check the official text or get a second opinion before you act.`,
      )
    } else {
      parts.push(
        "I need to know which property (or city/state) this is for before I can give solid advice.",
      )
    }

    const ruleBullets =
      packets.structured?.bullets.length
        ? packets.structured.bullets
        : (packets.legalGate?.primaryOfficialCount ?? 0) > 0 && packets.legal?.bullets.length
          ? packets.legal.bullets.slice(0, 3)
          : []
    if (ruleBullets.length > 0) {
      parts.push("## What this means")
      for (const b of ruleBullets) {
        const line = humanizeRetrievalLine(b)
        // Skip repeating the same lead line
        if (ruleLead && humanizeRetrievalLine(ruleLead) === line) continue
        parts.push(`- ${line}`)
      }
      if (parts[parts.length - 1] === "## What this means") {
        parts.pop()
      }
    }

    const mindLines: string[] = []
    if (j.housingProgram === "section_8_hcv") {
      mindLines.push(
        "Some units may use Section 8 Housing Choice Vouchers. Rent changes on those units usually need housing authority approval first.",
      )
    }
    // Soft agency notes only when we didn't already dump them as hard rules, and skip if pending already warned
    const softNotes =
      packets.structured?.bullets.length && packets.legal?.bullets.length
        ? packets.legal.bullets.slice(0, 2)
        : (packets.legalGate?.agencyGuidanceCount ?? 0) > 0
          ? (packets.legal?.bullets ?? []).slice(0, 2)
          : []
    for (const b of softNotes) {
      const line = humanizeRetrievalLine(b)
      if (ruleLead && humanizeRetrievalLine(ruleLead) === line) continue
      mindLines.push(line)
    }
    if (mindLines.length) {
      parts.push("## Things to keep in mind")
      for (const line of mindLines) parts.push(`- ${line}`)
    }

    const material = selectMaterialPropertyBullets([
      ...(packets.property?.bullets ?? []),
      ...(packets.ops?.bullets ?? []),
    ]).slice(0, 4)
    if (material.length) {
      parts.push("## Looking at your property")
      parts.push(
        building
          ? `Looking specifically at **${building}**, a few details change how I'd apply this:`
          : "Looking at your property information, a few details change how I'd apply this:",
      )
      for (const b of material) parts.push(`- ${humanizePropertyBullet(b)}`)
    }

    parts.push(
      ...formatCounselHandoffMarkdown({
        requireCounsel: Boolean(packets.legalGate?.requireCounsel),
        counselNote: packets.legalGate?.counselNote ?? null,
        recommendedExpertId:
          packets.legalGate?.recommendedExpertId ?? "regional_property_manager",
        include: highStakes,
      }),
    )

    parts.push("## Recommended Next Steps")
    parts.push("Before you act, I'd recommend:")
    parts.push("- Review the lease terms for the affected units.")
    if (material.some((b) => /maintenance|habitability|inspection/i.test(b))) {
      parts.push("- Resolve any major maintenance issues that could affect habitability.")
    }
    if (
      j.housingProgram === "section_8_hcv" ||
      material.some((b) => /section 8|hcv|voucher/i.test(b))
    ) {
      parts.push("- Confirm Section 8 approval requirements if they apply.")
    }
    if (!building) {
      parts.push("- Tell me which property this is for if the rules differ across your buildings.")
    }
    if (highStakes) {
      parts.push("- Use thumbs down if you want this flagged for human review.")
    }
    parts.push("")
    parts.push(
      formatLegalAttributionMarkdown({
        jurisdiction: {
          countryCode: j.countryCode,
          stateCode: j.stateCode,
          countyLabel: j.countyLabel,
          cityLabel: j.cityLabel,
        },
        citations: mergeCitations(packets),
        primaryOfficialCount: packets.legalGate?.primaryOfficialCount,
        agencyGuidanceCount: packets.legalGate?.agencyGuidanceCount,
      }),
    )
    return parts.join("\n")
  }

  parts.push("## Quick Answer")
  const materialDefault = selectMaterialPropertyBullets([
    ...(packets.property?.bullets ?? []),
    ...(packets.ops?.bullets ?? []),
  ]).slice(0, 5)
  if (packets.structured?.bullets.length) {
    parts.push(humanizeRetrievalLine(packets.structured.bullets[0]!))
  } else if (materialDefault.length) {
    parts.push(humanizePropertyBullet(materialDefault[0]!))
  } else if (packets.ops?.bullets.length) {
    parts.push(humanizeRetrievalLine(packets.ops.bullets[0]!))
  } else {
    parts.push(
      "I can't fully answer that with what I can see right now. Once the relevant request history is available, I'll give you a clear finding.",
    )
  }

  if (packets.structured?.bullets.length && packets.structured.bullets.length > 1) {
    parts.push("## What this means")
    for (const b of packets.structured.bullets.slice(1, 4)) {
      parts.push(`- ${humanizeRetrievalLine(b)}`)
    }
  }
  if (materialDefault.length > 1) {
    parts.push("## Looking at your property")
    for (const b of materialDefault.slice(packets.structured?.bullets.length ? 0 : 1, 5)) {
      parts.push(`- ${humanizePropertyBullet(b)}`)
    }
  }

  parts.push("## Recommended Next Steps")
  if (materialDefault.some((b) => /critical|escalat|aging|overdue|waiting longer/i.test(b))) {
    parts.push("- Review critical items and anything waiting longer than expected first.")
  } else {
    parts.push("- No action is needed right now unless a new issue appears.")
  }
  if (packets.property?.buildingName) {
    parts.push(
      `- Ask about **${packets.property.buildingName}** specifically if you want a property-level read.`,
    )
  }
  return parts.join("\n")
}

/** Strip leftover retrieval tags / keys from packet lines for user-facing fallback text. */
function humanizeRetrievalLine(raw: string): string {
  let s = raw.trim()
  if (s.startsWith("- ")) s = s.slice(2)
  s = s.replace(/^\(\d+\)\s*/, "")
  s = s.replace(/\s*\[(?:official|agency guidance|guidance|requirement|mirror[^\]]*|adopted[^\]]*|effective[^\]]*)\]/gi, "")
  s = s.replace(/\bhud_fmr_(\d)br\b/gi, (_m, n) => {
    const labels = ["studio", "one-bedroom", "two-bedroom", "three-bedroom"]
    return `HUD Fair Market Rent for a ${labels[Number(n)] ?? `${n}-bedroom`}`
  })
  s = s.replace(/\busd_per_month\b/gi, "per month")
  s = s.replace(/\bportfolio sample\b/gi, "typical rent")
  s = s.replace(/\bSection 8\s*\/\s*Housing Choice Voucher(?:\s*\(HCV\))?/gi, "Section 8 Housing Choice Voucher")
  s = s.replace(/\s{2,}/g, " ").trim()
  return s
}

function humanizePropertyBullet(raw: string): string {
  let s = humanizeRetrievalLine(raw)
  s = s.replace(/^Your company policy:\s*/i, "Your company requires: ")
  s = s.replace(/^Company policy:\s*/i, "Your company requires: ")
  if (/balance due/i.test(s) && !/before/i.test(s)) {
    return `${s} This matters if you're timing a rent increase or notice.`
  }
  if (/lease ends|month-to-month|confirm lease term/i.test(s) && !/because|matters|before/i.test(s)) {
    return `${s} That affects which notice rules apply.`
  }
  if (/section 8|voucher/i.test(s) && !/approval/i.test(s)) {
    return `${s} Confirm housing authority approval before changing rent on those units.`
  }
  return s
}

/** Portfolio inventory (counts, type, avg rent) — omit unless it changes the recommendation. */
function isInventoryPropertyBullet(bullet: string): boolean {
  const b = bullet.trim()
  if (/^property type:/i.test(b)) return true
  if (/typical in-place rent|average rent|avg\.?\s*rent|portfolio sample/i.test(b)) return true
  if (/^active \/ pending residents on file/i.test(b)) return true
  if (/housing programs:\s*no voucher/i.test(b)) return true
  if (/^maintenance history \(recent sample\)/i.test(b)) return true
  if (/^vendor performance/i.test(b)) return true
  if (/\b\d+\s+units?\b/i.test(b) && /occupancy|vacant|occupied/i.test(b)) return true
  if (/^address:|^street address:/i.test(b)) return true
  return false
}

/** Keep only property/ops facts that typically change legal or pricing advice. */
function selectMaterialPropertyBullets(bullets: string[]): string[] {
  return bullets.filter((b) => {
    const t = b.trim()
    if (!t || isInventoryPropertyBullet(t)) return false
    return (
      /^company policy:|^your company policy:/i.test(t) ||
      /section 8|housing choice voucher|hcv|pha rules|housing authority/i.test(t) ||
      /balance due|past due/i.test(t) ||
      /lease ends|month-to-month|expired end date|confirm lease term/i.test(t) ||
      /inspection/i.test(t) ||
      /habitability|open maintenance|still open/i.test(t) ||
      /prior conversation|handoff|decision/i.test(t) ||
      /must |required to|stricter/i.test(t)
    )
  })
}

async function synthesizeWithOpenAI(
  apiKey: string,
  packets: AskUloToolPackets,
): Promise<{ text: string; usage: AskUloTokenUsage | null; synthesizeMs: number } | null> {
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

  const marketBlock = packets.market
    ? `available: ${packets.market.available}\n` +
      `provider: ${packets.market.provider ?? "none"}\n` +
      `gapNote: ${packets.market.gapNote ?? "(none)"}\n` +
      `${packets.market.bullets.join("\n") || "(empty)"}`
    : "(skipped)"

  const priceBlock = packets.priceHistory
    ? `available: ${packets.priceHistory.available}\n` +
      `needsClarification: ${packets.priceHistory.needsClarification}\n` +
      `clarificationPrompt: ${packets.priceHistory.clarificationPrompt ?? "(none)"}\n` +
      `gapNote: ${packets.priceHistory.gapNote ?? "(none)"}\n` +
      `markdown:\n${packets.priceHistory.markdown}\n` +
      `bullets:\n${packets.priceHistory.bullets.join("\n") || "(empty)"}`
    : "(skipped)"

  const rentBlock = packets.rentHistory
    ? `available: ${packets.rentHistory.available}\n` +
      `gapNote: ${packets.rentHistory.gapNote ?? "(none)"}\n` +
      `markdown:\n${packets.rentHistory.markdown}\n` +
      `bullets:\n${packets.rentHistory.bullets.join("\n") || "(empty)"}`
    : "(skipped)"

  const briefingBlock = packets.portfolioBriefing
    ? `available: ${packets.portfolioBriefing.available}\n` +
      `assessment: ${packets.portfolioBriefing.assessment}\n` +
      `healthScore: ${packets.portfolioBriefing.healthScore ?? "unavailable"}\n` +
      `healthDelta4w: ${packets.portfolioBriefing.healthDelta4w ?? "unavailable"}\n` +
      `facts: ${JSON.stringify(packets.portfolioBriefing.facts)}\n` +
      `markdown:\n${packets.portfolioBriefing.markdown}\n` +
      `bullets:\n${packets.portfolioBriefing.bullets.join("\n") || "(empty)"}`
    : "(skipped)"

  const rankingBlock = packets.propertyRanking
    ? `available: ${packets.propertyRanking.available}\n` +
      `canRank: ${packets.propertyRanking.canRank}\n` +
      `missingData: ${JSON.stringify(packets.propertyRanking.missingData)}\n` +
      `portfolioOpenWorkOrders: ${packets.propertyRanking.portfolioOpenWorkOrders}\n` +
      `top: ${JSON.stringify(packets.propertyRanking.top)}\n` +
      `watch: ${JSON.stringify(packets.propertyRanking.watch)}\n` +
      `markdown:\n${packets.propertyRanking.markdown}\n` +
      `bullets:\n${packets.propertyRanking.bullets.join("\n") || "(empty)"}`
    : "(skipped)"

  const unitRankingBlock = packets.unitMaintenanceRanking
    ? `available: ${packets.unitMaintenanceRanking.available}\n` +
      `canRank: ${packets.unitMaintenanceRanking.canRank}\n` +
      `missingData: ${JSON.stringify(packets.unitMaintenanceRanking.missingData)}\n` +
      `timeframeLabel: ${packets.unitMaintenanceRanking.timeframeLabel}\n` +
      `timeframeIsDefault: ${packets.unitMaintenanceRanking.timeframeIsDefault}\n` +
      `scopeLabel: ${packets.unitMaintenanceRanking.scopeLabel}\n` +
      `scopedRequestCount: ${packets.unitMaintenanceRanking.scopedRequestCount}\n` +
      `unlinkedRequestCount: ${packets.unitMaintenanceRanking.unlinkedRequestCount}\n` +
      `openInScope: ${packets.unitMaintenanceRanking.openInScope}\n` +
      `top: ${JSON.stringify(packets.unitMaintenanceRanking.top)}\n` +
      `ranked: ${JSON.stringify(packets.unitMaintenanceRanking.ranked)}\n` +
      `markdown:\n${packets.unitMaintenanceRanking.markdown}\n` +
      `bullets:\n${packets.unitMaintenanceRanking.bullets.join("\n") || "(empty)"}`
    : "(skipped)"

  const periodSummaryBlock = packets.periodSummary
    ? `available: ${packets.periodSummary.available}\n` +
      `canSummarize: ${packets.periodSummary.canSummarize}\n` +
      `missingData: ${JSON.stringify(packets.periodSummary.missingData)}\n` +
      `periodLabel: ${packets.periodSummary.periodLabel}\n` +
      `periodIsDefault: ${packets.periodSummary.periodIsDefault}\n` +
      `scopeLabel: ${packets.periodSummary.scopeLabel}\n` +
      `facts: ${JSON.stringify(packets.periodSummary.facts)}\n` +
      `markdown:\n${packets.periodSummary.markdown}\n` +
      `bullets:\n${packets.periodSummary.bullets.join("\n") || "(empty)"}`
    : "(skipped)"

  const oldestWaitingBlock = packets.oldestWaitingWorkOrder
    ? `available: ${packets.oldestWaitingWorkOrder.available}\n` +
      `found: ${packets.oldestWaitingWorkOrder.found}\n` +
      `openCount: ${packets.oldestWaitingWorkOrder.openCount}\n` +
      `missingData: ${JSON.stringify(packets.oldestWaitingWorkOrder.missingData)}\n` +
      `oldest: ${JSON.stringify(packets.oldestWaitingWorkOrder.oldest)}\n` +
      `markdown:\n${packets.oldestWaitingWorkOrder.markdown}\n` +
      `bullets:\n${packets.oldestWaitingWorkOrder.bullets.join("\n") || "(empty)"}`
    : "(skipped)"

  const entityInvestigationBlock = packets.entityInvestigation
    ? `available: ${packets.entityInvestigation.available}\n` +
      `found: ${packets.entityInvestigation.found}\n` +
      `missingData: ${JSON.stringify(packets.entityInvestigation.missingData)}\n` +
      `primary: ${JSON.stringify(packets.entityInvestigation.primary)}\n` +
      `markdown:\n${packets.entityInvestigation.markdown}\n` +
      `bullets:\n${packets.entityInvestigation.bullets.join("\n") || "(empty)"}`
    : "(skipped)"

  const propertyInsightsBlock = packets.propertyInsights
    ? `available: ${packets.propertyInsights.available}\n` +
      `found: ${packets.propertyInsights.found}\n` +
      `sufficientForMaintenanceRisk: ${packets.propertyInsights.sufficientForMaintenanceRisk}\n` +
      `insights: ${JSON.stringify(packets.propertyInsights.insights)}\n` +
      `markdown:\n${packets.propertyInsights.markdown}\n` +
      `bullets:\n${packets.propertyInsights.bullets.join("\n") || "(empty)"}`
    : "(skipped)"

  const recurringRepairsBlock = packets.recurringRepairs
    ? `available: ${packets.recurringRepairs.available}\n` +
      `found: ${packets.recurringRepairs.found}\n` +
      `ticketCount: ${packets.recurringRepairs.ticketCount}\n` +
      `completedTicketCount: ${packets.recurringRepairs.completedTicketCount}\n` +
      `completedWorkflowCount: ${packets.recurringRepairs.completedWorkflowCount}\n` +
      `windowDays: ${packets.recurringRepairs.windowDays}\n` +
      `patterns: ${JSON.stringify(packets.recurringRepairs.patterns)}\n` +
      `markdown:\n${packets.recurringRepairs.markdown}\n` +
      `bullets:\n${packets.recurringRepairs.bullets.join("\n") || "(empty)"}`
    : "(skipped)"

  const repairsToApproveBlock = packets.repairsToApprove
    ? `available: ${packets.repairsToApprove.available}\n` +
      `found: ${packets.repairsToApprove.found}\n` +
      `openUrgentCount: ${packets.repairsToApprove.openUrgentCount}\n` +
      `awaitingCount: ${packets.repairsToApprove.awaitingCount}\n` +
      `items: ${JSON.stringify(packets.repairsToApprove.items)}\n` +
      `markdown:\n${packets.repairsToApprove.markdown}\n` +
      `bullets:\n${packets.repairsToApprove.bullets.join("\n") || "(empty)"}`
    : "(skipped)"

    const missingUpdatesBlock = packets.missingUpdates
    ? `available: ${packets.missingUpdates.available}\n` +
      `found: ${packets.missingUpdates.found}\n` +
      `openCount: ${packets.missingUpdates.openCount}\n` +
      `items: ${JSON.stringify(packets.missingUpdates.items)}\n` +
      `markdown:\n${packets.missingUpdates.markdown}\n` +
      `bullets:\n${packets.missingUpdates.bullets.join("\n") || "(empty)"}`
    : "(skipped)"

  const vendorResponseSpeedBlock = packets.vendorResponseSpeed
    ? `available: ${packets.vendorResponseSpeed.available}\n` +
      `found: ${packets.vendorResponseSpeed.found}\n` +
      `ranked: ${JSON.stringify(packets.vendorResponseSpeed.ranked)}\n` +
      `markdown:\n${packets.vendorResponseSpeed.markdown}\n` +
      `bullets:\n${packets.vendorResponseSpeed.bullets.join("\n") || "(empty)"}`
    : "(skipped)"

  const vendorBestBlock = packets.vendorBest
    ? `available: ${packets.vendorBest.available}\n` +
      `found: ${packets.vendorBest.found}\n` +
      `trade: ${packets.vendorBest.tradeSlug ?? "any"} (${packets.vendorBest.tradeLabel ?? ""})\n` +
      `ranked: ${JSON.stringify(packets.vendorBest.ranked)}\n` +
      `markdown:\n${packets.vendorBest.markdown}\n` +
      `bullets:\n${packets.vendorBest.bullets.join("\n") || "(empty)"}`
    : "(skipped)"
  const vendorCompletionBlock = packets.vendorCompletion
    ? `available: ${packets.vendorCompletion.available}\n` +
      `found: ${packets.vendorCompletion.found}\n` +
      `ranked: ${JSON.stringify(packets.vendorCompletion.ranked)}\n` +
      `markdown:\n${packets.vendorCompletion.markdown}\n` +
      `bullets:\n${packets.vendorCompletion.bullets.join("\n") || "(empty)"}`
    : "(skipped)"
  const vendorInactiveBlock = packets.vendorInactive
    ? `available: ${packets.vendorInactive.available}\n` +
      `found: ${packets.vendorInactive.found}\n` +
      `ranked: ${JSON.stringify(packets.vendorInactive.ranked)}\n` +
      `markdown:\n${packets.vendorInactive.markdown}\n` +
      `bullets:\n${packets.vendorInactive.bullets.join("\n") || "(empty)"}`
    : "(skipped)"

  const vendorOverloadBlock = packets.vendorOverload
    ? `available: ${packets.vendorOverload.available}\n` +
      `found: ${packets.vendorOverload.found}\n` +
      `ranked: ${JSON.stringify(packets.vendorOverload.ranked)}\n` +
      `markdown:\n${packets.vendorOverload.markdown}\n` +
      `bullets:\n${packets.vendorOverload.bullets.join("\n") || "(empty)"}`
    : "(skipped)"

  const vendorVerificationBlock = packets.vendorVerification
    ? `available: ${packets.vendorVerification.available}\n` +
      `found: ${packets.vendorVerification.found}\n` +
      `ranked: ${JSON.stringify(packets.vendorVerification.ranked)}\n` +
      `markdown:\n${packets.vendorVerification.markdown}\n` +
      `bullets:\n${packets.vendorVerification.bullets.join("\n") || "(empty)"}`
    : "(skipped)"

  const playbookBlock = packets.investigationPlaybook
    ? `id: ${packets.investigationPlaybook.id}\n` +
      `prefer_tier1_answer: ${packets.investigationPlaybook.preferTier1Answer}\n` +
      `consult_tier1_first: ${packets.investigationPlaybook.consultTier1First}\n` +
      `deep_ops_primary: ${packets.investigationPlaybook.deepOpsPrimary}\n`
    : "(skipped)"

  const deepOpsBlock = packets.deepOpsInvestigation
    ? `available: ${packets.deepOpsInvestigation.available}\n` +
      `found: ${packets.deepOpsInvestigation.found}\n` +
      `intent: ${
        packets.deepOpsInvestigation.isRepairCostQuestion
          ? "repair_cost_estimate"
          : "deep_operational_investigation"
      }\n` +
      `isRepairCostQuestion: ${packets.deepOpsInvestigation.isRepairCostQuestion}\n` +
      `categories: ${packets.deepOpsInvestigation.categories.join(", ")}\n` +
      `ticketCount: ${packets.deepOpsInvestigation.ticketCount}\n` +
      `missingFields: ${JSON.stringify(packets.deepOpsInvestigation.missingFields)}\n` +
      `operationalEvidence:\n${
        packets.deepOpsInvestigation.operationalEvidenceJson ||
        JSON.stringify({ workOrders: packets.deepOpsInvestigation.workOrders ?? [] }, null, 2)
      }\n` +
      `markdown:\n${packets.deepOpsInvestigation.markdown}\n` +
      `bullets:\n${packets.deepOpsInvestigation.bullets.join("\n") || "(empty)"}`
    : "(skipped)"

  const toolBrief =
    `INTENT: ${packets.intent} (${packets.intentLabel}) — answer this goal only.\n` +
    (packets.question ? taskContractPromptBlock(packets.question) : "") +
    (packets.question ? investigationDefinitionPromptBlock(packets.question) : "") +
    (packets.question ? responseSufficiencyPromptBlock(packets.question) : "") +
    missingInfoCommunicationPromptBlock() +
    (packets.question ? investigationPlaybookPromptBlock(packets.question) : "") +
    `${NEVER_IGNORE_ULO_INTELLIGENCE_GUIDE}\n` +
    (packets.question ? deepOperationalInvestigationPromptBlock(packets.question) : "") +
    (packets.question ? entityInvestigationPromptBlock(packets.question) : "") +
    `REASONING_MODE: ${packets.reasoningMode ?? "factual"} — follow the structure for this mode; never echo mode/intent labels to the user.\n` +
    `RESPONSE_FORMAT: ${packets.responseFormat ?? "adaptive"} — choose deliverable shape accordingly; never echo this label.\n` +
    `Complete the user's task. Prefer multi-domain synthesis for executive_briefing / prioritization.\n` +
    `Do not reuse a market-analysis template unless INTENT is market_analysis.\n` +
    `Do not reuse an executive-briefing template unless INTENT is executive_briefing or property_health.\n` +
    `Do not reuse a period-summary template unless INTENT is period_summary.\n` +
    `For period_summary: use PERIOD SUMMARY; never answer with only current open-ticket count.\n` +
    `For oldest_waiting_work_order: use OLDEST WAITING WORK ORDER; never answer with portfolio open-ticket count alone.\n` +
    `For entity_investigation: use ENTITY INVESTIGATION; never answer with portfolio totals, health scores, or dashboard KPIs.\n` +
    `For maintenance_risk / predictive questions: prefer PROPERTY INSIGHTS (Tier 1) when found=true — do not claim insufficient info.\n` +
    `For recurring_repairs: prefer RECURRING REPAIRS (includes completed work orders) — lead with the repeated repair, count, and 60-day window.\n` +
    `For deep ops / repair-cost questions: use DEEP OPS INVESTIGATION; if found=true, lead with the ticket finding — missing detail ≠ missing records.\n` +
    `For unit_maintenance_ranking: use UNIT MAINTENANCE RANKING; answer units by request count — never a portfolio open-ticket total.\n` +
    `For property_priority / comparison_ranking / diagnosis / recommendation: use PROPERTY RANKING; never answer with only a portfolio-wide ticket total.\n` +
    `For vendor_speed: use VENDOR RESPONSE SPEED only when they asked about respond/fastest.\n` +
    `For vendor_completion / “highest completion rate”: use VENDOR COMPLETION — never property priority.\n` +
    `For vendor_inactive / “haven’t accepted”: use VENDOR INACTIVE — never portfolio briefing.\n` +
    `For vendor_overload / “overloaded” / “busiest”: use VENDOR OVERLOAD (open jobs) — never overall best/score.\n` +
    `For vendor_verification / “verification status” / “verified vendors”: use VENDOR VERIFICATION (chips) — never portfolio briefing.\n` +
    `For vendor_best / “best electrician”: use VENDOR BEST (overall score by trade) — never response-speed-only.\n` +
    `Never answer a vendor question with a portfolio briefing packet (health score / occupancy / hotspots).\n` +
    `Before responding, verify the answer matches the subject, metric, timeframe, and scope in the user's question.\n` +
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
      ? "PRIVACY: screening_isolation=true — do not request or invent tenant SSN, DOB, full credit files, or other screening PII; keep guidance criteria-level only.\n"
      : "") +
    `\n` +
    `Jurisdiction context:\n${JSON.stringify(packets.jurisdiction)}\n\n` +
    `Tools used: ${packets.toolsUsed.join(", ") || "none"}\n\n` +
    `INVESTIGATION PLAYBOOK:\n${playbookBlock}\n\n` +
    `REPAIRS TO APPROVE (urgent open work + landlord-awaiting workflows — not screening):\n${repairsToApproveBlock}\n\n` +
    `MISSING UPDATES (open stuck work orders — not a single deep-ops card):\n${missingUpdatesBlock}\n\n` +
    `VENDOR BEST (overall vendor_score by trade — “best electrician”, not response speed):\n${vendorBestBlock}\n\n` +
    `VENDOR COMPLETION (completion_rate — “highest completion rate”, never property priority):\n${vendorCompletionBlock}\n\n` +
    `VENDOR INACTIVE (pending accept / no recent accepts — never portfolio briefing):\n${vendorInactiveBlock}\n\n` +
    `VENDOR OVERLOAD (open assigned jobs — “overloaded / busiest”, never overall best score):\n${vendorOverloadBlock}\n\n` +
    `VENDOR VERIFICATION (verification pill + capacity chip from vendor_verifications):\n${vendorVerificationBlock}\n\n` +
    `VENDOR RESPONSE SPEED (source of truth for which vendors respond fastest):\n${vendorResponseSpeedBlock}\n\n` +
    `RECURRING REPAIRS (repair-level evidence from open + completed work orders / workflows — not Property Insights cards):\n${recurringRepairsBlock}\n\n` +
    `PROPERTY INSIGHTS (Tier 1 — Overview Recurring / Needs Attention / Prevent Future Repairs):\n${propertyInsightsBlock}\n\n` +
    `PERIOD SUMMARY (source of truth for period_summary — activity in the window):\n${periodSummaryBlock}\n\n` +
    `OLDEST WAITING WORK ORDER (source of truth for oldest_waiting_work_order):\n${oldestWaitingBlock}\n\n` +
    `ENTITY INVESTIGATION (source of truth for entity_investigation):\n${entityInvestigationBlock}\n\n` +
    `DEEP OPS INVESTIGATION (Tier 2 — category synonym search; use after Tier 1 unless repair-cost primary):\n${deepOpsBlock}\n\n` +
    `UNIT MAINTENANCE RANKING (source of truth for unit_maintenance_ranking — volume by unit_id):\n${unitRankingBlock}\n\n` +
    `PROPERTY RANKING (source of truth for property_priority — severity before volume):\n${rankingBlock}\n\n` +
    `PORTFOLIO BRIEFING (source of truth for executive_briefing — never invent scores):\n${briefingBlock}\n\n` +
    `PRICE HISTORY:\n${priceBlock}\n\n` +
    `RENT HISTORY:\n${rentBlock}\n\n` +
    `LIVE MARKET DATA:\n${marketBlock}\n\n` +
    `PROPERTY SNAPSHOT (support only — omit inventory unless it changes the recommendation; never lead with it):\n${
      (packets.property?.bullets ?? []).join("\n") || "(skipped)"
    }\n\n` +
    `OPS / LEASING IMPACT (same rule — only material facts):\n${
      (packets.ops?.bullets ?? []).join("\n") || "(skipped)"
    }\n\n` +
    `STRUCTURED COMPLIANCE:\n${(packets.structured?.bullets ?? []).join("\n") || "(skipped)"}\n\n` +
    `LEGAL RAG (${packets.legal?.mode ?? "n/a"}):\n${
      (packets.legal?.bullets ?? []).join("\n") || "(skipped)"
    }\n`

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
      `Use the retrieval packets below for grounded facts (do not invent rents, comps, valuations, or laws).\n` +
      `Translate every packet into plain English for the user — never echo raw keys, tags like [official],\n` +
      `usd_per_month, portfolio sample, ops, workflow, or requirement/guidance labels.\n` +
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
  const started = Date.now()
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: ANSWER_MODEL,
      temperature,
      messages,
    }),
  })

  const data = (await res.json()) as Record<string, unknown>
  if (!res.ok) {
    const errObj = data?.error as { message?: string } | undefined
    console.error("[ask_ulo/synthesize] OpenAI error", res.status, errObj?.message ?? data)
    return null
  }

  const choices = data?.choices as unknown
  const first =
    Array.isArray(choices) && choices.length > 0
      ? (choices[0] as Record<string, unknown>)
      : null
  const message = first?.message as Record<string, unknown> | undefined
  const content = message?.content
  if (typeof content !== "string" || !content.trim()) return null

  const usageRaw = data?.usage as Record<string, unknown> | undefined
  const usage: AskUloTokenUsage | null = usageRaw
    ? {
        promptTokens:
          typeof usageRaw.prompt_tokens === "number" ? usageRaw.prompt_tokens : null,
        completionTokens:
          typeof usageRaw.completion_tokens === "number"
            ? usageRaw.completion_tokens
            : null,
        totalTokens:
          typeof usageRaw.total_tokens === "number" ? usageRaw.total_tokens : null,
      }
    : null

  return {
    text: stripJsonFence(content).trim(),
    usage,
    synthesizeMs: Date.now() - started,
  }
}

function emptyUsageSynthesis(
  answer: string,
  citations: AskUloCitation[],
  mode: "openai" | "fallback",
  model: string | null,
): AskUloSynthesis {
  return {
    answer,
    citations,
    mode,
    model,
    usage: null,
    synthesizeMs: null,
  }
}

export async function synthesizeAskUloAnswer(
  packets: AskUloToolPackets,
): Promise<AskUloSynthesis> {
  const citations = mergeCitations(packets)
  const hasOpenAi = Boolean(Deno.env.get("OPENAI_API_KEY")?.trim())

  const finish = (
    answer: string,
    mode: "openai" | "fallback",
    model: string | null,
    extra?: { usage?: AskUloTokenUsage | null; synthesizeMs?: number | null },
  ): AskUloSynthesis => {
    const withTransparency = ensureReasoningTransparency(answer, packets)
    return {
      answer: withTransparency,
      citations,
      mode,
      model,
      usage: extra?.usage ?? null,
      synthesizeMs: extra?.synthesizeMs ?? null,
    }
  }

  // Legal clarify / refuse — never invent guidance without location or sources.
  if (
    packets.intent === "legal" &&
    packets.legalGate &&
    (packets.legalGate.status === "clarify" || packets.legalGate.status === "refuse") &&
    packets.legalGate.markdown
  ) {
    return emptyUsageSynthesis(packets.legalGate.markdown, citations, "fallback", null)
  }

  // Deterministic tables for price/rent history — stay tightly scoped to the question.
  if (
    packets.intent === "property_price_history" ||
    packets.intent === "price_history_ambiguous"
  ) {
    if (packets.priceHistory?.markdown) {
      return finish(
        packets.priceHistory.markdown,
        hasOpenAi ? "openai" : "fallback",
        hasOpenAi ? ANSWER_MODEL : null,
      )
    }
  }
  if (packets.intent === "rent_history" && packets.rentHistory?.markdown) {
    return finish(
      packets.rentHistory.markdown,
      hasOpenAi ? "openai" : "fallback",
      hasOpenAi ? ANSWER_MODEL : null,
    )
  }

  // Repairs-to-approve / missing-updates / recurring beat empty deep-ops shells.
  if (packets.residents?.markdown && packets.residents.available) {
    return finish(
      packets.residents.markdown,
      hasOpenAi ? "openai" : "fallback",
      hasOpenAi ? ANSWER_MODEL : null,
    )
  }
  if (packets.repairsToApprove?.markdown && packets.repairsToApprove.available) {
    return finish(
      packets.repairsToApprove.markdown,
      hasOpenAi ? "openai" : "fallback",
      hasOpenAi ? ANSWER_MODEL : null,
    )
  }
  if (packets.missingUpdates?.markdown && packets.missingUpdates.available) {
    return finish(
      packets.missingUpdates.markdown,
      hasOpenAi ? "openai" : "fallback",
      hasOpenAi ? ANSWER_MODEL : null,
    )
  }
  if (packets.vendorInactive?.markdown && packets.vendorInactive.available) {
    return finish(
      packets.vendorInactive.markdown,
      hasOpenAi ? "openai" : "fallback",
      hasOpenAi ? ANSWER_MODEL : null,
    )
  }
  if (packets.vendorOverload?.markdown && packets.vendorOverload.available) {
    return finish(
      packets.vendorOverload.markdown,
      hasOpenAi ? "openai" : "fallback",
      hasOpenAi ? ANSWER_MODEL : null,
    )
  }
  if (packets.vendorVerification?.markdown && packets.vendorVerification.available) {
    return finish(
      packets.vendorVerification.markdown,
      hasOpenAi ? "openai" : "fallback",
      hasOpenAi ? ANSWER_MODEL : null,
    )
  }
  if (packets.vendorCompletion?.markdown && packets.vendorCompletion.available) {
    return finish(
      packets.vendorCompletion.markdown,
      hasOpenAi ? "openai" : "fallback",
      hasOpenAi ? ANSWER_MODEL : null,
    )
  }
  if (packets.vendorBest?.markdown && packets.vendorBest.available) {
    return finish(
      packets.vendorBest.markdown,
      hasOpenAi ? "openai" : "fallback",
      hasOpenAi ? ANSWER_MODEL : null,
    )
  }
  if (packets.vendorResponseSpeed?.markdown && packets.vendorResponseSpeed.available) {
    return finish(
      packets.vendorResponseSpeed.markdown,
      hasOpenAi ? "openai" : "fallback",
      hasOpenAi ? ANSWER_MODEL : null,
    )
  }
  if (packets.recurringRepairs?.markdown && packets.recurringRepairs.available) {
    return finish(
      packets.recurringRepairs.markdown,
      hasOpenAi ? "openai" : "fallback",
      hasOpenAi ? ANSWER_MODEL : null,
    )
  }

  // Tier 1 Property Insights beat empty deep-ops "unavailable" shells.
  // Never for market rent / comps.
  if (
    packets.intent !== "market_rent_estimate" &&
    packets.intent !== "comparable_rentals" &&
    packets.intent !== "market_analysis" &&
    detectQuestionSubject(packets.question) !== "market_intelligence" &&
    packets.investigationPlaybook?.preferTier1Answer &&
    packets.propertyInsights?.found &&
    packets.propertyInsights.markdown
  ) {
    return finish(
      packets.propertyInsights.markdown,
      hasOpenAi ? "openai" : "fallback",
      hasOpenAi ? ANSWER_MODEL : null,
    )
  }

  // Deep ops / repair-cost: use matching records only — never force an empty available shell.
  if (
    packets.deepOpsInvestigation?.markdown &&
    (packets.deepOpsInvestigation.found ||
      (packets.deepOpsInvestigation.isRepairCostQuestion &&
        packets.investigationPlaybook?.deepOpsPrimary !== false))
  ) {
    return finish(
      packets.deepOpsInvestigation.markdown,
      hasOpenAi ? "openai" : "fallback",
      hasOpenAi ? ANSWER_MODEL : null,
    )
  }

  // Structured incomplete ranking — code renders the gap; never ask the LLM to invent + self-censor.
  const incompleteRanking = resolveIncompleteRankingSignal({
    propertyRanking: packets.propertyRanking
      ? {
          available: packets.propertyRanking.available,
          canRank: packets.propertyRanking.canRank,
          missingData: packets.propertyRanking.missingData,
          portfolioOpenWorkOrders: packets.propertyRanking.portfolioOpenWorkOrders,
        }
      : null,
    unitMaintenanceRanking: packets.unitMaintenanceRanking
      ? {
          available: packets.unitMaintenanceRanking.available,
          canRank: packets.unitMaintenanceRanking.canRank,
          missingData: packets.unitMaintenanceRanking.missingData,
          requestCount: packets.unitMaintenanceRanking.scopedRequestCount,
          unlinkedRequestCount: packets.unitMaintenanceRanking.unlinkedRequestCount,
          timeframeLabel: packets.unitMaintenanceRanking.timeframeLabel,
          scopeLabel: packets.unitMaintenanceRanking.scopeLabel,
        }
      : null,
    reasoningMode: packets.reasoningMode,
    preferUnit:
      packets.intent === "unit_maintenance_ranking" ||
      Boolean(packets.unitMaintenanceRanking && !packets.propertyRanking),
  })
  if (incompleteRanking) {
    const rankingPrimary =
      packets.intent === "property_priority" ||
      packets.intent === "unit_maintenance_ranking" ||
      packets.reasoningMode === "comparison_ranking" ||
      packets.reasoningMode === "diagnosis" ||
      packets.reasoningMode === "recommendation"
    if (rankingPrimary) {
      return finish(incompleteRanking.markdown, "fallback", null)
    }
  }

  const apiKey = Deno.env.get("OPENAI_API_KEY")?.trim()
  if (apiKey) {
    try {
      // Strip inventable ranking winners when status is incomplete — even for non-primary paths.
      const safePackets =
        incompleteRanking && packets.propertyRanking && !packets.propertyRanking.canRank
          ? {
              ...packets,
              propertyRanking: {
                ...packets.propertyRanking,
                top: null,
                watch: [],
                markdown: incompleteRanking.kind === "property_ranking"
                  ? incompleteRanking.markdown
                  : packets.propertyRanking.markdown,
              },
            }
          : incompleteRanking &&
              packets.unitMaintenanceRanking &&
              !packets.unitMaintenanceRanking.canRank
            ? {
                ...packets,
                unitMaintenanceRanking: {
                  ...packets.unitMaintenanceRanking,
                  top: null,
                  ranked: [],
                  markdown: incompleteRanking.kind === "unit_maintenance_ranking"
                    ? incompleteRanking.markdown
                    : packets.unitMaintenanceRanking.markdown,
                },
              }
            : packets
      const openai = await synthesizeWithOpenAI(apiKey, safePackets)
      if (openai) {
        return finish(openai.text, "openai", ANSWER_MODEL, {
          usage: openai.usage,
          synthesizeMs: openai.synthesizeMs,
        })
      }
    } catch (err) {
      console.error("[ask_ulo/synthesize] threw", err)
    }
  }
  return finish(buildFallbackAskUloAnswer(packets), "fallback", null)
}
