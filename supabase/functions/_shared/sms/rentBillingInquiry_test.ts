/// <reference lib="deno.ns" />
import {
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts"
import {
  attachFollowUpToRentBillingInquiryTicket,
  createOrBumpRentBillingInquiryTicket,
  extractInlineRentQuestion,
  formatRentBillingInquiryRef,
  isPendingRentBillingInquiryOpen,
  RENT_BILLING_INQUIRY_TYPE,
  summarizeRentBillingInquiryQuestion,
  writePendingRentBillingInquiry,
} from "./rentBillingInquiry.ts"
import { processRentBillingInquiryTtl } from "./rentBillingInquiryTtl.ts"
import { buildTenantRentQuestionsHandoffSms } from "./tenantRentReplyParse.ts"
import { questionsShouldFallThroughToInterpretation } from "./tenantRentReply.ts"

Deno.test("extractInlineRentQuestion: bare QUESTIONS has no content", () => {
  assertEquals(extractInlineRentQuestion("QUESTIONS"), null)
  assertEquals(extractInlineRentQuestion("questions"), null)
  assertEquals(extractInlineRentQuestion("Reply QUESTIONS"), null)
})

Deno.test("extractInlineRentQuestion: keeps inline billing ask", () => {
  const q = extractInlineRentQuestion(
    "QUESTIONS, why is rent higher than last month",
  )
  assertEquals(q, "why is rent higher than last month")
})

Deno.test("summarizeRentBillingInquiryQuestion: bare vs inline", () => {
  const bare = summarizeRentBillingInquiryQuestion(null)
  assertEquals(bare.awaitingTenantDetail, true)
  assertStringIncludes(bare.summary.toLowerCase(), "no details")

  const inline = summarizeRentBillingInquiryQuestion(
    "why is rent higher than last month",
  )
  assertEquals(inline.awaitingTenantDetail, false)
  assertEquals(inline.summary.length > 0, true)
  assertEquals(/higher|rent/i.test(inline.summary), true)
})

Deno.test("formatRentBillingInquiryRef uses RQ-XXXX", () => {
  assertEquals(
    formatRentBillingInquiryRef("a1b2c3d4-1111-2222-3333-444444444444"),
    "RQ-A1B2",
  )
})

Deno.test("buildTenantRentQuestionsHandoffSms includes ref", () => {
  const body = buildTenantRentQuestionsHandoffSms("RQ-A1B2")
  assertStringIncludes(body, "RQ-A1B2")
  assertStringIncludes(body.toLowerCase(), "property manager")
  assertEquals(/we'll reach out/i.test(body), false)
})

Deno.test("questionsShouldFallThrough: rent billing ask stays on ticket path", () => {
  assertEquals(
    questionsShouldFallThroughToInterpretation(
      "QUESTIONS, why is rent higher than last month",
    ),
    false,
  )
})

Deno.test("questionsShouldFallThrough: repair still leaves rent handler", () => {
  const body = "QUESTIONS — my kitchen sink is leaking badly"
  // When recognizer sees repair, fallthrough is true.
  if (body.toLowerCase().includes("leaking")) {
    assertEquals(questionsShouldFallThroughToInterpretation(body), true)
  }
})

Deno.test("pending rent inquiry attach window", () => {
  const now = new Date("2026-10-01T12:00:00.000Z")
  const open = {
    ticketId: "t1",
    ticketRef: "RQ-T111",
    createdAt: now.toISOString(),
    attachUntil: new Date(now.getTime() + 60_000).toISOString(),
  }
  assertEquals(isPendingRentBillingInquiryOpen(open, now), true)
  assertEquals(
    isPendingRentBillingInquiryOpen(
      open,
      new Date(now.getTime() + 120_000),
    ),
    false,
  )
  const intake = writePendingRentBillingInquiry({}, open)
  assertEquals(
    (intake.pending_rent_billing_inquiry as { ticketId: string }).ticketId,
    "t1",
  )
})

type TicketRow = Record<string, unknown>

function mockSupportTicketsSupabase(store: {
  tickets: TicketRow[]
  attention: Array<Record<string, unknown>>
}) {
  return {
    from(table: string) {
      if (table === "support_tickets") {
        return {
          select(_cols: string) {
            const filters: Array<[string, unknown]> = []
            const chain = {
              eq(c: string, v: unknown) {
                filters.push([c, v])
                return chain
              },
              is(c: string, v: unknown) {
                filters.push([c, v])
                return chain
              },
              not(c: string, _op: string, v: unknown) {
                filters.push([`not:${c}`, v])
                return chain
              },
              lte(c: string, v: unknown) {
                filters.push([`lte:${c}`, v])
                return chain
              },
              order() {
                return chain
              },
              limit(_n: number) {
                return chain
              },
              async maybeSingle() {
                const hit = store.tickets.find((t) =>
                  filters.every(([c, v]) => {
                    if (c.startsWith("lte:")) {
                      const key = c.slice(4)
                      return String(t[key] ?? "") <= String(v)
                    }
                    if (c.startsWith("not:")) {
                      const key = c.slice(4)
                      return t[key] != null && t[key] !== v
                    }
                    if (v === null) return t[c] == null
                    return t[c] === v
                  })
                )
                return { data: hit ?? null, error: null }
              },
              then(resolve: (v: unknown) => unknown) {
                const rows = store.tickets.filter((t) =>
                  filters.every(([c, v]) => {
                    if (c.startsWith("lte:")) {
                      const key = c.slice(4)
                      return String(t[key] ?? "") <= String(v)
                    }
                    if (c.startsWith("not:")) {
                      const key = c.slice(4)
                      return t[key] != null
                    }
                    if (v === null) return t[c] == null
                    return t[c] === v
                  })
                )
                return Promise.resolve(resolve({ data: rows, error: null }))
              },
            }
            return chain
          },
          insert(row: TicketRow) {
            const id = crypto.randomUUID()
            const full = { id, ...row }
            store.tickets.push(full)
            return {
              select() {
                return {
                  async single() {
                    return { data: { id }, error: null }
                  },
                }
              },
            }
          },
          update(patch: TicketRow) {
            const filters: Array<[string, unknown]> = []
            const chain = {
              eq(c: string, v: unknown) {
                filters.push([c, v])
                return chain
              },
              select(_c: string) {
                return {
                  async maybeSingle() {
                    const hit = store.tickets.find((t) =>
                      filters.every(([c, v]) => t[c] === v)
                    )
                    if (hit) Object.assign(hit, patch)
                    return { data: hit ? { id: hit.id, repeat_count: hit.repeat_count } : null, error: null }
                  },
                }
              },
              async then(resolve: (v: unknown) => unknown) {
                for (const t of store.tickets) {
                  if (filters.every(([c, v]) => t[c] === v)) Object.assign(t, patch)
                }
                return resolve({ error: null })
              },
            }
            // Deno/TS: allow await supabase.update().eq()
            ;(chain as unknown as Promise<unknown>).then = (
              resolve: (v: unknown) => unknown,
            ) => {
              for (const t of store.tickets) {
                if (filters.every(([c, v]) => t[c] === v)) Object.assign(t, patch)
              }
              return Promise.resolve(resolve({ error: null }))
            }
            return chain
          },
        }
      }
      // Flexible stub for landlord attention / prefs / activity dual-write.
      const makeChain = (result: { data: unknown; error: null }) => {
        const chain: Record<string, unknown> = {}
        const self = () => chain
        for (const method of [
          "select",
          "eq",
          "neq",
          "in",
          "is",
          "not",
          "gte",
          "lte",
          "gt",
          "lt",
          "order",
          "limit",
          "range",
          "filter",
          "match",
        ]) {
          chain[method] = self
        }
        chain.maybeSingle = async () => ({ data: null, error: null })
        chain.single = async () => result
        chain.then = (resolve: (v: unknown) => unknown) =>
          Promise.resolve(resolve(result))
        return chain
      }
      if (
        table === "operations_graph_events" ||
        table === "property_operations_graph"
      ) {
        return {
          insert(row: TicketRow) {
            store.attention.push({ table, ...row })
            return makeChain({ data: { id: crypto.randomUUID() }, error: null })
          },
          select() {
            return makeChain({ data: [], error: null })
          },
          update() {
            return makeChain({ data: null, error: null })
          },
        }
      }
      return {
        select() {
          return makeChain({ data: [], error: null })
        },
        insert() {
          return makeChain({ data: { id: "x" }, error: null })
        },
        update() {
          return makeChain({ data: null, error: null })
        },
      }
    },
  }
}

Deno.test("bare QUESTIONS creates rent_billing_inquiry ticket", async () => {
  const store = { tickets: [] as TicketRow[], attention: [] as TicketRow[] }
  const supabase = mockSupportTicketsSupabase(store) as never
  const result = await createOrBumpRentBillingInquiryTicket(supabase, {
    landlordId: "11111111-1111-1111-1111-111111111111",
    residentId: "22222222-2222-2222-2222-222222222222",
    conversationId: "33333333-3333-3333-3333-333333333333",
    workflowRunId: "44444444-4444-4444-4444-444444444444",
    billingPeriod: "2026-10",
    body: "QUESTIONS",
    now: new Date("2026-10-01T12:00:00.000Z"),
  })
  assertEquals(result.ok, true)
  if (!result.ok) return
  assertEquals(result.created, true)
  assertEquals(result.awaitingTenantDetail, true)
  assertEquals(store.tickets.length, 1)
  assertEquals(store.tickets[0]!.type, RENT_BILLING_INQUIRY_TYPE)
  assertEquals(store.tickets[0]!.awaiting_tenant_detail, true)
  assertEquals(typeof store.tickets[0]!.escalate_after, "string")
})

Deno.test("inline QUESTIONS captures summary content", async () => {
  const store = { tickets: [] as TicketRow[], attention: [] as TicketRow[] }
  const supabase = mockSupportTicketsSupabase(store) as never
  const result = await createOrBumpRentBillingInquiryTicket(supabase, {
    landlordId: "11111111-1111-1111-1111-111111111111",
    residentId: "22222222-2222-2222-2222-222222222222",
    conversationId: "33333333-3333-3333-3333-333333333333",
    body: "QUESTIONS, why is rent higher than last month",
    now: new Date("2026-10-01T12:00:00.000Z"),
  })
  assertEquals(result.ok, true)
  if (!result.ok) return
  assertEquals(result.awaitingTenantDetail, false)
  assertEquals(/higher|rent/i.test(result.summary), true)
  assertEquals(store.tickets[0]!.awaiting_tenant_detail, false)
})

Deno.test("follow-up attaches to bare QUESTIONS ticket", async () => {
  const ticketId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
  const store = {
    tickets: [
      {
        id: ticketId,
        type: RENT_BILLING_INQUIRY_TYPE,
        status: "open",
        awaiting_tenant_detail: true,
        summary: "Resident asked a rent question (no details yet)",
        repeat_count: 1,
        landlord_id: "11111111-1111-1111-1111-111111111111",
      },
    ] as TicketRow[],
    attention: [] as TicketRow[],
  }
  const supabase = mockSupportTicketsSupabase(store) as never
  const result = await attachFollowUpToRentBillingInquiryTicket(supabase, {
    ticketId,
    landlordId: "11111111-1111-1111-1111-111111111111",
    residentId: "22222222-2222-2222-2222-222222222222",
    conversationId: "33333333-3333-3333-3333-333333333333",
    body: "Why did my balance go up?",
  })
  assertEquals(result.ok, true)
  if (!result.ok) return
  assertEquals(result.awaitingTenantDetail, false)
  assertEquals(store.tickets[0]!.awaiting_tenant_detail, false)
  assertEquals(/balance|up|rent/i.test(String(store.tickets[0]!.summary)), true)
})

Deno.test("unanswered rent-question ticket escalates after TTL", async () => {
  const ticketId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
  const store = {
    tickets: [
      {
        id: ticketId,
        type: RENT_BILLING_INQUIRY_TYPE,
        status: "open",
        landlord_id: "11111111-1111-1111-1111-111111111111",
        resident_id: "22222222-2222-2222-2222-222222222222",
        conversation_id: "33333333-3333-3333-3333-333333333333",
        workflow_run_id: null,
        summary: "Why is rent higher than last month",
        escalate_after: "2026-10-01T12:00:00.000Z",
        escalated_at: null,
      },
    ] as TicketRow[],
    attention: [] as TicketRow[],
  }
  const supabase = mockSupportTicketsSupabase(store) as never
  const summary = await processRentBillingInquiryTtl(supabase, {
    now: new Date("2026-10-02T13:00:00.000Z"),
  })
  assertEquals(summary.escalated, 1)
  assertEquals(store.tickets[0]!.escalated_at != null, true)
})
