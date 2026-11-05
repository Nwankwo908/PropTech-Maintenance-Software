import {
  assertEquals,
  assertMatch,
} from "https://deno.land/std@0.224.0/assert/mod.ts"
import { summarizeMaintenanceRequest } from "./maintenanceRequestSummary.ts"

const GANAIA = [
  "Good morning. There is a leak in the baseboard heater for the first floor. The entire valve is rusted out and may need to be replaced.",
  "",
  "The leak is in the baseboard heater for the first floor. In the basement",
].join("\n")

Deno.test("deterministic fallback produces required Ganaia wording", async () => {
  const summary = await summarizeMaintenanceRequest(GANAIA, {
    category: "plumbing",
    skipLlm: true,
  })
  assertEquals(summary.title, "Baseboard heater leak")
  assertEquals(summary.location, "Basement")
  assertEquals(
    summary.description,
    "The tenant reports a leak from the basement baseboard heater serving the first floor. The valve is heavily rusted and may need replacement.",
  )
  assertEquals(summary.source, "deterministic")
  assertEquals(summary.facts.servesFloor?.toLowerCase().includes("first floor"), true)
})

Deno.test("AI path accepts validated Luna JSON", async () => {
  const summary = await summarizeMaintenanceRequest(GANAIA, {
    category: "plumbing",
    openaiKey: "test-key",
    fetchImpl: async () =>
      new Response(
        JSON.stringify({
          choices: [{
            message: {
              content: JSON.stringify({
                title: "Baseboard heater leak",
                location: "Basement",
                description:
                  "The tenant reports a leak from the basement baseboard heater serving the first floor. The valve is heavily rusted and may need replacement.",
              }),
            },
          }],
        }),
        { status: 200 },
      ),
  })
  assertEquals(summary.source, "llm")
  assertEquals(summary.title, "Baseboard heater leak")
  assertEquals(summary.location, "Basement")
  assertMatch(summary.description, /tenant reports/i)
  assertMatch(summary.description, /valve/i)
})

Deno.test("AI inventing unsupported room falls back", async () => {
  const summary = await summarizeMaintenanceRequest(GANAIA, {
    category: "plumbing",
    openaiKey: "test-key",
    fetchImpl: async () =>
      new Response(
        JSON.stringify({
          choices: [{
            message: {
              content: JSON.stringify({
                title: "Baseboard heater leak",
                location: "Basement",
                description:
                  "The tenant reports a leak from the basement baseboard heater and also the kitchen sink.",
              }),
            },
          }],
        }),
        { status: 200 },
      ),
  })
  assertEquals(summary.source, "fallback")
  assertEquals(summary.location, "Basement")
  assertEquals(summary.description.includes("kitchen"), false)
})

Deno.test("AI generic Plumbing issue title falls back", async () => {
  const summary = await summarizeMaintenanceRequest(GANAIA, {
    openaiKey: "test-key",
    fetchImpl: async () =>
      new Response(
        JSON.stringify({
          choices: [{
            message: {
              content: JSON.stringify({
                title: "Plumbing issue",
                location: "Basement",
                description: "Plumbing issue in the basement.",
              }),
            },
          }],
        }),
        { status: 200 },
      ),
  })
  assertEquals(summary.source, "fallback")
  assertEquals(summary.title, "Baseboard heater leak")
})

Deno.test("missing OpenAI key uses fallback source tag", async () => {
  const summary = await summarizeMaintenanceRequest(GANAIA, {
    openaiKey: "",
    skipLlm: false,
  })
  assertEquals(summary.source, "fallback")
  assertEquals(summary.title, "Baseboard heater leak")
})
