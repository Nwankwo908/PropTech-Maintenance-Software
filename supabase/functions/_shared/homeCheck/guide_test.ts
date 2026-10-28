/// <reference lib="deno.ns" />
import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts"
import {
  type HomeCheckGuideCatalog,
  type HomeCheckGuideState,
  reduceHomeCheckGuide,
  tickHomeCheckGuide,
} from "./guide.ts"

const NOW = new Date("2026-10-28T15:00:00.000Z")
const WINDOW_END = "2026-10-29T20:00:00.000Z"

const catalog: HomeCheckGuideCatalog = {
  companyName: "Disposable Test",
  timeZone: "America/New_York",
  properties: [
    {
      id: "oak",
      label: "12 Oak St",
      propertyType: "multi_family",
      units: [
        { id: "u2", label: "2B" },
        { id: "u3", label: "3A" },
      ],
    },
    {
      id: "maple",
      label: "14 Maple Ave",
      propertyType: "single_family",
      units: [{ id: "home", label: "Home" }],
    },
  ],
  vendors: [
    { id: "near", name: "Rapid Electric", distanceKm: 1.2 },
    { id: "far", name: "Far Electric", distanceKm: 9 },
  ],
  tenant: { name: "Avery Stone", phone: "+19088843069", optedOut: false },
}

function say(
  state: HomeCheckGuideState | null,
  body: string,
  sender: "landlord" | "tenant" = "landlord",
  now = NOW,
  source: HomeCheckGuideCatalog = catalog,
) {
  return reduceHomeCheckGuide({ state, body, catalog: source, now, sender })
}

function noLink(text: string) {
  assertEquals(/\/c\/|https?:/i.test(text), false)
}

Deno.test("landlord tenant, self, and contractor paths", () => {
  let turn = say(null, "home check")
  assertStringIncludes(turn.replies.join("\n"), "1) 12 Oak St")
  assertEquals(turn.effects, [])

  turn = say(turn.state, "1")
  assertStringIncludes(turn.replies[0], "12 Oak St")
  assertEquals(turn.replies[0].includes("Unit"), false)
  turn = say(turn.state, "YES")
  assertStringIncludes(turn.replies[0], "Which unit")
  turn = say(turn.state, "1")
  assertStringIncludes(turn.replies[0], "Who should do it?")
  turn = say(turn.state, "1")
  assertEquals(turn.effects, [{ type: "start_tenant", propertyId: "oak", unitId: "u2" }])
  noLink(turn.replies.join("\n"))

  turn = say(null, "home check 14 Maple")
  assertStringIncludes(turn.replies[0], "14 Maple Ave")
  assertEquals(/\bUnit\b/.test(turn.replies[0]), false)
  turn = say(turn.state, "YES")
  turn = say(turn.state, "3")
  assertEquals(turn.effects[0]?.type, "start_self")
  noLink(turn.replies.join("\n"))

  turn = say(null, "can someone check the equipment at 12 Oak")
  turn = say(turn.state, "YES")
  turn = say(turn.state, "1")
  turn = say(turn.state, "2")
  assertStringIncludes(turn.replies[0], "Rapid Electric")
  turn = say(turn.state, "YES")
  turn = say(turn.state, "Thu 2-4pm")
  assertEquals(turn.effects.map((effect) => effect.type), ["text_tenant"])
  assertEquals(turn.effects.some((effect) => effect.type === "send_contractor"), false)
  assertStringIncludes(turn.effects[0].type === "text_tenant" ? turn.effects[0].body : "", "water heater and furnace")
  const waiting = turn.state
  turn = say(waiting, "Thu 2-4pm and I'll be home", "tenant")
  const sent = turn.effects.find((effect) => effect.type === "send_contractor")
  assertEquals(sent?.type, "send_contractor")
  if (sent?.type === "send_contractor") {
    assertEquals(sent.propertyId, "oak")
    assertEquals(sent.unitId, "u2")
    assertEquals(sent.vendorId, "near")
    assertEquals(sent.windowEnd, WINDOW_END)
    assertEquals(sent.landlordBody?.includes("/c/"), false)
    assertEquals(sent.tenantBody, null)
  }
  noLink(turn.replies.join("\n"))
})

Deno.test("tenant or vendor wording does not get a home check reply", () => {
  const tenant = say(null, "home check", "tenant")
  assertEquals(tenant.replies, [])
  assertEquals(tenant.effects, [])
  const vendor = say(null, "can someone check the equipment at Maple", "tenant")
  assertEquals(vendor.replies.join(" "), "")
})

