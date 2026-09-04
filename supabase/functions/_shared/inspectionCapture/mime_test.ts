/// <reference lib="deno.ns" />
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts"
import { resolveInspectionCaptureMime, sniffInspectionCaptureMime } from "./mime.ts"

Deno.test("sniff jpeg/png/webp magic bytes", () => {
  assertEquals(sniffInspectionCaptureMime(new Uint8Array([0xff, 0xd8, 0xff, 0xe0])), "image/jpeg")
  assertEquals(
    sniffInspectionCaptureMime(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
    "image/png",
  )
  const webp = new Uint8Array(12)
  webp.set([0x52, 0x49, 0x46, 0x46], 0)
  webp.set([0x57, 0x45, 0x42, 0x50], 8)
  assertEquals(sniffInspectionCaptureMime(webp), "image/webp")
})

Deno.test("resolveInspectionCaptureMime prefers sniff over claimed type", () => {
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xdb])
  assertEquals(resolveInspectionCaptureMime(jpeg, "image/png"), "image/jpeg")
  assertEquals(resolveInspectionCaptureMime(new Uint8Array([0x00, 0x01]), "application/pdf"), null)
})
