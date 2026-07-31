import type { ApplianceVisionResult, VisionProvider } from "../types.ts"

/** Claude adapter — configure ANTHROPIC_API_KEY and set VISION_PROVIDER=claude. */
export function createClaudeVisionProvider(apiKey: string): VisionProvider {
  return {
    name: "claude",

    async analyzeImage(
      _imageBase64: string,
      _hintCategory?: string,
      _mediaType?: string,
    ): Promise<ApplianceVisionResult> {
      if (!apiKey.trim()) {
        throw new Error(
          "Claude vision is not configured. Set ANTHROPIC_API_KEY or switch VISION_PROVIDER to gpt4o.",
        )
      }
      throw new Error(
        "Claude vision adapter is stubbed. Set VISION_PROVIDER=gpt4o until Claude is wired.",
      )
    },
  }
}
