/// <reference lib="deno.ns" />

import { fetchHomeDataFromProvider } from "./providers.ts"

Deno.test("non-RentCast providers do not write vendor columns; they skip ingest", async () => {
  const attom = await fetchHomeDataFromProvider({ provider: "attom", address: "1 Main St, Newark, NJ 07102" })
  if (attom.status !== "unsupported") throw new Error(attom.status)
  const manual = await fetchHomeDataFromProvider({ provider: "manual", address: "1 Main St, Newark, NJ 07102" })
  if (manual.status !== "unsupported") throw new Error(manual.status)
})
