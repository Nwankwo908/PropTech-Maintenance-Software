/// <reference lib="deno.ns" />
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts"
import {
  asMoney,
  outputTextFromResponses,
  parseExtractedCoiFields,
} from "./documentExtract.ts"

Deno.test("asMoney reads dollar, million, and numeric strings", () => {
  assertEquals(asMoney(1_000_000), 1_000_000)
  assertEquals(asMoney("$1,000,000"), 1_000_000)
  assertEquals(asMoney("1M"), 1_000_000)
  assertEquals(asMoney("1 million"), 1_000_000)
})

Deno.test("outputTextFromResponses reads nested Responses API content", () => {
  assertEquals(
    outputTextFromResponses({
      output: [
        {
          type: "message",
          content: [{ type: "output_text", text: '{"generalLiability":1000000}' }],
        },
      ],
    }),
    '{"generalLiability":1000000}',
  )
})

Deno.test("parseExtractedCoiFields accepts yes for additional insured", () => {
  const parsed = parseExtractedCoiFields({
    generalLiability: "$1,000,000",
    additionalInsured: "yes",
    expirationDate: "2027-01-01",
  })
  assertEquals(parsed.generalLiability, 1_000_000)
  assertEquals(parsed.additionalInsured, true)
})
