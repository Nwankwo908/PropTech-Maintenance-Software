/// <reference lib="deno.ns" />
import { assertEquals, assertNotEquals } from "https://deno.land/std@0.224.0/assert/mod.ts"
import {
  generateInspectionCaptureToken,
  hashInspectionCaptureToken,
  timingSafeEqualHex,
} from "./token.ts"

Deno.test("generateInspectionCaptureToken is 64 hex chars", () => {
  const token = generateInspectionCaptureToken()
  assertEquals(token.length, 64)
  assertEquals(/^[0-9a-f]+$/.test(token), true)
})

Deno.test("hashInspectionCaptureToken is stable and not the raw token", async () => {
  const token = "a".repeat(64)
  const hash = await hashInspectionCaptureToken(token)
  assertEquals(hash.length, 64)
  assertNotEquals(hash, token)
  assertEquals(hash, await hashInspectionCaptureToken(token))
})

Deno.test("timingSafeEqualHex rejects mismatches", () => {
  const a = "ab".repeat(32)
  const b = "cd".repeat(32)
  assertEquals(timingSafeEqualHex(a, a), true)
  assertEquals(timingSafeEqualHex(a, b), false)
  assertEquals(timingSafeEqualHex(a, a.slice(0, 63)), false)
})
