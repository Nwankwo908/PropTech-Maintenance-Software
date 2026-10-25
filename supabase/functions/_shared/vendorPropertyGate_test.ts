/// <reference lib="deno.ns" />
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts"
import {
  canHandlePropertyChoice,
  decideVendorPropertyGate,
  isImmediatePropertyEmergency,
  matchPropertyChoice,
  propertyUnknownAttentionCopy,
} from "./vendorPropertyGate.ts"

const maple = {
  id: "prop-maple",
  name: "Maple House",
  streetAddress: "14 Maple Ave",
  city: "Newark",
  state: "NJ",
}
const oak = {
  id: "prop-oak",
  name: "Oak House",
  streetAddress: "9 Oak St",
  city: "Jersey City",
  state: "NJ",
}

Deno.test("one property is assumed and can be booked", () => {
  const decision = decideVendorPropertyGate({
    ticketPropertyId: null,
    properties: [maple],
  })
  assertEquals(decision.assumePropertyId, "prop-maple")
  assertEquals(decision.mayBook, true)
  assertEquals(decision.mayLook, true)
  assertEquals(decision.askProperty, false)
  assertEquals(decision.state, "NJ")
})

Deno.test("several properties in one state can be searched but not booked", () => {
  const decision = decideVendorPropertyGate({
    ticketPropertyId: null,
    properties: [maple, oak],
  })
  assertEquals(decision.assumePropertyId, null)
  assertEquals(decision.mayBook, false)
  assertEquals(decision.mayLook, true)
  assertEquals(decision.askProperty, true)
  assertEquals(decision.state, "NJ")
  assertEquals(decision.options.map((option) => option.label), [
    "Maple House, 14 Maple Ave, Newark",
    "Oak House, 9 Oak St, Jersey City",
  ])
})

Deno.test("several states are not searched until a property is chosen", () => {
  const decision = decideVendorPropertyGate({
    ticketPropertyId: null,
    properties: [maple, { ...oak, state: "NY", city: "Brooklyn" }],
  })
  assertEquals(decision.mayBook, false)
  assertEquals(decision.mayLook, false)
  assertEquals(decision.askProperty, true)
  assertEquals(decision.state, null)
})

Deno.test("a ticket that already has a property can be booked", () => {
  const decision = decideVendorPropertyGate({
    ticketPropertyId: "prop-oak",
    properties: [maple, oak],
  })
  assertEquals(decision.mayBook, true)
  assertEquals(decision.askProperty, false)
  assertEquals(decision.assumePropertyId, null)
  assertEquals(decision.state, "NJ")
})

Deno.test("property reply matches a number or a unique name", () => {
  const options = [
    { id: "prop-maple", label: "Maple House, 14 Maple Ave" },
    { id: "prop-oak", label: "Oak House, 9 Oak St" },
  ]
  assertEquals(matchPropertyChoice("2", options)?.id, "prop-oak")
  assertEquals(matchPropertyChoice("maple house", options)?.id, "prop-maple")
  assertEquals(matchPropertyChoice("oak", options)?.id, "prop-oak")
  assertEquals(matchPropertyChoice("house", options), null)
  assertEquals(matchPropertyChoice("3", options), null)
})

Deno.test("property choice requires the pending ask and ignores vendors", () => {
  const pending = {
    awaiting_property_choice: {
      ticket_id: "ticket-1",
      options: [{ id: "prop-maple", label: "14 Maple Ave" }],
    },
  }
  assertEquals(
    canHandlePropertyChoice({ identityType: "landlord", intakeState: pending }),
    true,
  )
  assertEquals(
    canHandlePropertyChoice({ identityType: "resident", intakeState: pending }),
    true,
  )
  assertEquals(
    canHandlePropertyChoice({ identityType: "vendor", intakeState: pending }),
    false,
  )
  assertEquals(
    canHandlePropertyChoice({ identityType: "landlord", intakeState: {} }),
    false,
  )
})

Deno.test("emergency property question alerts a person and does not say anyone is booked", () => {
  assertEquals(
    isImmediatePropertyEmergency({ priority: "urgent", urgency: "normal" }),
    false,
  )
  assertEquals(
    isImmediatePropertyEmergency({ priority: "emergency" }),
    true,
  )
  const copy = propertyUnknownAttentionCopy({
    emergency: true,
    issueLine: "Water pouring through the ceiling",
    options: [
      { id: "prop-maple", label: "14 Maple Ave" },
      { id: "prop-oak", label: "9 Oak St" },
    ],
  })
  assertEquals(copy.headline, "emergency — which property is this for?")
  assertEquals(copy.locationLine, "Water pouring through the ceiling")
  assertEquals(copy.whyLine.includes("alerted now"), true)
  assertEquals(copy.whyLine.includes("know the address"), true)
  assertEquals(copy.whyLine.includes("will not book"), true)
  const unknown = propertyUnknownAttentionCopy({
    emergency: true,
    issueLine: null,
    options: [{ id: "prop-maple", label: "14 Maple Ave" }],
  })
  assertEquals(unknown.locationLine, "The address is not on this job yet.")
  assertEquals(copy.nextSteps, ["14 Maple Ave", "9 Oak St"])
})
