/// <reference lib="deno.ns" />

import { LIMITED_ALPHA_1_LANDLORD_ID } from "../../../../shared/landlordCapabilities.ts"
import { controlledOutdoorTempF } from "../../../../shared/maintenance/testOutdoorTemp.ts"
import {
  celsiusToFahrenheit,
  lookupOutdoorTempForProperty,
  parseCensusCoordinates,
  parseNwsActiveAlerts,
  parseNwsHourlyForecast,
  parseNwsHourlyTempF,
  parseNwsObservationTempF,
  parseNwsPointUrls,
} from "./propertyOutdoorTemp.ts"
import { evaluateFreezeLevel } from "../../../../shared/weather/freezeRules.ts"

function assertEqual(actual: unknown, expected: unknown, label: string) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
  }
}

Deno.test("census geocode parser reads lat/lon from addressMatches", () => {
  const coords = parseCensusCoordinates({
    result: {
      addressMatches: [{ coordinates: { x: -77.0369, y: 38.9072 } }],
    },
  })
  assertEqual(coords?.lat, 38.9072, "lat")
  assertEqual(coords?.lon, -77.0369, "lon")
})

Deno.test("NWS observation converts Celsius to Fahrenheit", () => {
  assertEqual(celsiusToFahrenheit(0), 32, "freezing")
  const temp = parseNwsObservationTempF({
    properties: {
      temperature: { value: 10, unitCode: "wmoUnit:degC" },
    },
  })
  assertEqual(temp, 50, "10C")
})

Deno.test("NWS hourly forecast uses Fahrenheit periods", () => {
  const temp = parseNwsHourlyTempF({
    properties: {
      periods: [{ temperature: 91, temperatureUnit: "F" }],
    },
  })
  assertEqual(temp, 91, "hourly F")
})

Deno.test("NWS hourly forecast keeps the next 72 hours and wind chill", () => {
  const start = new Date("2026-01-20T18:00:00.000Z")
  const periods = Array.from({ length: 3 }, (_, index) => ({
    startTime: new Date(start.getTime() + index * 60 * 60 * 1000).toISOString(),
    temperature: 19 - index,
    temperatureUnit: "F",
    windChill: index === 2 ? 0 : 10,
  }))
  const points = parseNwsHourlyForecast({ properties: { periods } }, start)
  assertEqual(points.length, 3, "hours")
  assertEqual(points[2]?.windChillF, 0, "chill")
})

Deno.test("NWS active alerts keep the event name", () => {
  const alerts = parseNwsActiveAlerts({
    features: [{ properties: { event: "Hard Freeze Warning", severity: "Severe" } }],
  })
  assertEqual(alerts[0]?.event, "Hard Freeze Warning", "event")
})

Deno.test("a hard freeze warning outranks a mild temperature", () => {
  const level = evaluateFreezeLevel({
    hourly: [{ time: "2026-01-20T18:00:00.000Z", tempF: 50, windChillF: null }],
    alerts: [{ event: "Hard Freeze Warning" }],
    property: {},
    now: new Date("2026-01-20T18:00:00.000Z"),
  })
  assertEqual(level, "hard_freeze", "alert")
})

Deno.test("controlled outdoor temperature applies only to a disposable test landlord", () => {
  const disposable = "d15a0000-0000-4000-8000-000000000001"
  assertEqual(controlledOutdoorTempF(disposable, 95), 95, "disposable")
  assertEqual(controlledOutdoorTempF(LIMITED_ALPHA_1_LANDLORD_ID, 95), null, "limited alpha 1")
  assertEqual(controlledOutdoorTempF("068daf53-07e4-4493-bd7f-6106e3c8c62f", 95), null, "full alpha")
  assertEqual(controlledOutdoorTempF(disposable, 200), null, "out of range")
})

Deno.test("AC lookup uses the stored 95F and does not call the weather service", async () => {
  const disposable = "d15a0000-0000-4000-8000-000000000001"
  const tables: string[] = []
  const supabase = {
    from(table: string) {
      tables.push(table)
      const builder = {
        select() { return builder },
        eq() { return builder },
        maybeSingle: async () => ({ data: { temp_f: 95 }, error: null }),
      }
      return builder
    },
  }
  let fetched = false
  const temp = await lookupOutdoorTempForProperty(
    supabase as never,
    { landlordId: disposable, description: "The AC isn't working." },
    { fetchFn: () => { fetched = true; throw new Error("weather fetch") } },
  )
  assertEqual(temp, 95, "temp")
  assertEqual(fetched, false, "no weather fetch")
  assertEqual(tables.includes("maintenance_test_outdoor_temp"), true, "test table")
  assertEqual(tables.includes("properties"), false, "no property lookup")
})

Deno.test("an existing landlord does not read the test temperature table", async () => {
  const tables: string[] = []
  const supabase = {
    from(table: string) {
      tables.push(table)
      throw new Error(`stop at ${table}`)
    },
  }
  const temp = await lookupOutdoorTempForProperty(
    supabase as never,
    {
      landlordId: LIMITED_ALPHA_1_LANDLORD_ID,
      description: "The AC isn't working.",
    },
    { fetchFn: () => Promise.reject(new Error("weather fetch")) },
  )
  assertEqual(temp, null, "fail closed")
  assertEqual(tables.includes("maintenance_test_outdoor_temp"), false, "no test table")
  assertEqual(tables.length > 0, true, "live property lookup")
})

Deno.test("NWS points expose hourly and station collection URLs", () => {
  const urls = parseNwsPointUrls({
    properties: {
      forecastHourly: "https://api.weather.gov/gridpoints/OKX/33,37/forecast/hourly",
      observationStations: "https://api.weather.gov/gridpoints/OKX/33,37/stations",
    },
  })
  assertEqual(
    urls.forecastHourly,
    "https://api.weather.gov/gridpoints/OKX/33,37/forecast/hourly",
    "hourly",
  )
  assertEqual(
    urls.observations,
    "https://api.weather.gov/gridpoints/OKX/33,37/stations",
    "stations",
  )
})
