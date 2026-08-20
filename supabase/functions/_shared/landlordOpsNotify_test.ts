/// <reference lib="deno.ns" />
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts"
import {
  filterVendorEmailsFromOpsRecipients,
  normalizeOpsEmail,
  parseOpsEmailList,
  resolveLandlordOpsEmails,
} from "./landlordOpsNotify.ts"

Deno.test("normalizeOpsEmail lowercases and rejects junk", () => {
  assertEquals(normalizeOpsEmail("  Ops@Example.com "), "ops@example.com")
  assertEquals(normalizeOpsEmail("not-an-email"), null)
  assertEquals(normalizeOpsEmail(""), null)
})

Deno.test("parseOpsEmailList splits mixed separators", () => {
  assertEquals(
    parseOpsEmailList("a@ulo.io, b@ulo.io;c@ulo.io  d@ulo.io"),
    ["a@ulo.io", "b@ulo.io", "c@ulo.io", "d@ulo.io"],
  )
})

Deno.test("filterVendorEmailsFromOpsRecipients drops vendor addresses", () => {
  const { allowed, blocked } = filterVendorEmailsFromOpsRecipients(
    [
      "ops@ulohome.io",
      "Vendor@Acme.com",
      "landlord@property.com",
      "vendor@acme.com", // dup after normalize
    ],
    ["vendor@acme.com", "other@vendor.com"],
  )
  assertEquals(allowed, ["ops@ulohome.io", "landlord@property.com"])
  assertEquals(blocked, ["vendor@acme.com"])
})

Deno.test("filter never leaves a vendor on landlord approve list", () => {
  const { allowed } = filterVendorEmailsFromOpsRecipients(
    ["plumber@flex.com", "emeka@ulohome.io"],
    ["plumber@flex.com"],
  )
  assertEquals(allowed.includes("plumber@flex.com"), false)
  assertEquals(allowed, ["emeka@ulohome.io"])
})

function mockLandlordOpsSupabase(params: {
  landlordEmail: string | null
  vendorEmails?: string[]
}) {
  return {
    from(table: string) {
      if (table === "landlords") {
        return {
          select() {
            return {
              eq() {
                return {
                  async maybeSingle() {
                    return {
                      data: params.landlordEmail
                        ? { email: params.landlordEmail }
                        : null,
                      error: null,
                    }
                  },
                }
              },
            }
          },
        }
      }
      if (table === "vendors") {
        return {
          select() {
            return {
              eq() {
                return {
                  not() {
                    return {
                      async limit() {
                        return {
                          data: (params.vendorEmails ?? []).map((email) => ({
                            email,
                          })),
                          error: null,
                        }
                      },
                    }
                  },
                }
              },
            }
          },
        }
      }
      throw new Error(`unexpected table ${table}`)
    },
  }
}

Deno.test("accountHolderOnly skips staff env notify list", async () => {
  const supabase = mockLandlordOpsSupabase({
    landlordEmail: "owner@alpha.com",
    vendorEmails: [],
  })
  const { emails } = await resolveLandlordOpsEmails(
    supabase as never,
    "landlord-1",
    {
      accountHolderOnly: true,
      envEmails: ["osi@ulohome.io", "emeka@ulohome.io"],
    },
  )
  assertEquals(emails, ["owner@alpha.com"])
})

Deno.test("default resolve still includes env notify emails", async () => {
  const supabase = mockLandlordOpsSupabase({
    landlordEmail: "owner@alpha.com",
    vendorEmails: [],
  })
  const { emails } = await resolveLandlordOpsEmails(
    supabase as never,
    "landlord-1",
    {
      envEmails: ["osi@ulohome.io"],
    },
  )
  assertEquals(emails, ["osi@ulohome.io", "owner@alpha.com"])
})
