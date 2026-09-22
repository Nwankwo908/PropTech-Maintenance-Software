/**
 * One recognizer for "what is this inbound text about?".
 *
 * There used to be a second, hand-maintained keyword list in the SMS gate that
 * drifted from the rules the intake classifier uses, so texts like "no hot
 * water" fell through to the repair / rent / lease menu. Everything now stops
 * at the first confident layer:
 *
 *  1. Emergency net — deterministic, English + Spanish, never model-overridden
 *  2. Greeting / thanks / acknowledgement
 *  3. Other non-repair intents: rent, lease or move-out, human, complaint, status
 *  4. Repair via the shared deterministic rules (the intake classifier's source)
 *  5. Semantic match against the classifier phrase library (cached embeddings)
 *  6. Fresh threads only: one small LLM call (4s, JSON)
 *  7. Default: any problem signal starts intake and confirms the reading out
 *     loud; the menu is only for messages with no signal at all
 */
import {
  hasProblemSignal,
  matchDeterministicRules,
  matchEmergencyNet,
} from "../../../../shared/maintenance/deterministicRules.ts"
import { resolveAmbiguousMaintenance } from "../../../../shared/maintenance/ambiguityResolution.ts"
import type { EmergencyType } from "../../../../shared/maintenance/classificationTypes.ts"
import { semanticMatchDescription } from "../maintenance_classification/semanticMap.ts"
import { classifyAssistantOtherMessage } from "./tenantAssistantReply.ts"
import { classifyRentSmsIntent } from "./rentIntent.ts"
import { isLeaseRenewalInquirySms } from "./leaseRenewalInquiry.ts"
import {
  classifyLeaseTopic,
  looksLikeMaintenanceStatusAsk,
  looksLikeMoveOutIntent,
} from "./nonRepairIntents.ts"
import { bridgeSpanishMaintenanceText } from "./spanishMaintenanceText.ts"

export const INBOUND_INTENTS = [
  "emergency",
  "repair",
  "status_check",
  "rent",
  "lease",
  "move_out",
  "small_talk",
  "human_request",
  "complaint_or_legal",
  "unclear",
] as const

export type InboundIntent = (typeof INBOUND_INTENTS)[number]

export const RECOGNIZER_LAYERS = [
  "emergency_net",
  "small_talk",
  "non_repair",
  "rules",
  "semantic",
  "llm",
  "problem_signal",
  "menu",
] as const

export type RecognizerLayer = (typeof RECOGNIZER_LAYERS)[number]

export type InboundIntentRecognition = {
  intent: InboundIntent
  confidence: number
  layer: RecognizerLayer
  issueSummary: string | null
  /** Show the repair / rent / lease menu. Only true when nothing signalled. */
  showMenu: boolean
  /** "Sounds like no hot water, is that right?" for low-confidence repairs. */
  confirmation: string | null
  emergencyType: EmergencyType | null
}

export type RecognizeInboundIntentContext = {
  /** No open intake and no open ticket — the only place the LLM layer runs. */
  freshThread?: boolean
  activeIntake?: boolean
  openTicketCount?: number
  skipSemantic?: boolean
  skipLlm?: boolean
  openaiKey?: string | null
  fetchImpl?: typeof fetch
}

/** Rule weight that counts as a repair. Lower than the bar for picking a trade. */
const RULE_REPAIR_WEIGHT = 0.55
const SEMANTIC_ACCEPT_SCORE = 0.5
const LLM_TIMEOUT_MS = 4000

export function isRepairRecognition(
  recognition: InboundIntentRecognition,
): boolean {
  return recognition.intent === "repair" || recognition.intent === "emergency"
}

/** Filler that shouldn't lead the confirmation line back to the resident. */
const SUMMARY_PREFIX =
  /^(hi|hello|hey|good\s*(morning|afternoon|evening))[,!.\s]+/i
