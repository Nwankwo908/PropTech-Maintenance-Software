/**
 * Document extraction via Gemini 3.8 Flash.
 * Callers pass text, page images, or a PDF as inline data and get JSON text back.
 */

export const DOCUMENT_EXTRACT_MODEL = "gemini-3.8-flash"

const GENERATE_URL =
  `https://generativelanguage.googleapis.com/v1beta/models/${DOCUMENT_EXTRACT_MODEL}:generateContent`

export type GeminiPart =
  | { text: string }
  | { inlineData: { mimeType: string; data: string } }

export function documentExtractApiKey(): string {
  return Deno.env.get("GEMINI_API_KEY")?.trim() ?? ""
}

function stripJsonFence(content: string): string {
  const trimmed = content.trim()
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)```$/i)
  return (fenced?.[1] ?? trimmed).trim()
}

function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Chat-completions style parts ({type:text|image_url}) → Gemini parts. */
export function geminiPartsFromOpenAiUserContent(
  content: Array<Record<string, unknown>>,
): GeminiPart[] {
  const parts: GeminiPart[] = []
  for (const item of content) {
    if (item.type === "text" && typeof item.text === "string" && item.text.trim()) {
      parts.push({ text: item.text })
      continue
    }
    const image = item.image_url
    const url =
      image && typeof image === "object" && "url" in image && typeof image.url === "string"
        ? image.url
        : ""
    const match = url.match(/^data:([^;,]+);base64,([\s\S]+)$/)
    if (!match) continue
    parts.push({
      inlineData: { mimeType: match[1] || "image/jpeg", data: match[2] },
    })
  }
  return parts
}

export function readGeminiGenerateText(json: unknown): string {
  if (!json || typeof json !== "object") return ""
  const candidates = (json as { candidates?: unknown }).candidates
  if (!Array.isArray(candidates)) return ""
  const chunks: string[] = []
  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== "object") continue
    const parts = (candidate as { content?: { parts?: unknown } }).content?.parts
    if (!Array.isArray(parts)) continue
    for (const part of parts) {
      if (!part || typeof part !== "object") continue
      const row = part as { text?: unknown; thought?: unknown }
      if (row.thought === true) continue
      if (typeof row.text === "string" && row.text.trim()) chunks.push(row.text.trim())
    }
  }
  return chunks.join("\n")
}

export async function geminiGenerateJsonText(input: {
  apiKey: string
  system: string
  parts: GeminiPart[]
  maxOutputTokens?: number
  maxAttempts?: number
  /** Plain-text replies (OCR). Default is JSON. */
  json?: boolean
}): Promise<string> {
  const parts = input.parts.filter((part) =>
    "text" in part ? part.text.trim().length > 0 : part.inlineData.data.length > 0
  )
  if (parts.length === 0) {
    throw new Error("Document extract failed: nothing to read")
  }

  const maxAttempts = input.maxAttempts ?? 3
  const asJson = input.json !== false
  let lastStatus = 0
  let lastText = ""
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const response = await fetch(GENERATE_URL, {
      method: "POST",
      headers: {
        "x-goog-api-key": input.apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: input.system }] },
        contents: [{ role: "user", parts }],
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: input.maxOutputTokens ?? (asJson ? 16384 : 8192),
          ...(asJson ? { responseMimeType: "application/json" } : {}),
          thinkingConfig: { thinkingLevel: "LOW" },
        },
      }),
    })
    if (response.ok) {
      const text = readGeminiGenerateText(await response.json())
      if (!text.trim()) {
        throw new Error(
          asJson ? "Document extract returned non-JSON content" : "Document extract returned empty text",
        )
      }
      return asJson ? stripJsonFence(text) : text.trim()
    }
    lastStatus = response.status
    lastText = await response.text().catch(() => "")
    console.error("[document-extract] gemini", lastStatus, lastText.slice(0, 400))
    const lower = lastText.toLowerCase()
    const retryable =
      (lastStatus === 429 || lastStatus === 503 || lower.includes("unavailable") || lower.includes("overloaded")) &&
      !lower.includes("quota") &&
      attempt < maxAttempts - 1
    if (!retryable) break
    await sleepMs(1000 * 2 ** attempt)
  }
  throw new Error(geminiExtractErrorMessage(lastStatus, lastText))
}

export function geminiExtractErrorMessage(status: number, text: string): string {
  const lower = text.toLowerCase()
  if (
    status === 401 ||
    status === 403 ||
    lower.includes("api key not valid") ||
    lower.includes("api_key_invalid") ||
    lower.includes("permission_denied") ||
    lower.includes("incorrect api key")
  ) {
    return "Document scanning is not configured. Set a valid GEMINI_API_KEY on Supabase Edge secrets."
  }
  if (
    lower.includes("quota") ||
    lower.includes("billing") ||
    lower.includes("exceeded your current quota")
  ) {
    return "Document scanning is temporarily unavailable. Try again in a few minutes."
  }
  if (
    status === 413 ||
    lower.includes("payload") ||
    lower.includes("too large") ||
    lower.includes("context length") ||
    lower.includes("maximum context") ||
    lower.includes("token count exceeds")
  ) {
    return "We couldn’t read this document automatically. Export it as a JPG or a text-based PDF and try again."
  }
  if (status === 429 || status === 503 || lower.includes("rate limit") || lower.includes("overloaded")) {
    return "Document scanning is busy right now. Please wait a moment and try again."
  }
  return `Document extract failed (${status}): ${text.slice(0, 300)}`
}
