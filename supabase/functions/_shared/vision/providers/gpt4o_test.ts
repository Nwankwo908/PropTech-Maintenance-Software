/// <reference lib="deno.ns" />
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts"
import {
  buildGpt4oVisionUserContent,
  inspectionReportExtractUserText,
  inspectionReportPageChunks,
} from "./gpt4o.ts"

Deno.test("buildGpt4oVisionUserContent sends one image_url block per page", () => {
  const content = buildGpt4oVisionUserContent("Read all pages.", [
    { base64: "aaa", mediaType: "image/jpeg" },
    { base64: "bbb", mediaType: "image/jpeg" },
    { base64: "ccc", mediaType: "image/jpeg" },
  ])
  assertEquals(content.length, 4)
  assertEquals(content[0], { type: "text", text: "Read all pages." })
  assertEquals(content[1]?.type, "image_url")
  assertEquals(content[2]?.type, "image_url")
  assertEquals(content[3]?.type, "image_url")
  const firstUrl = (content[1] as { image_url: { url: string } }).image_url.url
  assertEquals(firstUrl.startsWith("data:image/jpeg;base64,"), true)
  assertEquals((content[1] as { image_url: { detail: string } }).image_url.detail, "high")
})

Deno.test("inspection reports are extracted one page at a time", () => {
  assertEquals(inspectionReportPageChunks(["a", "b", "c", "d"]).length, 4)
  assertEquals(inspectionReportPageChunks(["a"]).length, 1)
  const text = inspectionReportExtractUserText({
    totalPages: 4,
    pageStart: 3,
    pageEnd: 3,
    textLayer: "HVAC 9 years",
  })
  assertEquals(text.includes("pages 3") || text.includes("page 3"), true)
  assertEquals(text.includes("Do not stop after the first system"), true)
  assertEquals(text.includes("At most one predominant roof"), true)
  assertEquals(text.includes("HVAC 9 years"), true)
})
