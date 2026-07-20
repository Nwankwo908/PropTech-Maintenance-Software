/// <reference lib="deno.ns" />
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts"
import { styleBlueprintsForIntent } from "./styleBlueprints.ts"

Deno.test("legal blueprints include a good answer and a bad-style reminder", () => {
  const shots = styleBlueprintsForIntent("legal")
  assertEquals(shots.length, 4)
  assertEquals(shots[0].role, "user")
  assertEquals(shots[1].role, "assistant")
  assertEquals(/5-day/.test(shots[1].content), true)
  assertEquals(/Certainly!/.test(shots[2].content), true)
})

Deno.test("draft-ish intents get a resident-note blueprint", () => {
  for (const intent of ["general", "ops", "maintenance"] as const) {
    const shots = styleBlueprintsForIntent(intent)
    assertEquals(shots.length, 2)
    assertEquals(/water shutoff/.test(shots[0].content), true)
    assertEquals(/property management team/.test(shots[1].content), true)
  }
})

Deno.test("prefer-packet intents get no blueprints", () => {
  assertEquals(styleBlueprintsForIntent("executive_briefing").length, 0)
  assertEquals(styleBlueprintsForIntent("property_priority").length, 0)
  assertEquals(styleBlueprintsForIntent("vendor").length, 0)
})
