/**
 * Ambient types for Supabase Edge (Deno) so workspace tsserver can check these
 * files without the Deno VS Code extension.
 *
 * Do not use `/// <reference lib="deno.ns" />` — that lib only ships with Deno's
 * TypeScript distribution and triggers TS2726 under the workspace compiler.
 */

declare namespace Deno {
  namespace env {
    function get(key: string): string | undefined
  }

  function test(
    name: string,
    fn: () => void | Promise<void>,
  ): void
  function test(
    name: string,
    options: Record<string, unknown>,
    fn: () => void | Promise<void>,
  ): void
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

declare module "https://deno.land/std@0.224.0/assert/mod.ts" {
  export function assert(expr: unknown, msg?: string): asserts expr
  export function assertEquals(
    actual: unknown,
    expected: unknown,
    msg?: string,
  ): void
  export function assertExists(
    actual: unknown,
    msg?: string,
  ): asserts actual is NonNullable<typeof actual>
  export function assertStringIncludes(
    actual: string,
    expected: string,
    msg?: string,
  ): void
  export function assertRejects(
    fn: () => Promise<unknown>,
    errorClassOrMsg?: unknown,
    msgIncludesOrMsg?: string,
    msg?: string,
  ): Promise<Error>
}
