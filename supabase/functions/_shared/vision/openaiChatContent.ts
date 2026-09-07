/** Pull text from a Chat Completions message (string, parts array, or refusal). */
export function extractChatCompletionText(message: unknown): string {
  if (!message || typeof message !== "object") return ""
  const m = message as Record<string, unknown>
  const refusal = typeof m.refusal === "string" ? m.refusal.trim() : ""
  const fromContent = contentToText(m.content)
  return fromContent || refusal
}

function contentToText(content: unknown): string {
  if (typeof content === "string") return content.trim()
  if (!Array.isArray(content)) return ""
  const parts: string[] = []
  for (const part of content) {
    if (typeof part === "string") {
      parts.push(part)
      continue
    }
    if (!part || typeof part !== "object") continue
    const p = part as Record<string, unknown>
    if (typeof p.text === "string") parts.push(p.text)
    else if (p.type === "output_text" && typeof p.text === "string") parts.push(p.text)
  }
  return parts.join("\n").trim()
}

export function chatCompletionFailureDetail(json: unknown): string {
  if (!json || typeof json !== "object") return "empty response"
  const root = json as Record<string, unknown>
  const choice = Array.isArray(root.choices) ? root.choices[0] : null
  if (!choice || typeof choice !== "object") return "no choices"
  const c = choice as Record<string, unknown>
  const finish = typeof c.finish_reason === "string" ? c.finish_reason : "unknown"
  const message = c.message
  const refusal =
    message && typeof message === "object" && typeof (message as Record<string, unknown>).refusal === "string"
      ? String((message as Record<string, unknown>).refusal).slice(0, 180)
      : ""
  if (refusal) return `finish_reason=${finish}; refusal=${refusal}`
  return `finish_reason=${finish}`
}
