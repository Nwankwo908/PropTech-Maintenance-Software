/// <reference lib="deno.ns" />

/**
 * Operational eval: tenant text → classifyMaintenanceRequest → ClassificationResult.
 * Scores vendor trade, urgency, clarification, and landlord category separately.
 */
import { classifyMaintenanceRequest } from "./pipeline.ts"
import {
  scoreClassificationEvalCase,
  summarizeClassificationEval,
} from "../../../../shared/maintenance/classificationEval.ts"
import { CLASSIFICATION_EVAL_SET } from "../../../../shared/maintenance/classificationEvalSet.ts"
import { matchingTradeForVendorSearch } from "../../../../shared/maintenance/vendorTrades.ts"

const MIN_OVERALL_PCT = 90
const MIN_TRADE_PCT = 90
const MIN_URGENCY_PCT = 90

Deno.test("operational classification eval (pipeline, not landlord JSON)", async () => {
  const results = []
  for (const testCase of CLASSIFICATION_EVAL_SET) {
    const classified = await classifyMaintenanceRequest({
      rawDescription: testCase.input,
      skipLlm: true,
      skipEmbeddings: true,
      outdoorTempF: testCase.context?.outdoorTempF,
      durationHours: testCase.context?.durationHours,
    })
    results.push(scoreClassificationEvalCase(classified, testCase))
  }

  const summary = summarizeClassificationEval(results)

  console.log(
    [
      `Vendor Trade Accuracy: ${summary.vendorTradePct.toFixed(1)}%`,
      `Urgency Accuracy: ${summary.urgencyPct.toFixed(1)}%`,
      `Clarification Accuracy: ${summary.clarificationPct.toFixed(1)}%`,
      `Landlord Category Accuracy: ${summary.landlordCategoryPct.toFixed(1)}%`,
      `Overall: ${summary.overallPct.toFixed(1)}% (${summary.overallCorrect}/${summary.total})`,
    ].join("\n"),
  )

  if (summary.misses.length > 0) {
    console.log(
      summary.misses.map((r) => ({
        id: r.id,
        input: r.input,
        dims: r.dimensions,
        expected: r.expected,
        got: r.got,
      })),
    )
  }

  if (summary.safetyFails.length > 0) {
    const lines = summary.safetyFails.map((r) =>
      `SAFETY ${r.id}: expected urgency=${r.expected.urgencyBand}` +
      `${r.expected.emergencyType ? ` emergencyType=${r.expected.emergencyType}` : ""}` +
      ` got urgency=${r.got.urgencyBand} emergencyType=${r.got.emergencyType} trade=${r.got.vendorTrade}`
    )
    throw new Error(`Safety-critical eval misses:\n${lines.join("\n")}`)
  }

  if (summary.vendorTradePct < MIN_TRADE_PCT) {
    throw new Error(
      `EVAL FAILED — vendor trade ${summary.vendorTradePct.toFixed(1)}% (need ${MIN_TRADE_PCT}%+). Landlord category must not hide this.`,
    )
  }
  if (summary.urgencyPct < MIN_URGENCY_PCT) {
    throw new Error(
      `EVAL FAILED — urgency ${summary.urgencyPct.toFixed(1)}% (need ${MIN_URGENCY_PCT}%+)`,
    )
  }
  if (summary.overallPct < MIN_OVERALL_PCT) {
    throw new Error(
      `EVAL FAILED — overall ${summary.overallPct.toFixed(1)}% (need ${MIN_OVERALL_PCT}%+)`,
    )
  }
})

Deno.test("eval gold never uses landlord STRUCTURAL as a matching trade", () => {
  for (const testCase of CLASSIFICATION_EVAL_SET) {
    const trade = testCase.expected.vendorTrade
    if (trade === "structural") {
      throw new Error(`${testCase.id}: STRUCTURAL is not a vendor search trade`)
    }
    if (trade === "other" || trade === "general") continue
    if (matchingTradeForVendorSearch(trade) !== trade) {
      throw new Error(`${testCase.id}: expected vendorTrade ${trade} is not a matching trade`)
    }
  }
})
