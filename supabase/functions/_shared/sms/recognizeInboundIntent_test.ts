/// <reference lib="deno.ns" />
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts"
import {
  isRepairRecognition,
  recognizeInboundIntent,
  recognizeInboundIntentSync,
  summarizeIssueText,
  upgradeUnmatchedRecognition,
} from "./recognizeInboundIntent.ts"
import { heuristicInterpretInbound } from "./inboundInterpretation.ts"
import { planAssistantOtherReply } from "./tenantAssistantReply.ts"
import { determineNextMaintenanceQuestion } from "./determineNextMaintenanceQuestion.ts"

/** The repair / rent / lease menu only goes out when nothing was recognized. */
function menuWouldBeSent(body: string): boolean {
  const recognized = recognizeInboundIntentSync(body)
  if (!recognized.showMenu) return false
  const interpretation = heuristicInterpretInbound(body, { activeIntake: false })
  if (interpretation.intent === "maintenance_new") return false
  return planAssistantOtherReply({ body, activeIntake: false }).replyType ===
    "sms_clarify"
}

const REPAIRS = [
  "no hot water",
  "roof leak",
  "broken window",
  "peeling paint",
  "uneven sidewalk",
  "lawn needs cutting",
  "cabinet door fell off",
  "deck board loose",
  "water coming through the ceiling",
  "no hay agua caliente",
  "I smell gas",
  "carbon monoxide alarm is going off",
] as const

Deno.test("every repair report is recognized as a repair", () => {
  for (const body of REPAIRS) {
    const recognized = recognizeInboundIntentSync(body)
    assertEquals(isRepairRecognition(recognized), true, body)
    assertEquals(recognized.showMenu, false, body)
  }
})

Deno.test("no repair report falls through to the repair / rent / lease menu", () => {
  for (const body of REPAIRS) {
    assertEquals(menuWouldBeSent(body), false, body)
    assertEquals(
      heuristicInterpretInbound(body).intent,
      "maintenance_new",
      body,
    )
  }
})

Deno.test("gas, carbon monoxide and Spanish hazards stop at the emergency net", () => {
  for (const body of ["I smell gas", "carbon monoxide alarm is going off"]) {
    const recognized = recognizeInboundIntentSync(body)
    assertEquals(recognized.intent, "emergency", body)
    assertEquals(recognized.layer, "emergency_net", body)
    assertEquals(recognized.confidence, 1, body)
  }

  const spanish = recognizeInboundIntentSync("Huele a gas en la cocina")
  assertEquals(spanish.intent, "emergency")
  assertEquals(spanish.layer, "emergency_net")

  const freezing = recognizeInboundIntentSync("No heat and it's freezing in here")
  assertEquals(freezing.intent, "emergency")
  assertEquals(freezing.emergencyType, "habitability")
})

Deno.test("Spanish repair reports use the same English rules", () => {
  const hotWater = recognizeInboundIntentSync("no hay agua caliente")
  assertEquals(hotWater.intent, "repair")
  assertEquals(hotWater.layer, "rules")

  const notWorking = recognizeInboundIntentSync("La estufa no funciona")
  assertEquals(isRepairRecognition(notWorking), true)
})

Deno.test("non-repair texts keep their own intent", () => {
  const cases: Array<[string, string]> = [
    ["hello", "small_talk"],
    ["thanks", "small_talk"],
    ["when is rent due", "rent"],
    ["can I renew my lease", "lease"],
    ["can someone call me", "human_request"],
  ]
  for (const [body, intent] of cases) {
    const recognized = recognizeInboundIntentSync(body)
    assertEquals(recognized.intent, intent, body)
    assertEquals(isRepairRecognition(recognized), false, body)
    assertEquals(
      heuristicInterpretInbound(body).intent === "maintenance_new",
      false,
      body,
    )
  }
})

Deno.test("status questions are not new repairs", () => {
  const recognized = recognizeInboundIntentSync(
    "When is the electrician coming?",
  )
  assertEquals(recognized.intent, "status_check")
  assertEquals(isRepairRecognition(recognized), false)
})

Deno.test("a message with no signal at all still gets the menu", () => {
  const recognized = recognizeInboundIntentSync("Hmm")
  assertEquals(recognized.intent, "unclear")
  assertEquals(recognized.layer, "menu")
  assertEquals(recognized.showMenu, true)
  assertEquals(menuWouldBeSent("Hmm"), true)
})

Deno.test("an unmatched problem signal starts intake and confirms the reading", () => {
  const recognized = recognizeInboundIntentSync(
    "The thing above the porch is hanging loose",
  )
  assertEquals(recognized.intent, "repair")
  assertEquals(recognized.layer, "problem_signal")
  assertEquals(recognized.showMenu, false)
  assertEquals(
    recognized.confirmation,
    "Sounds like thing above the porch is hanging loose, is that right?",
  )
})