const SUMMARY_LEAD =
  /^(i\s+(?:have|think|need|wanted?\s+to\s+(?:report|say))|there(?:['’]s|\s+(?:is|are))|we\s+have|my\s+unit\s+has|can\s+(?:you|someone)\s+(?:fix|look\s+at|send\s+someone\s+for))\s+/i

/** Short, plain-language echo of the problem for the confirm-back question. */
export function summarizeIssueText(text: string): string | null {
  let summary = text.trim().replace(/\s+/g, " ")
  if (!summary) return null
  summary = summary.replace(SUMMARY_PREFIX, "").replace(SUMMARY_LEAD, "")
  summary = summary.replace(/^(a|an|the)\s+/i, "")
  summary = summary.split(/(?<=[.!?])\s+/)[0] ?? summary
  summary = summary.replace(/[.!?]+$/, "").trim()
  if (!summary) return null
  if (summary.length > 70) summary = `${summary.slice(0, 67).trimEnd()}...`
  return summary.charAt(0).toLowerCase() + summary.slice(1)
}

function confirmationFor(summary: string | null): string | null {
  if (!summary) return null
  return `Sounds like ${summary}, is that right?`
}

function recognition(
  partial: Partial<InboundIntentRecognition> & {
    intent: InboundIntent
    confidence: number
    layer: RecognizerLayer
  },
): InboundIntentRecognition {
  return {
    issueSummary: null,
    showMenu: false,
    confirmation: null,
    emergencyType: null,
    ...partial,
  }
}

/** Layer 1. Deterministic life-safety net — runs before anything else. */
function emergencyLayer(bridged: string): InboundIntentRecognition | null {
  const hit = matchEmergencyNet(bridged)
  if (!hit) return null
  return recognition({
    intent: "emergency",
    confidence: 1,
    layer: "emergency_net",
    issueSummary: summarizeIssueText(bridged),
    emergencyType: hit.type,
  })
}

/** Layer 2. Greeting / thanks / acknowledgement. */
function smallTalkLayer(body: string): InboundIntentRecognition | null {
  if (classifyAssistantOtherMessage(body) !== "small_talk") return null
  return recognition({
    intent: "small_talk",
    confidence: 0.9,
    layer: "small_talk",
  })
}

/** Layer 3. Rent, lease / move-out, human request, complaint, status check. */
function nonRepairLayer(
  body: string,
  ctx: RecognizeInboundIntentContext,
): InboundIntentRecognition | null {
  const rent = classifyRentSmsIntent(body)
  if (rent.kind !== null) {
    return recognition({
      intent: "rent",
      confidence: rent.confident ? 0.9 : 0.6,
      layer: "non_repair",
    })
  }

  if (isLeaseRenewalInquirySms(body) || classifyLeaseTopic(body)) {
    return recognition({ intent: "lease", confidence: 0.9, layer: "non_repair" })
  }

  if (looksLikeMoveOutIntent(body)) {
    return recognition({
      intent: "move_out",
      confidence: 0.85,
      layer: "non_repair",
    })
  }

  const other = classifyAssistantOtherMessage(body)
  if (other === "human_request" || other === "complaint_or_legal") {
    return recognition({ intent: other, confidence: 0.85, layer: "non_repair" })
  }

  if (looksLikeMaintenanceStatusAsk(body)) {
    return recognition({
      intent: "status_check",
      confidence: ctx.openTicketCount && ctx.openTicketCount > 0 ? 0.9 : 0.75,
      layer: "non_repair",
    })
  }

  return null
}

/** Layer 4. The same deterministic rules the intake classifier runs on. */
function rulesLayer(
  original: string,
  bridged: string,
): InboundIntentRecognition | null {
  const ambiguous = resolveAmbiguousMaintenance(bridged)
  if (ambiguous.handled) {
    return recognition({
      intent: "repair",
      confidence: Math.max(0.75, Math.min(0.95, ambiguous.confidence || 0.8)),
      layer: "rules",
      issueSummary: summarizeIssueText(original),
    })
  }

  const top = matchDeterministicRules(bridged)[0]
  if (!top || top.weight < RULE_REPAIR_WEIGHT) return null

  const summary = summarizeIssueText(original)
  const confidence = Math.min(0.95, top.weight)
  return recognition({
    intent: "repair",
    confidence,
    layer: "rules",
    issueSummary: summary,
    emergencyType: top.emergency === "none" ? null : top.emergency,
    // Weak keyword hits still confirm the reading in the first question.
    confirmation: confidence < 0.8 ? confirmationFor(summary) : null,
  })
}

/** Layer 5. Phrase library from the classifier; embeddings are cached there. */
async function semanticLayer(
  original: string,
  bridged: string,
): Promise<InboundIntentRecognition | null> {
  const matches = await semanticMatchDescription(bridged)
  const top = matches[0]
  if (!top || top.score < SEMANTIC_ACCEPT_SCORE) return null
  const summary = summarizeIssueText(original)
  return recognition({
    intent: "repair",
    confidence: Math.min(0.85, top.score),
    layer: "semantic",
    issueSummary: summary,
    confirmation: confirmationFor(summary),
  })
}

const LLM_SYSTEM_PROMPT = [
  "You label one text message a resident sent to their property manager.",
  'Reply with JSON only: {"intent": string, "confidence": number, "issue_summary": string}.',
  'intent is one of: repair, rent, lease, move_out, status_check, small_talk, human_request, complaint_or_legal, unclear.',
  'Anything describing something broken, leaking, not working, damaged, pest-related or unsafe is "repair" — never "unclear".',
  "issue_summary is a short plain-language phrase describing the problem, or an empty string when there is none.",
  "confidence is between 0 and 1.",
].join("\n")

function asIntent(raw: unknown): InboundIntent | null {
  if (typeof raw !== "string") return null
  const value = raw.trim().toLowerCase().replace(/[\s-]+/g, "_")
  return (INBOUND_INTENTS as readonly string[]).includes(value)
    ? (value as InboundIntent)
    : null
}

/** Layer 6. One small JSON call, 4s budget. Failure falls through to layer 7. */
async function llmLayer(
  body: string,
  ctx: RecognizeInboundIntentContext,
): Promise<InboundIntentRecognition | null> {
  const apiKey = (ctx.openaiKey ?? Deno.env.get("OPENAI_API_KEY") ?? "").trim()
  if (!apiKey) return null
  const fetchImpl = ctx.fetchImpl ?? fetch

  try {
    const res = await fetchImpl("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      signal: AbortSignal.timeout(LLM_TIMEOUT_MS),
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0,
        max_tokens: 120,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: LLM_SYSTEM_PROMPT },
          { role: "user", content: body.slice(0, 600) },
        ],
      }),
    })
    if (!res.ok) return null
    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>
    }
    const content = data.choices?.[0]?.message?.content?.trim()
    if (!content) return null
    const parsed = JSON.parse(content.replace(/```json|```/g, "").trim()) as {
      intent?: unknown
      confidence?: unknown
      issue_summary?: unknown
    }
    const intent = asIntent(parsed.intent)
    if (!intent || intent === "unclear") return null
    const rawSummary = typeof parsed.issue_summary === "string"
      ? parsed.issue_summary.trim()
      : ""
    const summary = rawSummary ? summarizeIssueText(rawSummary) : null
    const confidence = typeof parsed.confidence === "number"
      ? Math.max(0, Math.min(1, parsed.confidence))
      : 0.7
    return recognition({
      intent,
      confidence,
      layer: "llm",
      issueSummary: intent === "repair" ? summary : null,
      confirmation: intent === "repair" ? confirmationFor(summary) : null,
    })
  } catch (error) {
    console.warn(
      "[sms-recognize] intent LLM layer unavailable",
      error instanceof Error ? error.message : String(error),
    )
    return null
  }
}

