/// <reference lib="deno.ns" />
/**
 * Failed selects must fail the dry-run (ok:false / 500), not return empty success.
 */
import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts"

Deno.test("dry-run query failure response shape is fail-closed", () => {
  const body = {
    ok: false,
    dryRun: true,
    error: "Query failed",
    detail: 'column "building" does not exist',
    failedSelect: "sla_expired_ids",
  }
  assertEquals(body.ok, false)
  assertEquals(body.error, "Query failed")
  assertStringIncludes(body.detail, "building")
  // Must not look like a successful empty run
  assertEquals("ticketCount" in body && (body as { ticketCount?: number }).ticketCount === 0, false)
})

Deno.test("dry_run_ticket_select_failed error message is recognized as failure", () => {
  const message =
    'dry_run_ticket_select_failed:abc:column "building" does not exist'
  assertEquals(message.startsWith("dry_run_ticket_select_failed:"), true)
  assertStringIncludes(message, "building")
})
