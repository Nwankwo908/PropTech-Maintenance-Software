/// <reference lib="deno.ns" />
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts"
import { parseInspectionPageImages } from "./inspectionPageImages.ts"

Deno.test("parseInspectionPageImages keeps up to 8 JPEG pages", () => {
  const pages = parseInspectionPageImages([
    { base64: "data:image/jpeg;base64,aaa", mediaType: "image/jpeg" },
    { base64: "bbb", mediaType: "image/jpeg" },
    { base64: "" },
    null,
  ])
  assertEquals(pages.length, 2)
  assertEquals(pages[0]?.base64, "aaa")
  assertEquals(pages[1]?.base64, "bbb")
})
