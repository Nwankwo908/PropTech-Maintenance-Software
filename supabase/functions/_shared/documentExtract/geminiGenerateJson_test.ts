import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts"
import {
  DOCUMENT_EXTRACT_MODEL,
  geminiExtractErrorMessage,
  geminiPartsFromOpenAiUserContent,
  readGeminiGenerateText,
} from "./geminiGenerateJson.ts"

Deno.test("document extract model is Gemini 3.8 Flash", () => {
  assertEquals(DOCUMENT_EXTRACT_MODEL, "gemini-3.8-flash")
})

Deno.test("gemini parts skip thought text and keep the JSON answer", () => {
  assertEquals(
    readGeminiGenerateText({
      candidates: [
        {
          content: {
            parts: [
              { thought: true, text: "planning" },
              { text: "{\"ok\":true}" },
            ],
          },
        },
      ],
    }),
    "{\"ok\":true}",
  )
})

Deno.test("openai image parts become gemini inline data", () => {
  assertEquals(
    geminiPartsFromOpenAiUserContent([
      { type: "text", text: "Read this" },
      { type: "image_url", image_url: { url: "data:image/jpeg;base64,abc" } },
    ]),
    [
      { text: "Read this" },
      { inlineData: { mimeType: "image/jpeg", data: "abc" } },
    ],
  )
})

Deno.test("gemini auth errors name GEMINI_API_KEY", () => {
  assertEquals(
    geminiExtractErrorMessage(400, "API key not valid. Please pass a valid API key."),
    "Document scanning is not configured. Set a valid GEMINI_API_KEY on Supabase Edge secrets.",
  )
})
