/**
 * Ambient types for Supabase Edge (Deno) so workspace tsserver can check these
 * files without the Deno VS Code extension.
 */

declare namespace Deno {
  namespace env {
    function get(key: string): string | undefined
  }
}

declare module "https://esm.sh/@supabase/supabase-js@2.49.1" {
  export { createClient } from "@supabase/supabase-js"
  export type { SupabaseClient } from "@supabase/supabase-js"
}

declare module "https://deno.land/std/http/server.ts" {
  export function serve(
    handler: (request: Request) => Response | Promise<Response>,
  ): void
}
