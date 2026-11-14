// Dynamic fake query shape only. Production types are checked separately by
// check:backend-types with the actual Supabase SDK, not this test replacement.
import { createClient as fakeClient } from "../routing/sdk_stub.ts"
// deno-lint-ignore no-explicit-any
export type SupabaseClient = any
// deno-lint-ignore no-explicit-any
export function createClient(...args: [string, string, unknown?]): any {
  return fakeClient(...args)
}
