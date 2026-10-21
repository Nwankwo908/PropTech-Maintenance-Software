/// <reference lib="deno.ns" />
/**
 * Pest jobs must never soft-offer, assign, or recommend a generalist.
 * Covers resolveVendorAssignmentDecision (initial dispatch / reassignment pick)
 * and loadAlternativeVendorCandidates (fallback recommendations).
 */
import {
  assertEquals,
  assertExists,
} from "https://deno.land/std@0.224.0/assert/mod.ts"
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import {
  pickVendorForAssignment,
  resolveVendorAssignmentDecision,
  type VendorAssignmentRow,
} from "./vendor_assignment.ts"
import { loadAlternativeVendorCandidates } from "./recommend_vendor_alternatives.ts"

type VendorSeed = Partial<VendorAssignmentRow> & {
  id: string
  name: string
  category: string | null
}

type VerifSeed = {
  vendor_id: string
  status: string
  availability: string
  service_area: { states?: string[] } | null
  license_state: string | null
  updated_at: string
}

function baseVendor(seed: VendorSeed): VendorAssignmentRow {
  return {
    id: seed.id,
    name: seed.name,
    email: seed.email ?? null,
    phone: seed.phone ?? "+15555550100",
    notification_channel: seed.notification_channel ?? "sms",
    active: seed.active ?? true,
    category: seed.category,
    portal_api_key: seed.portal_api_key ?? "portal-key",
    last_assigned_at: seed.last_assigned_at ?? null,
    created_at: seed.created_at ?? "2026-01-01T00:00:00.000Z",
    roster_status: seed.roster_status ?? null,
    weekly_job_cap: seed.weekly_job_cap ?? null,
    preferred_emergency: seed.preferred_emergency ?? false,
    onboarded_from_external: seed.onboarded_from_external ?? false,
    onboarding_overridden_at: seed.onboarding_overridden_at ?? null,
    state: seed.state ?? "NJ",
  }
}

function mockAssignmentSupabase(state: {
  vendors: VendorAssignmentRow[]
  verifications: VerifSeed[]
  outreach: Array<{ table: string; patch?: Record<string, unknown> }>
}) {
  const from = (table: string) => {
    const filters: Array<{ kind: string; col: string; val: unknown }> = []
    let pendingUpdate: Record<string, unknown> | null = null
    const api: Record<string, unknown> = {}
    const chain = () => api

    api.select = () => chain()
    api.eq = (col: string, val: unknown) => {
      filters.push({ kind: "eq", col, val })
      return chain()
    }
    api.in = (col: string, val: unknown) => {
      filters.push({ kind: "in", col, val })
      return chain()
    }
    api.not = () => chain()
    api.gte = () => chain()
    api.order = () => chain()
    api.limit = () => chain()
    api.update = (row: Record<string, unknown>) => {
      pendingUpdate = row
      return chain()
    }
    api.maybeSingle = async () => ({ data: null, error: null })

    const applyVendorFilters = (rows: VendorAssignmentRow[]) => {
      let out = rows
      for (const f of filters) {
        if (f.kind === "eq" && f.col === "active") {
          out = out.filter((v) => v.active === f.val)
        }
        if (f.kind === "eq" && f.col === "landlord_id") {
          // Seeded rows are all for the test landlord; keep as-is.
        }
      }
      return out
    }

    const thenable = {
      then: (resolve: (v: unknown) => void) => {
        if (pendingUpdate) {
          state.outreach.push({ table, patch: pendingUpdate })
          pendingUpdate = null
          resolve({ data: null, error: null })
          return
        }

        if (table === "vendors") {
          resolve({ data: applyVendorFilters(state.vendors), error: null })
          return
        }
        if (table === "vendor_verifications") {
          let rows = state.verifications
          const inFilter = filters.find((f) => f.kind === "in" && f.col === "vendor_id")
          if (inFilter && Array.isArray(inFilter.val)) {
            const ids = new Set(inFilter.val.map(String))
            rows = rows.filter((r) => ids.has(r.vendor_id))
          }
          resolve({ data: rows, error: null })
          return
        }
        if (table === "maintenance_requests") {
          resolve({ data: [], error: null })
          return
        }
        resolve({ data: [], error: null })
      },
    }
    Object.assign(api, thenable)
    return api
  }

  return { from } as unknown as SupabaseClient
}

