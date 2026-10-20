// Renders the digest for the 20 tickets from the 2026-10-19 email.
// Addresses/units are SAMPLE values (the old email didn't include them).
// Run: npx tsx scripts/previewAdminVendorDigest.ts [outDir]
import { writeFileSync } from "node:fs"
import { join } from "node:path"
import { buildAdminVendorDigest, type StaleVendorTicket } from "../supabase/functions/_shared/adminVendorDigest.ts"

const now = new Date("2026-10-19T13:00:00-04:00")
const ago = (h: number) => new Date(now.getTime() - h * 36e5).toISOString()

const A = { propertyId: "p1", propertyAddress: "(sample) 112 Oak St", unit: "Unit B" }
const B = { propertyId: "p2", propertyAddress: "(sample) 48 Elm Ave", unit: null }
const C = { propertyId: "p3", propertyAddress: "(sample) 905 Pine Rd", unit: "Apt 3" }
const D = { propertyId: "p4", propertyAddress: "(sample) 17 Maple Dr", unit: null }
const E = { propertyId: "p5", propertyAddress: "(sample) 230 Cedar Ln", unit: "Unit 2" }
const F = { propertyId: "p6", propertyAddress: "(sample) 61 Birch Ct", unit: null }

const raw: Array<[string, string, string, number, object]> = [
  ["WO-E6F7", "Ganaia Swinton", "Hello. My bathroom sink is leaking bad. The wood of the bottom drawer of the vanity has soaked and broke. And a metal pipe under the sink is rusted.", 416, A],
  ["WO-F412", "Mark Henry", "Pest issue", 384, C],
  ["WO-D154", "Resident", "HQS fail: Kitchen - Stove or Range with Oven", 344, B],
  ["WO-8799", "Resident", "HQS fail: Other (Center, Center, Floor: 0) - Wall Condition", 344, B],
  ["WO-B8C6", "Resident", "HQS fail: Building Exterior - Condition of Stairs, Rails, and Porches", 344, B],
  ["WO-4052", "Resident", "HQS fail: General Health and Safety - Garbage and Debris", 344, B],
  ["WO-5E0A", "Resident", "HQS fail: Living Room - Ceiling Condition", 344, B],
  ["WO-96F8", "Resident", "HQS fail: Living Room - Ceiling Condition", 344, B],
  ["WO-B7EF", "Resident", "HQS fail: Deteriorated Bathtub-(Re-Glaze)", 344, B],
  ["WO-C3D6", "Resident", "HQS fail: Bedroom (Center, Center, Floor: 2) - Smoke Detectors", 344, B],
  ["WO-BE1A", "Resident", "HQS fail: Building Exterior - Condition of Exterior Surfaces", 344, B],
  ["WO-8913", "Resident", "HQS fail: Bedroom (Left, Front, Floor: 2) - Security", 344, B],
  ["WO-38DF", "Resident", "HQS fail: Heating and Plumbing - Plumbing", 344, B],
  ["WO-0A8B", "Resident", "HQS fail: Discharge Line Missing", 344, B],
  ["WO-C1E9", "Takeira Chester", "Wall and ceiling paint, door, and 2 patches", 344, D],
  ["WO-C2C7", "Shahita Sanders", "Appliance issue", 344, E],
  ["WO-C2FF", "Kenniesa Crews", "Electrical issue", 314, F],
  ["WO-5FA6", "Takeira Chester", "Hi and thank you I was trying to see if an exterminator can come out to spray the property", 313, D],
  ["WO-782A", "Mark Henry", "Pest control — exterminator requested", 286, C],
  ["WO-605F", "Kenniesa Crews", "Appliance issue", 278, F],
]

const rows: StaleVendorTicket[] = raw.map(([displayId, residentName, description, hours, place], i) => ({
  id: `id-${i}`,
  displayId,
  landlordName: "KendoProperties",
  residentName,
  description,
  createdAt: ago(hours),
  ...(place as object),
}))

const digest = buildAdminVendorDigest(rows, {
  now,
  ticketUrl: (id) => `https://www.ulohome.io/admin/requests?q=${id}`,
  assignUrl: (id) => `https://www.ulohome.io/admin/requests?q=${id}&action=assign-vendor`,
})!

const out = process.argv[2] ?? "."
writeFileSync(join(out, "digest-preview.html"), digest.html)
writeFileSync(join(out, "digest-preview.txt"), `Subject: ${digest.subject}\n\n${digest.text}`)
console.log(`Subject: ${digest.subject}\n\n${digest.text}`)
