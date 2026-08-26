import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts"
import {
  parseMoneyThreshold,
  requiresCompletionPhotoEvidence,
  resolveTicketSlaMinutes,
} from "./landlordNotificationPrefs.ts"
import { parseRentReminderCadenceDays } from "./engine/rentCollectionPolicy.ts"
import { vendorAllowedForMarketplace } from "./vendor_assignment.ts"

Deno.test("parseMoneyThreshold reads currency strings", () => {
  assertEquals(parseMoneyThreshold("$2,500"), 2500)
  assertEquals(parseMoneyThreshold("250"), 250)
})

Deno.test("resolveTicketSlaMinutes prefers organization default", () => {
  assertEquals(
    resolveTicketSlaMinutes({
      defaultResponseSla: "2 hours",
      fallbackMinutes: () => 240,
    }),
    120,
  )
})

Deno.test("requiresCompletionPhotoEvidence respects false", () => {
  assertEquals(
    requiresCompletionPhotoEvidence({ requirePhotoEvidence: false }),
    false,
  )
})

Deno.test("vendorAllowedForMarketplace filters external vendors for ulo_vetted_only", () => {
  assertEquals(
    vendorAllowedForMarketplace(
      { onboarded_from_external: true },
      "ulo_vetted_only",
    ),
    false,
  )
  assertEquals(
    vendorAllowedForMarketplace(
      { onboarded_from_external: true },
      "include_imported",
    ),
    true,
  )
})

Deno.test("parseRentReminderCadenceDays reads organization cadence labels", () => {
  assertEquals(parseRentReminderCadenceDays("3, 1 day before"), [3, 1])
})