/** Layer 7. Any problem signal starts intake; only silence gets the menu. */
function fallbackLayer(
  original: string,
  bridged: string,
): InboundIntentRecognition {
  if (hasProblemSignal(bridged)) {
    const summary = summarizeIssueText(original)
    return recognition({
      intent: "repair",
      confidence: 0.5,
      layer: "problem_signal",
      issueSummary: summary,
      confirmation: confirmationFor(summary),
    })
  }
  return recognition({
    intent: "unclear",
    confidence: 0.3,
    layer: "menu",
    showMenu: true,
  })
}

/** Layers 1-4 and 7. No network, so the inbound gate can stay synchronous. */
export function recognizeInboundIntentSync(
  body: string,
  ctx: RecognizeInboundIntentContext = {},
): InboundIntentRecognition {
  const original = body.trim()
  if (!original) {
    return recognition({
      intent: "unclear",
      confidence: 0,
      layer: "menu",
      showMenu: true,
    })
  }
  const bridged = bridgeSpanishMaintenanceText(original)

  return emergencyLayer(bridged) ??
    smallTalkLayer(original) ??
    nonRepairLayer(original, ctx) ??
    rulesLayer(original, bridged) ??
    fallbackLayer(original, bridged)
}

/**
 * Full recognizer. Adds the semantic and LLM layers between the deterministic
 * rules and the fallback.
 */
export async function recognizeInboundIntent(
  body: string,
  ctx: RecognizeInboundIntentContext = {},
): Promise<InboundIntentRecognition> {
  const original = body.trim()
  if (!original) return recognizeInboundIntentSync(body, ctx)
  const bridged = bridgeSpanishMaintenanceText(original)

  const deterministic = emergencyLayer(bridged) ??
    smallTalkLayer(original) ??
    nonRepairLayer(original, ctx) ??
    rulesLayer(original, bridged)
  if (deterministic) return deterministic

  if (!ctx.skipSemantic) {
    const semantic = await semanticLayer(original, bridged)
    if (semantic) return semantic
  }

  const freshThread = ctx.freshThread ??
    (!ctx.activeIntake && !(ctx.openTicketCount && ctx.openTicketCount > 0))
  if (freshThread && !ctx.skipLlm) {
    const llm = await llmLayer(original, ctx)
    if (llm) return llm
  }

  return fallbackLayer(original, bridged)
}
