import type { ApplianceVisionResult, VisionProvider } from "../types.ts"

/** Gemini adapter — configure GEMINI_API_KEY and set VISION_PROVIDER=gemini. */
export function createGeminiVisionProvider(apiKey: string): VisionProvider {
  return {
    name: "gemini",

    async analyzeImage(
      _imageBase64: string,
      _hintCategory?: string,
      _mediaType?: string,
    ): Promise<ApplianceVisionResult> {
      if (!apiKey.trim()) {
        throw new Error(
          "Gemini vision is not configured. Set GEMINI_API_KEY or switch VISION_PROVIDER to gpt4o.",
        )
      }
      throw new Error(
        "Gemini vision adapter is stubbed. Set VISION_PROVIDER=gpt4o until Gemini is wired.",
      )
    },
  }
}
