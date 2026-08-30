import { supabase } from '@/lib/supabase'

export function isAuthClockSkewMessage(message: string | null | undefined): boolean {
  const lower = (message ?? '').toLowerCase()
  return (
    lower.includes('issued at future') ||
    lower.includes('token used before') ||
    lower.includes('iat is in the future')
  )
}

export async function fetchVendorScoresForLandlord(landlordId: string): Promise<{
  data: Record<string, unknown>[]
  errorMessage: string | null
}> {
  if (!supabase) return { data: [], errorMessage: null }

  const run = () =>
    supabase!.rpc('get_vendor_scores_for_landlord', { p_landlord_id: landlordId })

  let { data, error } = await run()
  if (error && isAuthClockSkewMessage(error.message)) {
    await supabase.auth.refreshSession()
    await new Promise((resolve) => {
      setTimeout(resolve, 500)
    })
    const retry = await run()
    data = retry.data
    error = retry.error
  }

  if (error) {
    console.warn('[vendorScores] get_vendor_scores_for_landlord', error.message)
    return { data: [], errorMessage: error.message }
  }

  return { data: (data ?? []) as Record<string, unknown>[], errorMessage: null }
}
