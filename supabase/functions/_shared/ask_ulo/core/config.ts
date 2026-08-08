/**
 * Ask Ulo runtime config (models, feature flags).
 */

export function isOpenAiConfigured(): boolean {
  return Boolean(Deno.env.get("OPENAI_API_KEY")?.trim())
}

export type AskUloFeatureFlags = {
  openAiEnabled: boolean
  openAiToolSelect: boolean
}

/** Runtime feature flags for this Ask Ulo turn (env-backed). */
export function getAskUloFeatureFlags(): AskUloFeatureFlags {
  const openAiEnabled = isOpenAiConfigured()
  const flag = (Deno.env.get("ASK_ULO_OPENAI_TOOL_SELECT") ?? "").trim().toLowerCase()
  let openAiToolSelect = openAiEnabled
  if (flag === "0" || flag === "false" || flag === "off") openAiToolSelect = false
  else if (flag === "1" || flag === "true" || flag === "on") openAiToolSelect = true
  return { openAiEnabled, openAiToolSelect }
}
