import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts"
import {
  mapRoboflowClassToHint,
  mergeHintCategory,
} from "./roboflowPreclassify.ts"

Deno.test("mapRoboflowClassToHint — boiler before heater", () => {
  assertEquals(mapRoboflowClassToHint("gas-boiler"), "boiler")
  assertEquals(mapRoboflowClassToHint("Boiler"), "boiler")
  assertEquals(mapRoboflowClassToHint("combi boiler"), "boiler")
})

Deno.test("mapRoboflowClassToHint — water heater / HVAC / roof / appliance", () => {
  assertEquals(mapRoboflowClassToHint("water_heater"), "water_heater")
  assertEquals(mapRoboflowClassToHint("tankless"), "water_heater")
  assertEquals(mapRoboflowClassToHint("furnace"), "hvac")
  assertEquals(mapRoboflowClassToHint("heat-pump"), "hvac")
  assertEquals(mapRoboflowClassToHint("asphalt-shingles"), "roof")
  assertEquals(mapRoboflowClassToHint("refrigerator"), "appliance")
  assertEquals(mapRoboflowClassToHint("unknown-widget"), null)
})

Deno.test("mergeHintCategory — user hint wins over Roboflow", () => {
  assertEquals(
    mergeHintCategory("hvac", {
      hintCategory: "boiler",
      confidence: 0.9,
      topClass: "boiler",
      predictions: [],
      latencyMs: 1,
      modelId: "x/1",
      note: "n",
    }),
    "hvac",
  )
  assertEquals(
    mergeHintCategory(null, {
      hintCategory: "boiler",
      confidence: 0.9,
      topClass: "boiler",
      predictions: [],
      latencyMs: 1,
      modelId: "x/1",
      note: "n",
    }),
    "boiler",
  )
  assertEquals(mergeHintCategory("", null), null)
})
