import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts"
import {
  resolveTryDemoUnmatchedInbound,
  shouldSilenceTryDemoResidentAfterCap,
  shouldSilenceTryDemoSampleReply,
  TRY_DEMO_RESIDENT_MAX_ULO_REPLIES,
} from "./tryDemoSilence.ts"

function fakeSupabase(handlers: Record<string, () => unknown>) {
  return {
    from(table: string) {
      const handler = handlers[table]
      if (!handler) throw new Error(`unexpected table ${table}`)
      return handler()
    },
  }
}

function experienceQuery(result: { data: unknown; error: null | { message: string } }) {
  const builder = {
    select() {
      return builder
    },
    in() {
      return builder
    },
    eq() {
      return builder
    },
    limit() {
      return builder
    },
    order() {
      return builder
    },
    maybeSingle() {
      return Promise.resolve(result)
    },
    then(resolve: (value: unknown) => unknown) {
      return Promise.resolve(result).then(resolve)
    },
  }
  return builder
}

Deno.test("shouldSilenceTryDemoSampleReply is true for landlord sample", async () => {
  const silence = await shouldSilenceTryDemoSampleReply(
    fakeSupabase({
      try_demo_experience_sends: () =>
        experienceQuery({
          data: [{ id: "row-1", experience: "landlord" }],
          error: null,
        }),
    }) as never,
    "+15551234567",
  )
  assertEquals(silence, true)
})

Deno.test("shouldSilenceTryDemoSampleReply is true for vendor sample", async () => {
  const silence = await shouldSilenceTryDemoSampleReply(
    fakeSupabase({
      try_demo_experience_sends: () =>
        experienceQuery({
          data: [{ id: "row-v", experience: "vendor" }],
          error: null,
        }),
    }) as never,
    "+15551112222",
  )
  assertEquals(silence, true)
})

Deno.test("shouldSilenceTryDemoSampleReply is false when no sample row", async () => {
  const silence = await shouldSilenceTryDemoSampleReply(
    fakeSupabase({
      try_demo_experience_sends: () => experienceQuery({ data: [], error: null }),
    }) as never,
    "+15551234567",
  )
  assertEquals(silence, false)
})

Deno.test("resolveTryDemoUnmatchedInbound silences resident after Ulo reply cap", async () => {
  let messageCountCalls = 0
  const decision = await resolveTryDemoUnmatchedInbound(
    fakeSupabase({
      try_demo_experience_sends: () =>
        experienceQuery({
          data: [{ id: "row-r", experience: "resident" }],
          error: null,
        }),
      sms_conversations: () =>
        experienceQuery({
          data: [{ id: "conv-1" }],
          error: null,
        }),
      sms_messages: () => {
        messageCountCalls += 1
        return {
          select(_cols: string, _opts?: { count?: string; head?: boolean }) {
            return {
              in() {
                return this
              },
              eq() {
                return Promise.resolve({
                  count: TRY_DEMO_RESIDENT_MAX_ULO_REPLIES,
                  error: null,
                })
              },
            }
          },
        }
      },
    }) as never,
    "+15559876543",
  )
  assertEquals(decision.action, "silence")
  if (decision.action === "silence") {
    assertEquals(decision.reason, "resident_cap")
  }
  assertEquals(messageCountCalls >= 1, true)
})

Deno.test("shouldSilenceTryDemoResidentAfterCap is false under the limit", async () => {
  const capped = await shouldSilenceTryDemoResidentAfterCap(
    fakeSupabase({
      try_demo_experience_sends: () =>
        experienceQuery({
          data: [{ id: "row-r", experience: "resident" }],
          error: null,
        }),
      sms_conversations: () =>
        experienceQuery({
          data: [{ id: "conv-1" }],
          error: null,
        }),
      sms_messages: () => ({
        select() {
          return {
            in() {
              return this
            },
            eq() {
              return Promise.resolve({
                count: TRY_DEMO_RESIDENT_MAX_ULO_REPLIES - 1,
                error: null,
              })
            },
          }
        },
      }),
    }) as never,
    "+15559876543",
  )
  assertEquals(capped, false)
})

Deno.test("shouldSilenceTryDemoResidentAfterCap is true at the limit", async () => {
  const capped = await shouldSilenceTryDemoResidentAfterCap(
    fakeSupabase({
      try_demo_experience_sends: () =>
        experienceQuery({
          data: [{ id: "row-r", experience: "resident" }],
          error: null,
        }),
      sms_conversations: () =>
        experienceQuery({
          data: [{ id: "conv-1" }],
          error: null,
        }),
      sms_messages: () => ({
        select() {
          return {
            in() {
              return this
            },
            eq() {
              return Promise.resolve({
                count: TRY_DEMO_RESIDENT_MAX_ULO_REPLIES,
                error: null,
              })
            },
          }
        },
      }),
    }) as never,
    "+15559876543",
  )
  assertEquals(capped, true)
})
