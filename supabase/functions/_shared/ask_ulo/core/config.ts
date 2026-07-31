/**
 * Ask Ulo runtime config (models, feature flags, demo geo).
 */

/** Approximate coords for demo portfolio addresses (Street View). */
export const DEMO_GEO: Record<string, { lat: number; lng: number }> = {
  "812 Oakwood Ave, Portland, OR 97214": { lat: 45.5152, lng: -122.6486 },
  "220 Pine Ridge Dr, Portland, OR 97217": { lat: 45.582, lng: -122.678 },
  "45 Cedar Court Ln, Beaverton, OR 97005": { lat: 45.487, lng: -122.803 },
  "901 Maple Heights Blvd, Hillsboro, OR 97124": { lat: 45.5229, lng: -122.9898 },
  "12 Birch Tower Way, Portland, OR 97209": { lat: 45.5308, lng: -122.682 },
  "330 Willow Park Rd, Gresham, OR 97030": { lat: 45.498, lng: -122.43 },
}

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
