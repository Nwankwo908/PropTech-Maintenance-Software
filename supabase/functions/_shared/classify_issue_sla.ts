/**
 * AI returns issue_category + severity only; SLA minutes come from sla_rules.ts.
 */

export type IssueSlaClassification = {
  issue_category: string
  severity: "low" | "normal" | "urgent"
}

function stripJsonFence(s: string): string {
  const t = s.trim()
  const m = t.match(/^```(?:json)?\s*([\s\S]*?)```$/i)
  return m ? m[1].trim() : t
}

function priorityToSeverity(priority: string): IssueSlaClassification["severity"] {
  const x = priority.trim().toLowerCase()
  if (
    x.includes("urgent") ||
    x.includes("emergency") ||
    x === "high"
  ) {
    return "urgent"
  }
  if (x.includes("low")) return "low"
  return "normal"
}

/** Same rules as embedded SLA classification; used when `issueCategory` overrides AI classification. */
export function severityFromResidentPriority(
  priority: string,
): IssueSlaClassification["severity"] {
  return priorityToSeverity(priority)
}

function fallbackClassify(
  description: string,
  priority: string,
): IssueSlaClassification {
  const d = description.toLowerCase()
  let issue_category = "plumbing"
  if (/\b(electric|outlet|breaker|wiring|lighting)\b/.test(d)) {
    issue_category = "electrical"
  } else if (
    /\b(fridge|refrigerator|washer|dryer|appliance|oven|dishwasher|microwave)\b/.test(
      d,
    )
  ) {
    issue_category = "appliance"
  }
  return {
    issue_category,
    severity: priorityToSeverity(priority),
  }
}

function normalizeAiCategory(raw: string): string {
  const c = raw.trim().toLowerCase()
  if (
    c === "plumbing" ||
    c === "electrical" ||
    c === "appliance" ||
    c === "appliances"
  ) {
    return c === "appliances" ? "appliance" : c
  }
  if (c.includes("electric") || c.includes("lighting")) {
    return "electrical"
  }
  if (c.includes("plumb") || c.includes("water") || c.includes("leak")) {
    return "plumbing"
  }
  if (c.includes("appliance")) return "appliance"
  return "other"
}

function normalizeAiSeverity(
  raw: string,
  fallbackPriority: string,
): IssueSlaClassification["severity"] {
  const s = raw.trim().toLowerCase()
  if (s === "low") return "low"
  if (
    s === "urgent" ||
    s === "emergency" ||
    s === "high" ||
    s === "critical"
  ) {
    return "urgent"
  }
  if (s === "normal" || s === "medium" || s === "standard") return "normal"
  return priorityToSeverity(fallbackPriority)
}

/**
 * Classify issue for SLA using OpenAI when configured; otherwise heuristic fallback.
 * Does not return or compute minutes — use getEstimatedMinutes on the result.
 */
export async function classifyIssueForSla(
  description: string,
  residentPriority: string,
): Promise<IssueSlaClassification> {
  const apiKey = Deno.env.get("OPENAI_API_KEY")?.trim()
  if (!apiKey) {
    return fallbackClassify(description, residentPriority)
  }

  const prompt = `You are a property maintenance classifier.

Read the issue description and return ONLY valid JSON (no markdown, no prose) with exactly these keys:
- "issue_category": one of "plumbing", "electrical", "appliance", "other"
- "severity": one of "low", "normal", "urgent"

Do not include time estimates, minutes, or due dates.

Issue description:
"""${description.replace(/"/g, '\\"').slice(0, 8000)}"""`

  try {
    const aiResponse = await fetch(
      "https://api.openai.com/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          messages: [{ role: "user", content: prompt }],
          temperature: 0.2,
        }),
      },
    )

    const data = (await aiResponse.json()) as Record<string, unknown>
    if (!aiResponse.ok) {
      const errObj = data?.error as { message?: string } | undefined
      console.warn(
        "[classify-issue-sla] OpenAI error",
        errObj?.message ?? aiResponse.status,
      )
      return fallbackClassify(description, residentPriority)
    }

    const choices = data?.choices as unknown
    const first =
      Array.isArray(choices) && choices.length > 0
        ? (choices[0] as Record<string, unknown>)
        : null
    const message = first?.message as Record<string, unknown> | undefined
    const content = message?.content
    if (typeof content !== "string" || !content.trim()) {
      return fallbackClassify(description, residentPriority)
    }

    const text = stripJsonFence(content)
    let parsed: Record<string, unknown>
    try {
      parsed = JSON.parse(text) as Record<string, unknown>
    } catch {
      return fallbackClassify(description, residentPriority)
    }

    const icRaw =
      typeof parsed.issue_category === "string"
        ? parsed.issue_category
        : typeof parsed.issueCategory === "string"
          ? parsed.issueCategory
          : "other"
    const sevRaw =
      typeof parsed.severity === "string"
        ? parsed.severity
        : typeof parsed.urgency === "string"
          ? parsed.urgency
          : "normal"

    return {
      issue_category: normalizeAiCategory(icRaw),
      severity: normalizeAiSeverity(sevRaw, residentPriority),
    }
  } catch (e) {
    console.warn("[classify-issue-sla] request failed", e)
    return fallbackClassify(description, residentPriority)
  }
}
