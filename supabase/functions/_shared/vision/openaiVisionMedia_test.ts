/// <reference lib="deno.ns" />
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts"
import { resolveOpenAiVisionMediaType } from "./openaiVisionMedia.ts"

Deno.test("resolveOpenAiVisionMediaType prefers JPEG magic over claimed HEIC", () => {
  const jpegPrefix = btoa(String.fromCharCode(0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0))
  const resolved = resolveOpenAiVisionMediaType(jpegPrefix, "image/heic")
  assertEquals("mediaType" in resolved && resolved.mediaType, "image/jpeg")
})

Deno.test("resolveOpenAiVisionMediaType rejects HEIC bytes", () => {
  const heic = new Uint8Array(16)
  heic.set([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63])
  let binary = ""
  for (const b of heic) binary += String.fromCharCode(b)
  const resolved = resolveOpenAiVisionMediaType(btoa(binary), "image/heic")
  assertEquals("error" in resolved, true)
})
