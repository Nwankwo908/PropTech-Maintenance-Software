/// <reference lib="deno.ns" />

import {
  celsiusToFahrenheit,
  parseCensusCoordinates,
  parseNwsHourlyTempF,
  parseNwsObservationTempF,
  parseNwsPointUrls,
} from "./propertyOutdoorTemp.ts"

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
