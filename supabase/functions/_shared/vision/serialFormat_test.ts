import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts"
import { buildSerialReview, checkSerialFormat, normalizeSerial } from "./serialFormat.ts"

Deno.test("GE serial format accepts a letter prefix and six digits", () => {
  assertEquals(checkSerialFormat("GE", normalizeSerial("az123456")).ok, true)
  assertEquals(checkSerialFormat("GE", "123456").ok, false)
})

Deno.test("uncertain lookalikes ask for a retake", () => {
  const review = buildSerialReview({
    brand: "Whirlpool",
    serial: "MW12345678",
    readable: true,
    uncertainCharacters: [{ index: 4, char: "1", alternatives: ["I"] }],
    provider: "gemini-3.8-flash",
    paired: true,
  })
  assertEquals(review.retake, true)
  assertEquals(review.formatOk, false)
  assertEquals(review.uncertainCharacters[0]?.char, "1")
})
