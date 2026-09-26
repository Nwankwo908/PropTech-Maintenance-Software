/// <reference lib="deno.ns" />
import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts"

/**
 * Guard: landlord outbound number resolution must not drift into two
 * implementations again (pool-only vs Alpha-aware shared DID).
 */
Deno.test("findActiveLandlordMain delegates to findActiveLandlordMainNumber", async () => {
  const poolSource = await Deno.readTextFile(
    new URL("./smsNumberPool.ts", import.meta.url),
  )
  const fnStart = poolSource.indexOf(
    "export async function findActiveLandlordMain",
  )
  assertEquals(fnStart >= 0, true)
  const fnSlice = poolSource.slice(fnStart, fnStart + 500)
  assertStringIncludes(fnSlice, "findActiveLandlordMainNumber")
  assertStringIncludes(fnSlice, "landlordSmsOnboarding.ts")
  assertEquals(fnSlice.includes('.eq("purpose", "landlord_main")'), false)
})

Deno.test("askTenantScheduleConfirmation uses Alpha-aware resolver + failure log", async () => {
  const source = await Deno.readTextFile(
    new URL("./tenantScheduleConfirm.ts", import.meta.url),
  )
  assertStringIncludes(source, "findActiveLandlordMainNumber")
  assertStringIncludes(source, "logOutboundNoLandlordMain")
  assertStringIncludes(source, "tenant_schedule_ask")
  // Must not import the pool helper on this module anymore.
  assertEquals(source.includes('from "./smsNumberPool.ts"'), false)
})
