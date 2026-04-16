import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const supabase: SupabaseClient | null =
  supabaseUrl && supabaseAnonKey
    ? createClient(supabaseUrl, supabaseAnonKey)
    : null

if (!supabase) {
  console.warn(
    '[supabase] Missing client env: save `.env` to disk with VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY, then restart `npm run dev`.',
  )
}
