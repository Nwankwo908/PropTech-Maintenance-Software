import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts"
import { checkSafetyRules } from "../../guards/checkSafetyRules.ts"
import { classifyQuestion } from "../../routing/classifyQuestion.ts"

function fakeSupabase() {
  const chain: any = {
    insert: () => chain,
    select: () => chain,
    maybeSingle: async () => ({ data: { id: "turn-1" }, error: null }),
    single: async () => ({ data: { id: "evt-1" }, error: null }),
    eq: () => chain,
    update: () => chain,
  }
  return {
    from: () => chain,
  }
}

function fakeContext(question: string, overrides: Record<string, unknown> = {}) {
  return {
    supabase: fakeSupabase() as any,
    question,
    landlordId: "ll-1",
    userId: null,
    history: [],
    conversationId: null,
    agentMode: null,
    now: new Date(),
    startedAt: Date.now(),
    priorUserTurns: [],
    retrievalQuestion: question,
    portfolioJurisdiction: {
      stateCode: "NJ",
      citySlug: null,
      cityLabel: null,
      locationSource: "default",
      buildingCount: 0,
    },
    propertyScope: { buildingFilter: null, sampleBuildings: [], buildingCount: 0 },
    permissions: {
      canSeeResidents: true,
      canSeeVendors: true,
      canSeeFinance: true,
      canAskLegal: true,
    },
    flags: {},
    ...overrides,
  } as any
}

Deno.test("checkSafetyRules allows ordinary ops question", async () => {
  const question = "Which tenants are late on rent?"
  const classification = classifyQuestion({
    question,
    priorUserTurns: [],
    agentMode: null,
  })
  const result = await checkSafetyRules(fakeContext(question), classification)
  assertEquals(result.allowed, true)
  if (result.allowed) {
    assertEquals(typeof result.safety.requireCounsel, "boolean")
  }
})

Deno.test("checkSafetyRules blocks when resident permission denied", async () => {
  const question = "Which tenants are late on rent?"
  const classification = classifyQuestion({
    question,
    priorUserTurns: [],
    agentMode: null,
  })
  const result = await checkSafetyRules(
    fakeContext(question, {
      permissions: {
        canSeeResidents: false,
        canSeeVendors: true,
        canSeeFinance: true,
        canAskLegal: true,
      },
    }),
    classification,
  )
  assertEquals(result.allowed, false)
  if (!result.allowed) {
    assertEquals(result.response.safetyBoundary?.blocked, true)
  }
})
