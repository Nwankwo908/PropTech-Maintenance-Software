import type { VisionProvider, VisionProviderName } from "./types.ts"
import { createClaudeVisionProvider } from "./providers/claude.ts"
import { createGeminiVisionProvider } from "./providers/gemini.ts"
import { createGpt4oVisionProvider } from "./providers/gpt4o.ts"

function resolveName(raw: string | undefined): VisionProviderName {
  const v = (raw ?? "gpt4o").trim().toLowerCase()
  if (v === "gemini" || v === "claude" || v === "gpt4o") return v
  return "gpt4o"
}

/** Resolve the active vision provider from VISION_PROVIDER env. */
export function getVisionProvider(): VisionProvider {
  const name = resolveName(Deno.env.get("VISION_PROVIDER"))
  if (name === "gemini") {
    return createGeminiVisionProvider(Deno.env.get("GEMINI_API_KEY")?.trim() ?? "")
  }
  if (name === "claude") {
    return createClaudeVisionProvider(Deno.env.get("ANTHROPIC_API_KEY")?.trim() ?? "")
  }
  const openaiKey = Deno.env.get("OPENAI_API_KEY")?.trim() ?? ""
  if (!openaiKey) {
    throw new Error("Missing OPENAI_API_KEY for GPT-4o vision")
  }
  return createGpt4oVisionProvider(openaiKey)
}

export function getVisionProviderName(): VisionProviderName {
  return resolveName(Deno.env.get("VISION_PROVIDER"))
}
