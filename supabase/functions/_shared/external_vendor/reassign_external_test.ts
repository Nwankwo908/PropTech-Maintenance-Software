/// <reference lib="deno.ns" />

import { resolveVendorIdForExternalReassign } from "./onboard.ts"

type VendorRow = {
  id: string
  name: string
  landlord_id: string
  active: boolean
  onboarded_from_external?: boolean
  external_discovery?: unknown
  category?: string | null
}

function buildMockSupabase(vendors: VendorRow[]) {
  return {
    from(table: string) {
      if (table !== "vendors") throw new Error(`unexpected table ${table}`)

      const filters: Record<string, unknown> = {}
      const chain = {
        eq(col: string, val: unknown) {
          filters[col] = val
          return chain
        },
        ilike(col: string, val: unknown) {
          filters[`${col}_ilike`] = val
          return {
            limit: (_n: number) => {
              const want = typeof filters.name_ilike === "string"
                ? String(filters.name_ilike).replace(/%/g, "").toLowerCase()
                : ""
              const rows = vendors.filter((v) => {
                if (filters.landlord_id && v.landlord_id !== filters.landlord_id) {
                  return false
                }
                if (filters.active === false) return false
                if (want) return v.name.toLowerCase() === want
                return true
              })
              return Promise.resolve({ data: rows, error: null })
            },
          }
        },
      }

      return {
        select: (_cols: string) => chain,
        insert: (row: Record<string, unknown>) => {
          const created: VendorRow = {
            id: crypto.randomUUID(),
            name: String(row.name),
            landlord_id: String(row.landlord_id),
            active: true,
            onboarded_from_external: row.onboarded_from_external === true,
            external_discovery: row.external_discovery,
            category: row.category == null ? null : String(row.category),
          }
          vendors.push(created)
          return {
            select: (_cols: string) => ({
              single: async () => ({ data: created, error: null }),
            }),
          }
        },
      }
    },
  }
}

Deno.test("resolveVendorIdForExternalReassign creates landlord-scoped vendor", async () => {
  const landlordId = crypto.randomUUID()
  const vendors: VendorRow[] = []
  const supabase = buildMockSupabase(vendors)

  const result = await resolveVendorIdForExternalReassign(
    supabase as unknown as Parameters<typeof resolveVendorIdForExternalReassign>[0],
    landlordId,
    {
      vendorName: "Rapid Plumb Co.",
      sources: ["mock"],
      rating: 4.9,
      reviewCount: 100,
    },
    "plumbing",
  )

  if ("error" in result) throw new Error(result.error)
  if (!result.createdVendor) throw new Error("expected createdVendor=true")
  if (vendors.length !== 1) throw new Error(`expected 1 vendor, got ${vendors.length}`)
  if (vendors[0].landlord_id !== landlordId) throw new Error("expected landlord_id set")
  if (!vendors[0].onboarded_from_external) {
    throw new Error("expected onboarded_from_external=true")
  }
})

Deno.test("resolveVendorIdForExternalReassign reuses existing roster match", async () => {
  const landlordId = crypto.randomUUID()
  const existingId = crypto.randomUUID()
  const vendors: VendorRow[] = [
    {
      id: existingId,
      name: "Metro Plumbing",
      landlord_id: landlordId,
      active: true,
    },
  ]
  const supabase = buildMockSupabase(vendors)

  const result = await resolveVendorIdForExternalReassign(
    supabase as unknown as Parameters<typeof resolveVendorIdForExternalReassign>[0],
    landlordId,
    { vendorName: "Metro Plumbing", sources: ["google"] },
    "plumbing",
  )

  if ("error" in result) throw new Error(result.error)
  if (result.createdVendor) throw new Error("expected createdVendor=false")
  if (result.vendorId !== existingId) throw new Error("expected existing vendor id")
  if (vendors.length !== 1) throw new Error("should not insert duplicate vendor")
})
