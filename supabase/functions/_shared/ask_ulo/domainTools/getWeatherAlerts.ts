/**
 * getWeatherAlerts — domain tool wrapping weatherAlertsLookup (NWS).
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import {
  isWeatherAlertsQuestion,
  weatherAlertsLookup,
  type WeatherAlertsResult,
} from "../weatherAlertsLookup.ts"

export { isWeatherAlertsQuestion }

export type GetWeatherAlertsParams = {
  organizationId: string
}

export type GetWeatherAlertsResult = WeatherAlertsResult & {
  toolId: "get_weather_alerts"
  params: Record<string, unknown>
}

export async function getWeatherAlerts(
  supabase: SupabaseClient,
  params: GetWeatherAlertsParams,
): Promise<GetWeatherAlertsResult> {
  const base = await weatherAlertsLookup(supabase, {
    landlordId: params.organizationId,
  })
  return {
    ...base,
    toolId: "get_weather_alerts",
    params: {
      organizationId: params.organizationId,
      statesQueried: base.statesQueried,
      alertCount: base.alerts.length,
      propertyCount: base.propertiesScoped.length,
    },
  }
}