const LANDLORD = "landlord-pest-test"

function verified(vendorId: string): VerifSeed {
  return {
    vendor_id: vendorId,
    status: "verified",
    availability: "active",
    service_area: { states: ["NJ"] },
    license_state: "NJ",
    updated_at: "2026-10-01T00:00:00.000Z",
  }
}

Deno.test("pest job with only generalists → no assignment decision / no outreach candidates", async () => {
  const generalists = [
    baseVendor({ id: "gen-1", name: "Handy Mike", category: "general" }),
    baseVendor({ id: "gen-2", name: "Household Help", category: "handyman" }),
    baseVendor({ id: "gen-3", name: "Blank Trade Co", category: null }),
    baseVendor({ id: "gen-4", name: "Empty Trade Co", category: "" }),
    baseVendor({ id: "plumb-1", name: "ABC Plumbing", category: "plumbing" }),
  ]
  const state = {
    vendors: generalists,
    verifications: generalists.map((v) => verified(v.id)),
    outreach: [] as Array<{ table: string; patch?: Record<string, unknown> }>,
  }
  const supabase = mockAssignmentSupabase(state)

  const decision = await resolveVendorAssignmentDecision(supabase, {
    issueCategory: "pest_control",
    excludeVendorIds: [],
    landlordId: LANDLORD,
    jobState: "NJ",
  })
  assertEquals(decision.kind, "none")

  const picked = await pickVendorForAssignment(supabase, {
    issueCategory: "pest",
    excludeVendorIds: [],
    landlordId: LANDLORD,
    jobState: "NJ",
  })
  assertEquals(picked, null)

  const alts = await loadAlternativeVendorCandidates(supabase, {
    assigned_vendor_id: null,
    issue_category: "pest_control",
    landlord_id: LANDLORD,
  }, { marketplacePreference: "include_imported" })
  assertEquals(alts, [])
  assertEquals(state.outreach.length, 0)
})

Deno.test("pest job with explicit pest specialist → landlord_choice (no generalist filler)", async () => {
  const pest = baseVendor({
    id: "pest-1",
    name: "Dan Conard Pest Control",
    category: "pest_control",
  })
  const generalist = baseVendor({
    id: "gen-1",
    name: "Handy Mike",
    category: "general",
    preferred_emergency: true,
  })
  const state = {
    vendors: [pest, generalist],
    verifications: [verified(pest.id), verified(generalist.id)],
    outreach: [] as Array<{ table: string; patch?: Record<string, unknown> }>,
  }
  const supabase = mockAssignmentSupabase(state)

  const decision = await resolveVendorAssignmentDecision(supabase, {
    issueCategory: "pest",
    excludeVendorIds: [],
    landlordId: LANDLORD,
    jobState: "NJ",
  })
  assertEquals(decision.kind, "landlord_choice")
  if (decision.kind !== "landlord_choice") return
  assertEquals(decision.options.length, 1)
  assertEquals(decision.options[0]?.vendor.id, "pest-1")
  assertEquals(decision.options[0]?.role, "specialist")

  const alts = await loadAlternativeVendorCandidates(supabase, {
    assigned_vendor_id: null,
    issue_category: "pest_control",
    landlord_id: LANDLORD,
  }, { marketplacePreference: "include_imported" })
  assertEquals(alts.length, 1)
  assertEquals(alts[0]?.id, "pest-1")
})

Deno.test("non-pest job still offers generalist when no specialist matches", async () => {
  const generalist = baseVendor({
    id: "gen-1",
    name: "Handy Mike",
    category: "general",
  })
  const state = {
    vendors: [generalist],
    verifications: [verified(generalist.id)],
    outreach: [] as Array<{ table: string; patch?: Record<string, unknown> }>,
  }
  const supabase = mockAssignmentSupabase(state)

  const decision = await resolveVendorAssignmentDecision(supabase, {
    issueCategory: "plumbing",
    excludeVendorIds: [],
    landlordId: LANDLORD,
    jobState: "NJ",
  })
  assertEquals(decision.kind, "landlord_choice")
  if (decision.kind !== "landlord_choice") return
  assertExists(decision.options[0])
  assertEquals(decision.options[0].vendor.id, "gen-1")
  assertEquals(decision.options[0].role, "generalist")
})
