/**
 * OpenAI synthesis — model call, prompts (via buildPrompt), temperature.
 */

import { ASK_ULO_ANSWER_MODEL, buildAskUloPrompt } from "./buildPrompt.ts"
import type { AskUloTokenUsage, AskUloToolPackets } from "./toolPackets.ts"

export const ANSWER_MODEL = ASK_ULO_ANSWER_MODEL

function stripJsonFence(s: string): string {
  const t = s.trim()
  const m = t.match(/^```(?:json)?\s*([\s\S]*?)```$/i)
  return m ? m[1].trim() : t
}

export async function synthesizeWithOpenAI(
  apiKey: string,
  packets: AskUloToolPackets,
): Promise<{ text: string; usage: AskUloTokenUsage | null; synthesizeMs: number } | null> {
  const prompt = buildAskUloPrompt(packets)
  const started = Date.now()
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: prompt.model,
      temperature: prompt.temperature,
      messages: prompt.messages,
    }),
  })
  if (!res.ok) {
    const errText = await res.text().catch(() => "")
    console.error("[ask_ulo/synthesize] openai", res.status, errText.slice(0, 400))
    return null
  }
  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>
    usage?: {
      prompt_tokens?: number
      completion_tokens?: number
      total_tokens?: number
    }
  }
  const content = data.choices?.[0]?.message?.content
  if (!content?.trim()) return null

  const usageRaw = data.usage
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
