import type {
  ClassifyMaintenanceSmsContext,
  IssueType,
  SeverityLevel,
  VendorTrade,
} from "./types.ts"
import {
  fetchLlmClassificationJson,
  type LlmClassifyFetch,
  type LlmDraftProvider,
} from "./llmClassifyProvider.ts"

const SMS_INTENTS = [
  "maintenance_new",
  "maintenance_status",
  "maintenance_update",
  "maintenance_cancel",
  "schedule_change",
  "access_instruction",
  "rent_balance",
  "rent_late",
  "lease_info",
  "move_out_intent",
  "other",
] as const

export type LlmSmsIntent = (typeof SMS_INTENTS)[number]

export type LlmSmsInterpretation = {
  addressesPending: boolean
  pendingAnswer?: string
  intent: LlmSmsIntent | null
  extractedSlots: Record<string, string>
  needsClarification: boolean
}

export type LlmClassificationDraft = {
  vendorTrade: VendorTrade | null
  issueType: IssueType | null
  severity: SeverityLevel | null
  reasoning: string
  confidence: number
  interpretation?: LlmSmsInterpretation
  /** Transport that produced this draft. Not used for matching or SLA. */
  provider?: LlmDraftProvider
}

const TRADES: VendorTrade[] = [
  "appliance_repair",
  "carpentry",
  "cleaning",
  "concrete",
  "deck_builder",
  "electrical",
  "flooring",
  "general",
  "hvac",
  "landscaping",
  "locksmith",
  "masonry",
  "painting",
  "pest_control",
  "plumbing",
  "roofing",
  "windows",
  "other",
]

const ISSUES: IssueType[] = [
  "leak",
  "plumbing",
  "electrical",
  "hvac",
  "appliance",
  "lock",
  "pest",
  "roofing",
  "general",
  "other",
]

function asTrade(raw: unknown): VendorTrade | null {
  if (typeof raw !== "string") return null
  const v = raw.trim().toLowerCase().replace(/[\s-]+/g, "_")
  if (v === "appliance") return "appliance_repair"
  if (v === "pest") return "pest_control"
  if (v === "deck" || v === "decking") return "deck_builder"
  if (v === "mason" || v === "brick") return "masonry"
  if (v === "cement" || v === "concrete_contractor") return "concrete"
  if (v === "handyman") return "general"
  if ((TRADES as string[]).includes(v)) return v as VendorTrade
  return null
}

function asIssue(raw: unknown): IssueType | null {
  if (typeof raw !== "string") return null
  const v = raw.trim().toLowerCase()
  if (v === "appliance_repair") return "appliance"
  if ((ISSUES as string[]).includes(v)) return v as IssueType
  return null
}

function asSeverity(raw: unknown): SeverityLevel | null {
  if (typeof raw !== "string") return null
  const v = raw.trim().toLowerCase()
  if (v === "critical" || v === "emergency") return "critical"
  if (v === "urgent" || v === "high") return "urgent"
  if (v === "low") return "low"
  if (v === "normal" || v === "medium") return "normal"
  return null
}

function asSmsIntent(raw: unknown): LlmSmsIntent | null {
  if (typeof raw !== "string") return null
  const v = raw.trim().toLowerCase()
  if ((SMS_INTENTS as readonly string[]).includes(v)) return v as LlmSmsIntent
  return null
}

function asSlots(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {}
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value === "string" && value.trim()) {
      out[key] = value.trim().slice(0, 240)
    }
  }
  return out
}

function parseInterpretation(parsed: Record<string, unknown>): LlmSmsInterpretation | undefined {
  const nested = parsed.interpretation
  const src = nested && typeof nested === "object" && !Array.isArray(nested)
    ? nested as Record<string, unknown>
    : parsed
  const intent = asSmsIntent(src.intent ?? src.sms_intent)
  if (intent == null && src.addresses_pending == null && src.addressesPending == null) {
    return undefined
  }
  const pendingAnswer = typeof src.pending_answer === "string"
    ? src.pending_answer
    : typeof src.pendingAnswer === "string"
    ? src.pendingAnswer
    : undefined
  return {
    addressesPending: src.addresses_pending === true || src.addressesPending === true,
    pendingAnswer: pendingAnswer?.trim() ? pendingAnswer.trim().slice(0, 120) : undefined,
    intent,
    extractedSlots: asSlots(src.extracted_slots ?? src.extractedSlots),
    needsClarification: src.needs_clarification === true || src.needsClarification === true,
  }
}

