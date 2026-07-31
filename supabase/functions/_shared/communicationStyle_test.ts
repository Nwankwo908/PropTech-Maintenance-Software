/// <reference lib="deno.ns" />
import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts"
import {
  buildCommunicationStylePreview,
  buildOperationalMessage,
  DEFAULT_COMMUNICATION_STYLE,
  normalizeCommunicationStyle,
} from "./communicationStyle.ts"

Deno.test("default style is calm and professional", () => {
  assertEquals(DEFAULT_COMMUNICATION_STYLE, "calm_professional")
  assertEquals(normalizeCommunicationStyle(null), "calm_professional")
})

Deno.test("each style produces clearly distinct activation wording", () => {
  const calm = buildCommunicationStylePreview("calm_professional")
  const friendly = buildCommunicationStylePreview("friendly_conversational")
  const direct = buildCommunicationStylePreview("direct_action_oriented")

  assertStringIncludes(calm.sms, "Ulo couldn’t deliver")
  assertStringIncludes(friendly.sms, "we couldn’t reach")
  assertStringIncludes(direct.sms, "Action needed:")
  assertEquals(calm.emailSubject, "Resident phone needs attention — Unit 3A")
  assertEquals(direct.emailSubject, "Action required — Update phone for Unit 3A")
})

Deno.test("unit facts remain identical across styles", () => {
  for (const style of [
    "calm_professional",
    "friendly_conversational",
    "direct_action_oriented",
  ] as const) {
    assertStringIncludes(buildCommunicationStylePreview(style).sms, "Unit 3A")
  }
})

Deno.test("legal footer is preserved", () => {
  const footer = "Reply STOP to opt out. Reply HELP for help."
  const msg = buildOperationalMessage({
    style: "friendly_conversational",
    audience: "resident",
    channel: "sms",
    eventType: "activation_undeliverable",
    severity: "action_required",
    facts: { landlordName: "Marcus", unitLabel: "3A", requiredLegalFooter: footer },
  })
  assertEquals(msg.body.endsWith(footer), true)
})

Deno.test("emergency language overrides friendly tone", () => {
  const msg = buildOperationalMessage({
    style: "friendly_conversational",
    audience: "landlord",
    channel: "sms",
    eventType: "generic_urgent",
    severity: "emergency",
    facts: { issueSummary: "sparks from an outlet", propertyName: "Oakwood" },
  })
  assertStringIncludes(msg.body, "Emergency")
})

Deno.test("direct style does not mark informational update as action required", () => {
  const msg = buildOperationalMessage({
    style: "direct_action_oriented",
    audience: "vendor",
    channel: "sms",
    eventType: "work_order_approved",
    severity: "normal",
    facts: { workOrderNumber: "WO-1042" },
  })
  assertStringIncludes(msg.body, "Update:")
  assertEquals(/Action required|Action needed/i.test(msg.body), false)
  assertStringIncludes(msg.body, "WO-1042")
})

Deno.test("friendly style avoids slang shortcuts", () => {
  const preview = buildCommunicationStylePreview("friendly_conversational")
  assertEquals(/\b(u|ur|pls|thx)\b/i.test(preview.sms), false)
})
