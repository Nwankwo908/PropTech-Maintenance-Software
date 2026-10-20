/**
 * Preview the live needs-admin vendor digest without emailing or marking sent.
 *
 *   npx tsx scripts/previewNeedsAdminVendorDigestLive.ts
 *
 * Writes digest-preview-live.html + .txt in the cwd (or OUT_DIR=...).
 * Env: SUPABASE_URL / VITE_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */
import { createClient } from "@supabase/supabase-js"
import { writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { sendNeedsAdminVendorDigest } from "../supabase/functions/_shared/needsAdminVendorDigest.ts"

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, "..")

try {
  for (const line of readFileSync(resolve(ROOT, ".env"), "utf8").split("\n")) {
    const t = line.trim()
    if (!t || t.startsWith("#")) continue
    const eq = t.indexOf("=")
    if (eq <= 0) continue
    const k = t.slice(0, eq).trim()
    let v = t.slice(eq + 1).trim()
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1)
    }
    if (process.env[k] == null || process.env[k] === "") process.env[k] = v
  }
} catch {
  // optional
}

async function main() {
  const url =
    process.env.SUPABASE_URL?.trim() || process.env.VITE_SUPABASE_URL?.trim()
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
  if (!url || !key) {
    throw new Error("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY")
  }

  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const result = await sendNeedsAdminVendorDigest(supabase, { dryRun: true })
  if (!result.subject || !result.html || !result.text) {
    console.log(JSON.stringify(result, null, 2))
    return
  }

  const out = process.env.OUT_DIR?.trim() || "."
  writeFileSync(join(out, "digest-preview-live.html"), result.html)
  writeFileSync(
    join(out, "digest-preview-live.txt"),
    `Subject: ${result.subject}\n\n${result.text}`,
  )
  console.log(`Subject: ${result.subject}`)
  console.log(`Tickets: ${result.lineCount} · skipped=${result.skipped}`)
  console.log(`Wrote ${join(out, "digest-preview-live.html")}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
