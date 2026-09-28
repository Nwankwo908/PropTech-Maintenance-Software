#!/usr/bin/env node
/**
 * Compare each Edge Function's current import-graph hash with the hash recorded
 * at its last deploy in public.edge_function_deploys. Lists stale functions.
 *
 * Usage: npm run deploy:status
 * Env: SUPABASE_ACCESS_TOKEN (or ~/.supabase/access-token), SUPABASE_PROJECT_REF
 */
import { readFileSync, existsSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { hashAllFunctions, hashImportGraph } from "./edge-function-import-graph.mjs"

const PROJECT_REF = process.env.SUPABASE_PROJECT_REF || "mzpqwuizhiaczxcnmxbt"

function loadAccessToken() {
  if (process.env.SUPABASE_ACCESS_TOKEN?.trim()) {
    return process.env.SUPABASE_ACCESS_TOKEN.trim()
  }
  const p = join(homedir(), ".supabase", "access-token")
  if (existsSync(p)) return readFileSync(p, "utf8").trim()
  throw new Error("Missing SUPABASE_ACCESS_TOKEN / ~/.supabase/access-token")
}

async function sqlQuery(token, query) {
  const res = await fetch(
    `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query }),
    },
  )
  const text = await res.text()
  if (!res.ok) {
    throw new Error(`DB query failed (${res.status}): ${text.slice(0, 400)}`)
  }
  return JSON.parse(text)
}

async function loadLastDeploys(token) {
  try {
    const rows = await sqlQuery(
      token,
      `select distinct on (function_name)
         function_name, git_sha, import_graph_hash, deployed_at
       from public.edge_function_deploys
       order by function_name, deployed_at desc`,
    )
    const map = new Map()
    for (const row of rows ?? []) {
      map.set(String(row.function_name), {
        gitSha: String(row.git_sha),
        hash: String(row.import_graph_hash),
        deployedAt: String(row.deployed_at),
      })
    }
    return map
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (msg.includes("edge_function_deploys") || msg.includes("does not exist")) {
      return new Map()
    }
    throw e
  }
}

async function main() {
  const token = loadAccessToken()
  const last = await loadLastDeploys(token)
  const current = hashAllFunctions()

  const stale = []
  const currentOk = []
  const unknown = []
  const errors = []

  for (const row of current) {
    if (!row.hash) {
      errors.push({ function: row.functionName, error: row.error })
      continue
    }
    const prev = last.get(row.functionName)
    if (!prev) {
      unknown.push({
        function: row.functionName,
        currentHash: row.hash.slice(0, 12),
        fileCount: row.fileCount,
      })
      continue
    }
    if (prev.hash !== row.hash) {
      stale.push({
        function: row.functionName,
        deployedSha: prev.gitSha,
        deployedHash: prev.hash.slice(0, 12),
        currentHash: row.hash.slice(0, 12),
        deployedAt: prev.deployedAt,
        fileCount: row.fileCount,
      })
    } else {
      currentOk.push({
        function: row.functionName,
        deployedSha: prev.gitSha,
        hash: prev.hash.slice(0, 12),
        deployedAt: prev.deployedAt,
      })
    }
  }

  const report = {
    projectRef: PROJECT_REF,
    staleCount: stale.length,
    neverDeployedCount: unknown.length,
    currentCount: currentOk.length,
    stale,
    neverRecorded: unknown,
    current: currentOk,
    errors,
  }

  console.log(JSON.stringify(report, null, 2))

  if (process.argv.includes("--stale-names-only")) {
    for (const s of stale) console.error(s.function)
  }

  // Exit 0 even when stale — status command, not a gate.
  if (stale.length || unknown.length) {
    console.error(
      `\ndeploy:status — ${stale.length} stale, ${unknown.length} never recorded`,
    )
  } else {
    console.error("\ndeploy:status — all recorded functions match")
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
