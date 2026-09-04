/// <reference lib="deno.ns" />

import {
  parseRentCastProperty,
  parseRentCastRentAvm,
  parseRentCastValueAvm,
} from "./rentcastFill.ts"

Deno.test("parseRentCastProperty reads year and coordinates", () => {
  const p = parseRentCastProperty([{ yearBuilt: 1924, latitude: 40.79, longitude: -74.24 }])
  if (p.yearBuilt !== 1924) throw new Error(String(p.yearBuilt))
  if (p.latitude !== 40.79) throw new Error(String(p.latitude))
})

Deno.test("parseRentCastValueAvm reads price", () => {
  const v = parseRentCastValueAvm({ price: 612000 })
  if (v !== 612000) throw new Error(String(v))
})

Deno.test("parseRentCastRentAvm reads rent ranges", () => {
  const r = parseRentCastRentAvm({ rent: 2850, rentRangeLow: 2500, rentRangeHigh: 3200 })
  if (r.rent !== 2850) throw new Error(JSON.stringify(r))
})
