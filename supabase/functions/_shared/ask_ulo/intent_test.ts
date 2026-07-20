/// <reference lib="deno.ns" />
import {
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts"
import { classifyAskUloIntent, planToolsForIntent } from "./intent.ts"

Deno.test("classifies market analysis intent", () => {
  const r = classifyAskUloIntent(
    "Do a market analysis for my Maple Heights property.",
  )
  assertEquals(r.intent, "market_analysis")
  const plan = planToolsForIntent(r.intent)
  assertEquals(plan.runLegalRag, false)
  assertEquals(plan.runPropertySnapshot, true)
  assertEquals(plan.runMarketData, true)
  assertEquals(plan.opsMode, "leasing_impact")
  assertEquals(plan.visualMode, "market_analysis")
})

Deno.test("price history of Maple Heights is property_price_history, not market_analysis", () => {
  const r = classifyAskUloIntent(
    "Give me the price history of the Maple Heights property.",
  )
  assertEquals(r.intent, "property_price_history")
  const plan = planToolsForIntent(r.intent)
  assertEquals(plan.runPriceHistory, true)
  assertEquals(plan.runMarketData, false)
  assertEquals(plan.visualMode, "none")
  assertEquals(plan.runOpsGraph, false)
})

Deno.test("follow-up price history after market analysis switches intent", () => {
  const r = classifyAskUloIntent("Now show me its price history.", [
    "Do a market analysis for Maple Heights.",
  ])
  assertEquals(r.intent, "property_price_history")
  const plan = planToolsForIntent(r.intent)
  assertEquals(plan.visualMode, "none")
  assertEquals(plan.runPriceHistory, true)
})

Deno.test("rent history intent", () => {
  const r = classifyAskUloIntent("How has rent changed at Maple Heights?")
  assertEquals(r.intent, "rent_history")
  const plan = planToolsForIntent(r.intent)
  assertEquals(plan.runRentHistory, true)
  assertEquals(plan.runMarketData, false)
  assertEquals(plan.visualMode, "none")
})

Deno.test("ambiguous bare price history asks to clarify", () => {
  const r = classifyAskUloIntent("What's the price history?")
  assertEquals(r.intent, "price_history_ambiguous")
  const plan = planToolsForIntent(r.intent)
  assertEquals(plan.runPriceHistory, false)
  assertEquals(plan.visualMode, "none")
})

Deno.test("market rent estimate is not full market analysis", () => {
  const r = classifyAskUloIntent(
    "What could I charge for a two-bedroom at Maple Heights?",
  )
  assertEquals(r.intent, "market_rent_estimate")
  const plan = planToolsForIntent(r.intent)
  assertEquals(plan.runMarketData, true)
  assertEquals(plan.visualMode, "none")
})

Deno.test("average rent for two-bedroom nearby is market_rent_estimate — not ops briefing", () => {
  const r = classifyAskUloIntent(
    "What's the average rent for a two-bedroom nearby?",
  )
  assertEquals(r.intent, "market_rent_estimate")
  const plan = planToolsForIntent(r.intent)
  assertEquals(plan.runMarketData, true)
  assertEquals(plan.runOpsGraph, false)
})

Deno.test("comparable rentals intent", () => {
  const r = classifyAskUloIntent("Compare Maple Heights to nearby rentals")
  assertEquals(r.intent, "comparable_rentals")
  const plan = planToolsForIntent(r.intent)
  assertEquals(plan.visualMode, "comparable_rentals")
  assertEquals(plan.runMarketData, true)
})

Deno.test("classifies maintenance intent", () => {
  const r = classifyAskUloIntent("My tenant has a leaking ceiling.")
  assertEquals(r.intent, "maintenance")
  const plan = planToolsForIntent(r.intent)
  assertEquals(plan.runOpsGraph, true)
  assertEquals(plan.opsMode, "full")
})

Deno.test("classifies legal intent", () => {
  const r = classifyAskUloIntent("What is the security deposit limit in Oregon?")
  assertEquals(r.intent, "legal")
  const plan = planToolsForIntent(r.intent)
  assertEquals(plan.runLegalRag, true)
  assertEquals(plan.runPropertySnapshot, true)
  assertEquals(plan.runOpsGraph, true)
  assertEquals(plan.opsMode, "legal_context")
})

Deno.test("raise the rent classifies as legal", () => {
  const r = classifyAskUloIntent("Can I raise the rent at Maple Heights?")
  assertEquals(r.intent, "legal")
  assertEquals(planToolsForIntent(r.intent).runPropertySnapshot, true)
})

Deno.test("maintenance history at a property is not market analysis", () => {
  const r = classifyAskUloIntent(
    "What maintenance issues has Maple Heights had?",
  )
  assertEquals(r.intent, "maintenance")
})
