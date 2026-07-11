/**
 * Late-rent Ulo insights: OpenAI when configured, otherwise deterministic fallback.
 */

export type LateRentInsightTag =
  | "ON-TIME HISTORY"
  | "ENGAGEMENT"
  | "INTENT"
  | "RISK"

export type LateRentInsightCard = {
  tag: LateRentInsightTag
  text: string
}

export type LateRentInsightsAccountInput = {
  residentName: string
  locationLabel: string
  daysOverdue: number
  balanceDue: number | null
  monthlyRent: number | null
  workflowStatus: string
  rentClassification: string | null
  paymentIntent: string | null
  paymentStatus: string | null
  reminderSent: boolean
  reminderSmsSent: boolean
  reminderEmailSent: boolean
  leaseStatus: string | null
  moveInDate: string | null
  riskLevel: "low" | "medium" | "high"
}

export type LateRentInsightsResult = {
  insights: LateRentInsightCard[]
  mode: "openai" | "fallback"
}

const REQUIRED_TAGS: LateRentInsightTag[] = [
  "ON-TIME HISTORY",
  "ENGAGEMENT",
  "INTENT",
  "RISK",
]

function stripJsonFence(s: string): string {
  const t = s.trim()
  const m = t.match(/^```(?:json)?\s*([\s\S]*?)```$/i)
  return m ? m[1].trim() : t
}

function monthsOnTime(moveInDate: string | null | undefined, now = Date.now()): number | null {
  if (!moveInDate?.trim()) return null
  const moveIn = new Date(`${moveInDate.trim().slice(0, 10)}T12:00:00`).getTime()
  if (Number.isNaN(moveIn)) return null
  const months = Math.floor((now - moveIn) / (30 * 86_400_000))
  return months > 0 ? months : null
}

/** Deterministic insights when OpenAI is unavailable. */
export function buildFallbackLateRentInsights(
  input: LateRentInsightsAccountInput,
): LateRentInsightCard[] {
  const months = monthsOnTime(input.moveInDate)
  const onTime =
    months != null && months >= 12
      ? `Paid on time for the past ${Math.min(months, 24)} months.`
      : months != null && months >= 3
      ? `Generally paid on time since move-in (${months} months).`
      : "Limited payment history on file for this lease."

  let engagement = "No reminder response recorded yet."
  if (input.paymentIntent === "paid") {
    engagement = "Resident confirmed payment — verify ledger posting."
  } else if (input.paymentIntent === "partial") {
    engagement = "Resident reported a partial payment — follow up on remaining balance."
  } else if (input.reminderSent && input.paymentIntent === "questions") {
    engagement = "Reminder opened — resident replied with questions."
  } else if (input.reminderSent) {
    engagement = "Reminder opened but no payment received."
  } else if (input.reminderSmsSent || input.reminderEmailSent) {
    engagement = "Outreach sent — awaiting resident response."
  }

  let intent = "No payment commitment captured yet."
  if (
    input.paymentIntent === "questions" ||
    input.rentClassification === "payment_plan_needed"
  ) {
    intent = "Resident requested an installment plan — willing to pay."
  } else if (input.paymentIntent === "partial") {
    intent = "Resident indicated partial payment — confirm amount and timing."
  } else if (input.paymentIntent === "paid") {
    intent = "Resident stated rent was paid — verify against ledger."
  } else if ((input.paymentStatus ?? "").toLowerCase().includes("awaiting")) {
    intent = "Payment link sent — resident has not completed checkout."
  }

  const riskWord =
    input.riskLevel === "high" ? "High" : input.riskLevel === "medium" ? "Medium" : "Low"
  const prior =
    input.workflowStatus === "escalated"
      ? "Escalated to admin review."
      : input.daysOverdue >= 7
      ? "Multiple reminders sent without payment."
      : "No prior delinquency on this lease."

  return [
    { tag: "ON-TIME HISTORY", text: onTime },
    { tag: "ENGAGEMENT", text: engagement },
    { tag: "INTENT", text: intent },
    { tag: "RISK", text: `Classified as ${riskWord}. ${prior}` },
  ]
}

function normalizeInsights(raw: unknown): LateRentInsightCard[] | null {
  if (!raw || typeof raw !== "object") return null
  const list = (raw as { insights?: unknown }).insights
  if (!Array.isArray(list) || list.length < 4) return null

  const byTag = new Map<LateRentInsightTag, string>()
  for (const item of list) {
    if (!item || typeof item !== "object") continue
    const tag = String((item as { tag?: unknown }).tag ?? "")
      .trim()
      .toUpperCase() as LateRentInsightTag
    const text = String((item as { text?: unknown }).text ?? "").trim()
    if (!REQUIRED_TAGS.includes(tag) || !text) continue
    byTag.set(tag, text.slice(0, 280))
  }

  if (byTag.size < 4) return null
  return REQUIRED_TAGS.map((tag) => ({ tag, text: byTag.get(tag)! }))
}

async function generateWithOpenAI(
  apiKey: string,
  input: LateRentInsightsAccountInput,
): Promise<LateRentInsightCard[] | null> {
  const prompt =
    `You are Ulo, an AI property operations assistant helping a landlord review a late rent account.\n` +
    `Write four short insight cards (1–2 sentences each, plain language, no markdown).\n` +
    `Return ONLY valid JSON with this exact shape:\n` +
    `{"insights":[{"tag":"ON-TIME HISTORY","text":"..."},{"tag":"ENGAGEMENT","text":"..."},{"tag":"INTENT","text":"..."},{"tag":"RISK","text":"..."}]}\n` +
    `Tags must be exactly those four strings. Base claims only on the facts below; do not invent payments or conversations.\n\n` +
    `Facts:\n${JSON.stringify(input, null, 2)}`

  const aiResponse = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.4,
      response_format: { type: "json_object" },
    }),
  })

  const data = (await aiResponse.json()) as Record<string, unknown>
  if (!aiResponse.ok) {
    const errObj = data?.error as { message?: string } | undefined
    console.error(
      "[late-rent-insights] OpenAI error",
      aiResponse.status,
      errObj?.message ?? data,
    )
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

  try {
    const parsed = JSON.parse(stripJsonFence(content)) as unknown
    return normalizeInsights(parsed)
  } catch (err) {
    console.error("[late-rent-insights] parse failed", err)
    return null
  }
}

export async function generateLateRentInsights(
  input: LateRentInsightsAccountInput,
): Promise<LateRentInsightsResult> {
  const apiKey = Deno.env.get("OPENAI_API_KEY")?.trim()
  if (apiKey) {
    try {
      const insights = await generateWithOpenAI(apiKey, input)
      if (insights) return { insights, mode: "openai" }
    } catch (err) {
      console.error("[late-rent-insights] OpenAI threw", err)
    }
  }
  return {
    insights: buildFallbackLateRentInsights(input),
    mode: "fallback",
  }
}