function smsContextPrompt(smsContext: ClassifyMaintenanceSmsContext): string {
  const parts = [
    `Also classify the resident SMS intent. Add JSON keys:`,
    `- intent: one of ${SMS_INTENTS.join(", ")}`,
    `- addresses_pending: true if this message answers the pending question`,
    `- pending_answer: short normalized answer when addresses_pending is true`,
    `- extracted_slots: object of short string facts (access notes, dates, amounts)`,
    `- needs_clarification: true if the intent is unclear`,
    `lease_info = asking for a copy of the lease, lease dates, or other leasing information (not a repair and not a renewal).`,
    `rent_balance = asking what they currently owe / their balance / amount due / whether they are paid up — in any natural wording (word order does not matter; "rent" is optional).`,
    `Do not use rent_balance for: when rent is due, send payment link, did my payment go through, or I'm going to be late.`,
    `other = not a repair and not one of the other intents.`,
    `Do not treat a lease-copy or rent-balance question as a maintenance request, even if a work order is open.`,
  ]
  if (smsContext.pendingStep) {
    parts.push(`Pending step: ${smsContext.pendingStep}`)
  }
  if (smsContext.pendingQuestion) {
    parts.push(`Pending context: ${smsContext.pendingQuestion.slice(0, 400)}`)
  }
  if (smsContext.recentTurns) {
    parts.push(`Recent thread:\n${smsContext.recentTurns.slice(0, 1200)}`)
  }
  return parts.join("\n")
}

export function parseLlmClassificationDraft(
  content: string,
  smsContext?: ClassifyMaintenanceSmsContext | null,
): LlmClassificationDraft | null {
  const clean = content.replace(/```json|```/g, "").trim()
  if (!clean) return null
  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(clean) as Record<string, unknown>
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null
  const confidence = Number(parsed.confidence)
  const interpretation = smsContext ? parseInterpretation(parsed) : undefined
  return {
    vendorTrade: asTrade(parsed.vendor_trade ?? parsed.vendorTrade),
    issueType: asIssue(parsed.issue_type ?? parsed.issueType),
    severity: asSeverity(parsed.severity),
    reasoning:
      typeof parsed.reasoning === "string" ? parsed.reasoning.slice(0, 240) : "",
    confidence: Number.isFinite(confidence)
      ? Math.max(0, Math.min(1, confidence))
      : 0.5,
    ...(interpretation ? { interpretation } : {}),
  }
}

const CLASSIFY_SYSTEM_PROMPT =
  `Classify this property maintenance request. Return ONLY JSON with keys:\n` +
  `- vendor_trade: one of ${TRADES.join(", ")}\n` +
  `- issue_type: one of ${ISSUES.join(", ")}\n` +
  `- severity: one of low, normal, urgent, critical\n` +
  `- confidence: number 0-1\n` +
  `- reasoning: short phrase\n` +
  `Do not invent facts.\n` +
  `Do not force a ceiling leak to plumbing — rain vs upstairs fixture is ambiguous until clarified.\n` +
  `Radiators and boilers are plumbing/boiler trades, not forced-air HVAC.\n` +
  `Prefer plumbing for fixture leaks (faucet, sink, toilet, pipe, water heater).\n` +
  `Prefer electrical for sparks/outlets/wiring.\n` +
  `Never use a generic "structural" trade; pick roofing, carpentry, masonry, windows, or general.`

function envTrim(name: string): string {
  try {
    return Deno.env.get(name)?.trim() ?? ""
  } catch {
    return ""
  }
}

export async function llmClassifyMaintenance(
  sanitized: string,
  entitiesSummary: string,
  smsContext?: ClassifyMaintenanceSmsContext | null,
  opts?: {
    fetchImpl?: LlmClassifyFetch
    openaiKey?: string | null
    anthropicKey?: string | null
  },
): Promise<LlmClassificationDraft | null> {
  const openaiKey = (opts?.openaiKey ?? envTrim("OPENAI_API_KEY")).trim()
  if (!openaiKey || !sanitized.trim()) return null

  const userPrompt =
    `Description: """${sanitized.slice(0, 4000)}"""\n` +
    `Extracted: ${entitiesSummary.slice(0, 1000)}` +
    (smsContext ? `\n\n${smsContextPrompt(smsContext)}` : "")

  try {
    const fetched = await fetchLlmClassificationJson({
      systemPrompt: CLASSIFY_SYSTEM_PROMPT,
      userPrompt,
      fetchImpl: opts?.fetchImpl,
      openaiKey,
      anthropicKey: opts?.anthropicKey ?? envTrim("ANTHROPIC_API_KEY"),
    })
    if (!fetched) return null
    const draft = parseLlmClassificationDraft(fetched.content, smsContext)
    if (!draft) {
      console.error("[maintenance-classify] draft JSON did not parse", {
        provider: fetched.provider,
      })
      return null
    }
    const withProvider = { ...draft, provider: fetched.provider }
    console.info("[maintenance-classify] llm draft (interpretation only)", {
      provider: fetched.provider,
      vendorTrade: withProvider.vendorTrade,
      issueType: withProvider.issueType,
      confidence: withProvider.confidence,
    })
    return withProvider
  } catch (err) {
    console.error("[maintenance-classify] llm draft failed", err)
    return null
  }
}
