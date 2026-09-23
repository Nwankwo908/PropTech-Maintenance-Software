/**
 * OpenAI (or fallback) synthesis for Property Insights recommendation cards.
 */
import {
  applyInsightSynthesis,
  buildInsightSynthesisPromptPayload,
  insightSynthesisSystemPrompt,
  normalizeInsightSynthesisModelResult,
  type InsightSynthesisModelResult,
} from "../../../shared/portfolioIntelligence/synthesizeInsightRecommendations.ts"
import type {
  PortfolioInsightFinding,
  SynthesizedInsightCard,
} from "../../../shared/portfolioIntelligence/types.ts"

export type PropertyInsightSynthesisResult = {
  cards: SynthesizedInsightCard[]
  mode: "openai" | "fallback"
}

function stripJsonFence(s: string): string {
  const t = s.trim()
  const m = t.match(/^```(?:json)?\s*([\s\S]*?)```$/i)
  return m ? m[1].trim() : t
}

async function generateWithOpenAI(
  apiKey: string,
  findings: PortfolioInsightFinding[],
  signal?: AbortSignal,
): Promise<InsightSynthesisModelResult | null> {
  const prompt =
    `${insightSynthesisSystemPrompt()}\n\nFacts:\n` +
    JSON.stringify(buildInsightSynthesisPromptPayload(findings), null, 2)

  const aiResponse = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.3,
      response_format: { type: "json_object" },
    }),
    signal,
  })

  const data = (await aiResponse.json()) as Record<string, unknown>
  if (!aiResponse.ok) {
    const errObj = data?.error as { message?: string } | undefined
    console.error(
      "[property-insight-synthesis] OpenAI error",
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
    return normalizeInsightSynthesisModelResult(parsed)
  } catch (err) {
    console.error("[property-insight-synthesis] parse failed", err)
    return null
  }
}

/**
 * One synthesis call for a landlord/property refresh.
 * On timeout, missing key, or parse failure → plain aggregate cards.
 */
export async function synthesizePropertyInsightRecommendations(
  findings: PortfolioInsightFinding[],
  options?: { timeoutMs?: number },
): Promise<PropertyInsightSynthesisResult> {
  if (findings.length === 0) {
    return { cards: [], mode: "fallback" }
  }

  const apiKey = Deno.env.get("OPENAI_API_KEY")?.trim()
  if (!apiKey) {
    return {
      cards: applyInsightSynthesis(findings, null, { failed: true }),
      mode: "fallback",
    }
  }

  const timeoutMs = options?.timeoutMs ?? 12_000
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const model = await generateWithOpenAI(apiKey, findings, controller.signal)
    if (!model) {
      return {
        cards: applyInsightSynthesis(findings, null, { failed: true }),
        mode: "fallback",
      }
    }
    const cards = applyInsightSynthesis(findings, model)
    const mode = cards.every((c) => c.mode === "fallback") ? "fallback" : "openai"
    return { cards, mode }
  } catch (err) {
    console.error("[property-insight-synthesis] failed", err)
    return {
      cards: applyInsightSynthesis(findings, null, { failed: true }),
      mode: "fallback",
    }
  } finally {
    clearTimeout(timer)
  }
}