Deno.test("intake confirms a weak reading in its first question", () => {
  const weak = determineNextMaintenanceQuestion({
    initial_message: "The thing above the porch is hanging loose",
    description: "The thing above the porch is hanging loose",
  })
  assertEquals(weak.shouldAsk, true)
  assertEquals(
    (weak.shouldAsk ? weak.question : "").startsWith(
      "Sounds like thing above the porch is hanging loose, is that right?",
    ),
    true,
  )

  // A confident reading just gets on with intake.
  const confident = determineNextMaintenanceQuestion({
    initial_message: "No hot water",
    description: "No hot water",
  })
  assertEquals(
    (confident.shouldAsk ? confident.question : "").startsWith("Sounds like"),
    false,
  )
})

Deno.test("summaries drop greetings and lead-ins", () => {
  assertEquals(summarizeIssueText("Hi, I have no hot water"), "no hot water")
  assertEquals(summarizeIssueText("There's a leak under the sink"), "leak under the sink")
})

Deno.test("the LLM layer only runs on fresh, still-undecided threads", async () => {
  let calls = 0
  const fetchImpl = ((_input: unknown, _init?: unknown) => {
    calls++
    return Promise.resolve(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  intent: "repair",
                  confidence: 0.82,
                  issue_summary: "the hallway thing keeps coming apart",
                }),
              },
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    )
  }) as unknown as typeof fetch

  const undecided = await recognizeInboundIntent("that hallway thing again", {
    freshThread: true,
    skipSemantic: true,
    openaiKey: "test-key",
    fetchImpl,
  })
  assertEquals(undecided.intent, "repair")
  assertEquals(undecided.layer, "llm")
  assertEquals(calls, 1)

  // Deterministic layers win outright — no model call, no override.
  const decided = await recognizeInboundIntent("I smell gas", {
    freshThread: true,
    skipSemantic: true,
    openaiKey: "test-key",
    fetchImpl,
  })
  assertEquals(decided.layer, "emergency_net")
  assertEquals(calls, 1)

  // Mid-conversation threads never pay for the model.
  const ongoing = await recognizeInboundIntent("that hallway thing again", {
    activeIntake: true,
    skipSemantic: true,
    openaiKey: "test-key",
    fetchImpl,
  })
  assertEquals(ongoing.layer, "menu")
  assertEquals(calls, 1)
})

Deno.test("an LLM failure falls through to the problem-signal default", async () => {
  const fetchImpl = (() =>
    Promise.reject(new Error("timeout"))) as unknown as typeof fetch

  const recognized = await recognizeInboundIntent("the closet shelf fell down", {
    freshThread: true,
    skipSemantic: true,
    openaiKey: "test-key",
    fetchImpl,
  })
  assertEquals(recognized.intent, "repair")
  assertEquals(recognized.showMenu, false)
})

Deno.test("unplaced text goes to the phrase library before the menu", async () => {
  // These phrasings are deliberately absent from deterministicRules.ts: new
  // ways of saying "no water" should be caught by similarity instead.
  for (
    const text of [
      "no water pressure",
      "water won't turn on",
      "pipes are dry",
      "nothing coming out of the tap",
      "no hay agua",
    ]
  ) {
    const sync = recognizeInboundIntentSync(text)
    const upgraded = await upgradeUnmatchedRecognition(text, sync)
    assertEquals(upgraded.intent, "repair", text)
    assertEquals(upgraded.showMenu, false, text)
    // Placed by the rules or the library — never left for the menu.
    assertEquals(
      upgraded.layer === "rules" || upgraded.layer === "semantic",
      true,
      `${text} landed on ${upgraded.layer}`,
    )
  }

  // "no hay agua" used to reach the menu; the library now places it.
  const spanish = "no hay agua"
  assertEquals(recognizeInboundIntentSync(spanish).layer, "menu")
  const placed = await upgradeUnmatchedRecognition(
    spanish,
    recognizeInboundIntentSync(spanish),
  )
  assertEquals(placed.layer, "semantic")
  // A library match is a guess, so the reading is confirmed back.
  assertEquals(typeof placed.confirmation, "string")
})

Deno.test("the library is not consulted once a layer has decided", async () => {
  const decided = recognizeInboundIntentSync("I smell gas")
  assertEquals(decided.layer, "emergency_net")
  assertEquals(
    (await upgradeUnmatchedRecognition("I smell gas", decided)).layer,
    "emergency_net",
  )

  const rent = recognizeInboundIntentSync("when is rent due")
  assertEquals((await upgradeUnmatchedRecognition("when is rent due", rent)).intent, "rent")
})

Deno.test("text with no signal at all still gets the menu", async () => {
  const sync = recognizeInboundIntentSync("ok thanks for that")
  const upgraded = await upgradeUnmatchedRecognition("ok thanks for that", sync)
  assertEquals(upgraded.intent === "repair", false)
})
