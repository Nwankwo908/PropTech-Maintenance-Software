/// <reference lib="deno.ns" />
/**
 * Concurrent approveMaintenanceInvoice — only one caller wins the
 * submitted → approved transition; loser gets already_approved; one ledger
 * + one spend graph event.
 */
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts"
import { approveMaintenanceInvoice } from "./maintenanceSpend.ts"

type RaceState = {
  invoice: Record<string, unknown>
  scope: Record<string, unknown>
  ticket: Record<string, unknown>
  ledgerInserts: number
  spendGraphEvents: number
  approveWins: number
}

function mockRaceSupabase(state: RaceState) {
  const from = (table: string) => {
    let filters: Array<{ col: string; val: unknown }> = []
    let pendingUpdate: Record<string, unknown> | null = null
    let pendingInsert: Record<string, unknown> | null = null

    const matchesFilters = (row: Record<string, unknown>) =>
      filters.every((f) => String(row[f.col] ?? "") === String(f.val ?? ""))

    const finishUpdate = async () => {
      if (pendingUpdate && table === "maintenance_invoices") {
        if (matchesFilters(state.invoice)) {
          Object.assign(state.invoice, pendingUpdate)
          state.approveWins += 1
          return { data: [{ id: state.invoice.id }], error: null }
        }
        return { data: [], error: null }
      }
      if (pendingUpdate && table === "maintenance_requests") {
        Object.assign(state.ticket, pendingUpdate)
        return { data: null, error: null }
      }
      return { data: null, error: null }
    }

    const finishInsert = async () => {
      if (!pendingInsert) return { data: null, error: null }
      if (table === "ledger_events") {
        state.ledgerInserts += 1
        return { data: { id: `ledger-${state.ledgerInserts}` }, error: null }
      }
      if (
        table === "operations_graph_events" ||
        table === "property_operations_graph"
      ) {
        const et = String(pendingInsert.event_type ?? "")
        if (
          et === "maintenance.spend_recorded" ||
          et === "maintenance.invoice_paid"
        ) {
          state.spendGraphEvents += 1
        }
        return { data: { id: "evt-1" }, error: null }
      }
      return { data: { id: "row-1" }, error: null }
    }

    const chain: Record<string, unknown> = {}
    chain.select = (_cols?: string) => chain
    chain.eq = (col: string, val: unknown) => {
      filters.push({ col, val })
      return chain
    }
    chain.maybeSingle = async () => {
      if (table === "maintenance_invoices") {
        return { data: { ...state.invoice }, error: null }
      }
      if (table === "maintenance_request_enriched") {
        return { data: { ...state.scope }, error: null }
      }
      if (table === "maintenance_requests") {
        return { data: { ...state.ticket }, error: null }
      }
      return { data: null, error: null }
    }
    chain.single = () => finishInsert()
    chain.update = (row: Record<string, unknown>) => {
      pendingUpdate = row
      return chain
    }
    chain.insert = (row: Record<string, unknown> | Record<string, unknown>[]) => {
      pendingInsert = Array.isArray(row) ? (row[0] ?? null) : row
      return chain
    }
    chain.then = (
      resolve: (v: unknown) => unknown,
      reject?: (e: unknown) => unknown,
    ) => {
      if (pendingUpdate) return finishUpdate().then(resolve, reject)
      if (pendingInsert) return finishInsert().then(resolve, reject)
      return Promise.resolve({ data: null, error: null }).then(resolve, reject)
    }
    return chain
  }

  return { from } as never
}

function baseRaceState(): RaceState {
  return {
    invoice: {
      id: "inv-race",
      landlord_id: "ll-1",
      maintenance_request_id: "tix-1",
      vendor_id: "ven-1",
      total_cost: 200,
      labor_cost: 200,
      material_cost: 0,
      tax_amount: 0,
      status: "submitted",
      invoice_number: "RACE-1",
      metadata: {},
    },
    scope: {
      id: "tix-1",
      landlord_id: "ll-1",
      assigned_vendor_id: "ven-1",
      unit_id: "unit-1",
      property_id: "prop-1",
      resident_id: "res-1",
    },
    ticket: {
      id: "tix-1",
      spend_status: "pending_approval",
      recognized_spend_amount: null,
      recognized_spend_at: null,
    },
    ledgerInserts: 0,
    spendGraphEvents: 0,
    approveWins: 0,
  }
}

Deno.test("concurrent approve: dashboard × dashboard — one ledger, one spend event", async () => {
  const state = baseRaceState()
  const supabase = mockRaceSupabase(state)

  const [a, b] = await Promise.all([
    approveMaintenanceInvoice(supabase, {
      invoiceId: "inv-race",
      landlordId: "ll-1",
      source: "dashboard",
    }),
    approveMaintenanceInvoice(supabase, {
      invoiceId: "inv-race",
      landlordId: "ll-1",
      source: "dashboard",
    }),
  ])

  const errors = [a, b].filter((r) => "error" in r).map((r) =>
    "error" in r ? r.error : null
  )
  const wins = [a, b].filter((r) => "recognizedAmount" in r)

  assertEquals(wins.length, 1)
  assertEquals(errors.includes("already_approved"), true)
  assertEquals(state.approveWins, 1)
  assertEquals(state.ledgerInserts, 1)
  assertEquals(state.spendGraphEvents >= 1, true)
  assertEquals(String(state.invoice.status), "approved")
})

Deno.test("concurrent approve: dashboard × SMS — one ledger, loser already_approved", async () => {
  const state = baseRaceState()
  const supabase = mockRaceSupabase(state)

  const [dash, sms] = await Promise.all([
    approveMaintenanceInvoice(supabase, {
      invoiceId: "inv-race",
      landlordId: "ll-1",
      source: "dashboard",
    }),
    approveMaintenanceInvoice(supabase, {
      invoiceId: "inv-race",
      landlordId: "ll-1",
      source: "automation",
    }),
  ])

  const results = [dash, sms]
  const wins = results.filter((r) => "recognizedAmount" in r)
  const losers = results.filter((r) =>
    "error" in r && r.error === "already_approved"
  )

  assertEquals(wins.length, 1)
  assertEquals(losers.length, 1)
  assertEquals(state.ledgerInserts, 1)
  assertEquals(String(state.invoice.status), "approved")
})
