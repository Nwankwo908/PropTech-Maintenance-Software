/// <reference lib="deno.ns" />

import {
  celsiusToFahrenheit,
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
