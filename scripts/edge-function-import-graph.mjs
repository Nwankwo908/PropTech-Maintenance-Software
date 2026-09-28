#!/usr/bin/env node
/**
 * Resolve the TypeScript import graph for a Supabase Edge Function and hash it.
 * Used by deploy-edge-function.sh (record) and deploy-status.mjs (compare).
 */
import { createHash } from "node:crypto"
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs"
import { dirname, join, relative, resolve, sep } from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const FUNCTIONS_DIR = join(ROOT, "supabase", "functions")

const IMPORT_RE =
  /(?:from|import)\s+["'](\.[^"']+)["']|export\s+\*\s+from\s+["'](\.[^"']+)["']/g

function listFunctionSlugs() {
  return readdirSync(FUNCTIONS_DIR)
    .filter((name) => {
      if (name.startsWith("_") || name.startsWith(".")) return false
      const p = join(FUNCTIONS_DIR, name)
      return statSync(p).isDirectory() && existsSync(join(p, "index.ts"))
    })
    .sort()
}

function resolveImport(fromFile, spec) {
  const base = resolve(dirname(fromFile), spec)
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.js`,
    `${base}.mjs`,
    join(base, "index.ts"),
  ]
  for (const c of candidates) {
    if (existsSync(c) && statSync(c).isFile()) return c
  }
  return null
}

/** Absolute paths reachable from the function entry, under the repo root. */
export function collectImportGraph(functionName) {
  const entry = join(FUNCTIONS_DIR, functionName, "index.ts")
  if (!existsSync(entry)) {
    throw new Error(`No entry for function: ${functionName}`)
  }
  const seen = new Set()
  const ordered = []
  const queue = [entry]

  while (queue.length) {
    const file = queue.shift()
    if (!file || seen.has(file)) continue
    seen.add(file)
    ordered.push(file)
    let src
    try {
      src = readFileSync(file, "utf8")
    } catch {
      continue
    }
    IMPORT_RE.lastIndex = 0
    let m
    while ((m = IMPORT_RE.exec(src))) {
      const spec = m[1] || m[2]
      if (!spec) continue
      const resolved = resolveImport(file, spec)
      if (!resolved) continue
      // Stay inside the repo (functions + shared/)
      if (!resolved.startsWith(ROOT + sep)) continue
      if (!seen.has(resolved)) queue.push(resolved)
    }
  }
  return ordered
}

export function hashImportGraph(functionName) {
  const files = collectImportGraph(functionName)
  const hash = createHash("sha256")
  for (const abs of files) {
    const rel = relative(ROOT, abs).split(sep).join("/")
    hash.update(rel)
    hash.update("\0")
    hash.update(readFileSync(abs))
    hash.update("\0")
  }
  return {
    functionName,
    fileCount: files.length,
    files: files.map((f) => relative(ROOT, f).split(sep).join("/")),
    hash: hash.digest("hex"),
  }
}

export function hashAllFunctions() {
  return listFunctionSlugs().map((name) => {
    try {
      return hashImportGraph(name)
    } catch (e) {
      return {
        functionName: name,
        error: e instanceof Error ? e.message : String(e),
        hash: null,
        fileCount: 0,
        files: [],
      }
    }
  })
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("edge-function-import-graph.mjs")) {
  const fn = process.argv[2]
  if (!fn) {
    console.log(JSON.stringify(hashAllFunctions(), null, 2))
  } else {
    console.log(JSON.stringify(hashImportGraph(fn), null, 2))
  }
}
