/**
 * Equipment serial OCR.
 * Gemini 3.8 Flash reads the label. The OpenAI equipment backup runs only if Gemini cannot.
 */
import { geminiGenerateJsonText } from "../documentExtract/geminiGenerateJson.ts"
import { OPENAI_EQUIPMENT_MODEL } from "./providers/equipmentRequest.ts"
import {
  buildSerialReview,
  normalizeSerial,
  uncertainCharactersFromModel,
  type SerialReview,
} from "./serialFormat.ts"

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

async function readWithOpenAi(apiKey: string, images: SerialImage[]): Promise<string> {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: OPENAI_EQUIPMENT_MODEL,
      max_tokens: 1024,
      temperature: 0,
      messages: [
        { role: "system", content: SERIAL_PROMPT },
        {
          role: "user",
          content: [
            ...images.map((image) => ({
              type: "image_url",
              image_url: {
                url: `data:${image.mediaType || "image/jpeg"};base64,${image.base64}`,
              },
            })),
            { type: "text", text: "Transcribe the serial number." },
          ],
        },
      ],
      response_format: { type: "json_object" },
    }),
  })
  if (!res.ok) throw new Error(`openai_http_${res.status}`)
  const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> }
  const text = data.choices?.[0]?.message?.content?.trim() ?? ""
  if (!text) throw new Error("openai_empty")
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
  const openaiKey = Deno.env.get("OPENAI_API_KEY")?.trim() ?? ""
  if (!geminiKey && !openaiKey) return null

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
  if ((!payload || !payload.readable) && openaiKey) {
    try {
      payload = parseSerialPayload(await readWithOpenAi(openaiKey, images))
      provider = OPENAI_EQUIPMENT_MODEL
    } catch (error) {
      console.error(
        "[serial-ocr] openai",
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
      provider: geminiKey ? "gemini-3.8-flash" : OPENAI_EQUIPMENT_MODEL,
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
