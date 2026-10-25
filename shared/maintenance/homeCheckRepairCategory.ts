import { inferTradeFromText } from './deterministicRules.ts'

/**
 * Trade for a Home Check finding that needs a repair.
 * Never "other" or the internal home_check_warning label.
 */
export function homeCheckFollowUpCategory(text: string | null | undefined): string {
  const raw = (text ?? '').trim()
  const inferred = raw ? inferTradeFromText(raw) : null
  if (inferred && inferred !== 'other') return inferred
  const hay = raw.toLowerCase()
  if (/gas|smoke|scorch|spark|electric/.test(hay)) return 'electrical'
  if (/leak|water|plumb|drain|flood/.test(hay)) return 'plumbing'
  if (/heat|furnace|hvac|boiler|cool|\bac\b/.test(hay)) return 'hvac'
  return 'general'
}
