import type { IssueType, SeverityLevel, VendorTrade } from "./types.ts"

export type LlmClassificationDraft = {
  vendorTrade: VendorTrade | null
  issueType: IssueType | null
  severity: SeverityLevel | null
  reasoning: string
  confidence: number
}

const TRADES: VendorTrade[] = [
  "appliance_repair",
  "carpentry",
  "cleaning",
  "electrical",
  "flooring",
  "general",
  "hvac",
  "landscaping",
  "locksmith",
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

export async function llmClassifyMaintenance(
  sanitized: string,
  entitiesSummary: string,
): Promise<LlmClassificationDraft | null> {
  const apiKey = Deno.env.get("OPENAI_API_KEY")?.trim()
  if (!apiKey || !sanitized.trim()) return null

  const prompt =
    `Classify this property maintenance request. Return ONLY JSON with keys:\n` +
    `- vendor_trade: one of ${TRADES.join(", ")}\n` +
    `- issue_type: one of ${ISSUES.join(", ")}\n` +
    `- severity: one of low, normal, urgent, critical\n` +
    `- confidence: number 0-1\n` +
    `- reasoning: short phrase\n` +
    `Do not invent facts. Prefer plumbing for leaks/faucets/sinks/toilets.\n` +
    `Prefer electrical for sparks/outlets/wiring.\n\n` +
    `Description: """${sanitized.slice(0, 4000)}"""\n` +
    `Extracted: ${entitiesSummary.slice(0, 1000)}`

  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0.1,
        response_format: { type: "json_object" },
        messages: [{ role: "user", content: prompt }],
      }),
    })
    if (!res.ok) return null
    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>
    }
    const content = data.choices?.[0]?.message?.content?.trim()
    if (!content) return null
    const parsed = JSON.parse(content) as Record<string, unknown>
    const confidence = Number(parsed.confidence)
    return {
      vendorTrade: asTrade(parsed.vendor_trade ?? parsed.vendorTrade),
      issueType: asIssue(parsed.issue_type ?? parsed.issueType),
      severity: asSeverity(parsed.severity),
      reasoning:
        typeof parsed.reasoning === "string"
          ? parsed.reasoning.slice(0, 240)
          : "",
      confidence: Number.isFinite(confidence)
        ? Math.max(0, Math.min(1, confidence))
        : 0.5,
    }
  } catch {
    return null
  }
}