Deno.test("ambiguous property or unit creates no check", () => {
  const ambiguous: HomeCheckGuideCatalog = {
    ...catalog,
    properties: [
      { ...catalog.properties[0], id: "oak-a", label: "12 Oak St" },
      { ...catalog.properties[0], id: "oak-b", label: "18 Oak St" },
    ],
  }
  const turn = say(null, "home check oak", "landlord", NOW, ambiguous)
  assertStringIncludes(turn.replies[0], "Which property")
  assertEquals(turn.effects, [])
  assertEquals(turn.state?.step, "pick_property")
})

Deno.test("contractor link waits for a time, then a reminder, handoff, confirm, or cancel", () => {
  let turn = say(null, "CHECK CONTRACTOR 12 Oak St / 2B")
  turn = say(turn.state, "YES")
  turn = say(turn.state, "YES")
  turn = say(turn.state, "Thu 2-4pm")
  assertEquals(turn.state?.step, "awaiting_tenant")
  assertEquals(turn.effects.some((effect) => effect.type === "send_contractor"), false)

  const reminded = tickHomeCheckGuide(
    turn.state,
    catalog,
    new Date(NOW.getTime() + 25 * 60 * 60 * 1000),
  )
  assertEquals(reminded.effects.length, 1)
  assertEquals(reminded.effects[0]?.type, "text_tenant")
  const again = tickHomeCheckGuide(
    reminded.state,
    catalog,
    new Date(NOW.getTime() + 30 * 60 * 60 * 1000),
  )
  assertEquals(again.effects, [])

  const handed = tickHomeCheckGuide(
    reminded.state,
    catalog,
    new Date(NOW.getTime() + 49 * 60 * 60 * 1000),
  )
  assertStringIncludes(handed.replies[0], "Avery Stone")
  assertStringIncludes(handed.replies[0], "2B")
  assertStringIncludes(handed.replies[0], "+19088843069")
  assertEquals(handed.effects.some((effect) => effect.type === "send_contractor"), false)

  const confirmed = say(handed.state, "Thu 2-4pm")
  const link = confirmed.effects.find((effect) => effect.type === "send_contractor")
  assertEquals(link?.type, "send_contractor")
  if (link?.type === "send_contractor") {
    assertEquals(link.windowEnd, WINDOW_END)
    assertEquals(link.propertyId, "oak")
    assertEquals(link.unitId, "u2")
    noLink(link.tenantBody || "")
    noLink(confirmed.replies.join("\n"))
  }

  const cancelled = say(handed.state, "CANCEL")
  assertEquals(cancelled.state, null)
  assertEquals(cancelled.effects.some((effect) => effect.type === "send_contractor"), false)
  assertStringIncludes(cancelled.replies[0], "cancelled")
})

Deno.test("an opted-out tenant goes straight to the landlord handoff", () => {
  const opted: HomeCheckGuideCatalog = {
    ...catalog,
    tenant: { name: "Avery Stone", phone: "+19088843069", optedOut: true },
  }
  let turn = say(null, "home check 12 Oak St / 2B", "landlord", NOW, opted)
  turn = say(turn.state, "YES", "landlord", NOW, opted)
  turn = say(turn.state, "2", "landlord", NOW, opted)
  turn = say(turn.state, "YES", "landlord", NOW, opted)
  turn = say(turn.state, "Thu 2-4pm", "landlord", NOW, opted)
  assertEquals(turn.state?.step, "awaiting_landlord")
  assertStringIncludes(turn.replies[0], "+19088843069")
  assertStringIncludes(turn.replies[0], "Avery Stone")
  assertEquals(turn.effects.filter((effect) => effect.type === "text_tenant"), [])
  assertEquals(turn.effects.filter((effect) => effect.type === "send_contractor"), [])
})

Deno.test("a stale menu reply does not start a check", () => {
  const stale: HomeCheckGuideState = {
    step: "pick_who",
    updatedAt: new Date(NOW.getTime() - 25 * 60 * 60 * 1000).toISOString(),
    role: null,
    propertyId: "oak",
    unitId: "u2",
    placeLabel: "12 Oak St · Unit 2B",
  }
  const turn = say(stale, "1")
  assertEquals(turn.state, null)
  assertEquals(turn.effects, [])
  assertStringIncludes(turn.replies[0], "expired")
})

Deno.test("a second home check replaces the unfinished one", () => {
  const first = say(null, "home check")
  const again = say(first.state, "home check 14 Maple")
  assertStringIncludes(again.replies[0], "14 Maple Ave")
  assertEquals(again.effects, [])
})
