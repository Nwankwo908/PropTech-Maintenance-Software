/**
 * Equipment serial OCR.
 * Gemini 3.8 Flash reads the label. Claude Sonnet 5.5 runs only if Gemini cannot.
 */
import { geminiGenerateJsonText } from "../documentExtract/geminiGenerateJson.ts"
import {
  buildSerialReview,
  normalizeSerial,
  uncertainCharactersFromModel,
  type SerialReview,
} from "./serialFormat.ts"

const SONNET_MODEL = "claude-sonnet-5-5"

const SERIAL_PROMPT =
  "Read the appliance serial number from the nameplate photo. " +
  "If two images are attached, the second is a close-up of the label. " +
  "Return JSON only: {\"serial\": string|null, \"readable\": boolean, \"characters\": [{\"index\": number, \"char\": string, \"uncertain\": boolean, \"alternatives\": string[]}]}. " +
  "Mark a character uncertain when it could be a lookalike such as 0/O, 1/I/L, 5/S, 8/B, or 2/Z. Do not invent characters you cannot see."

type SerialImage = { base64: string; mediaType: string }

function parseSerialPayload(raw: string): {
  serial: string | null
  readable: boolean
  characters: unknown
} {
  const parsed = JSON.parse(raw) as Record<string, unknown>
  const serial = typeof parsed.serial === "string" ? parsed.serial : null
  return {
    serial: normalizeSerial(serial),
    readable: parsed.readable === true && Boolean(normalizeSerial(serial)),
    characters: parsed.characters,
  }
}

async function readWithGemini(apiKey: string, images: SerialImage[]): Promise<string> {
  return await geminiGenerateJsonText({
    apiKey,
    system: SERIAL_PROMPT,
    parts: images.map((image) => ({
      inlineData: { mimeType: image.mediaType || "image/jpeg", data: image.base64 },
    })),
    maxOutputTokens: 1024,
  })
}

async function readWithSonnet(apiKey: string, images: SerialImage[]): Promise<string> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: SONNET_MODEL,
      max_tokens: 1024,
      output_config: { effort: "low" },
      system: SERIAL_PROMPT,
      messages: [
        {
          role: "user",
          content: [
            ...images.map((image) => ({
              type: "image",
              source: {
                type: "base64",
                media_type: image.mediaType || "image/jpeg",
                data: image.base64,
              },
            })),
            { type: "text", text: "Transcribe the serial number." },
          ],
        },
      ],
    }),
  })
  if (!res.ok) {
    const errText = await res.text().catch(() => "")
    throw new Error(`sonnet_http_${res.status} ${errText.slice(0, 180)}`)
  }
  const data = (await res.json()) as { content?: Array<{ type?: string; text?: string }> }
  const text = data.content?.find((part) => part.type === "text")?.text?.trim() ?? ""
  if (!text) throw new Error("sonnet_empty")
  return text.replace(/```json|```/g, "").trim()
}

export async function readEquipmentSerial(input: {
  images: SerialImage[]
  brand?: string | null
  paired: boolean
}): Promise<SerialReview | null> {
  const images = input.images.filter((image) => image.base64.trim().length > 0)
  if (images.length === 0) return null
  const geminiKey = Deno.env.get("GEMINI_API_KEY")?.trim() ?? ""
  const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY")?.trim() ?? ""
  if (!geminiKey && !anthropicKey) return null

  let provider: SerialReview["provider"] = null
  let payload: { serial: string | null; readable: boolean; characters: unknown } | null = null

  if (geminiKey) {
    try {
      payload = parseSerialPayload(await readWithGemini(geminiKey, images))
      provider = "gemini-3.8-flash"
    } catch (error) {
      console.error(
        "[serial-ocr] gemini",
        error instanceof Error ? error.message : error,
      )
    }
  }
  if ((!payload || !payload.readable) && anthropicKey) {
    try {
      payload = parseSerialPayload(await readWithSonnet(anthropicKey, images))
      provider = "claude-sonnet-5-5"
    } catch (error) {
      console.error(
        "[serial-ocr] sonnet",
        error instanceof Error ? error.message : error,
      )
    }
  }
  if (!payload || !provider) {
    return buildSerialReview({
      brand: input.brand,
      serial: null,
      readable: false,
      uncertainCharacters: [],
      provider: geminiKey ? "gemini-3.8-flash" : "claude-sonnet-5-5",
      paired: input.paired,
    })
  }
  return buildSerialReview({
    brand: input.brand,
    serial: payload.serial,
    readable: payload.readable,
    uncertainCharacters: uncertainCharactersFromModel(payload.characters),
    provider,
    paired: input.paired,
  })
}
