/**
 * Prepare browser-playable copies for stored SMS videos.
 * Reads the originals, writes sibling mp4 files, and leaves photo_paths unchanged.
 * Does not send SMS.
 *
 *   node --experimental-strip-types scripts/prepare-sms-playback.ts
 */
import { readFileSync } from 'node:fs'
import { execSync, spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(resolve(dirname(fileURLToPath(import.meta.url)), '../package.json'))
const { createClient } = require('@supabase/supabase-js') as typeof import('@supabase/supabase-js')
const { convertStoredSmsVideo } = await import('./lib/runSmsVideoConvert.mjs')
const playback = await import('../shared/sms/videoPlayback.ts')
const media = await import('../shared/sms/media.ts')
const helpers = { ...playback, playbackSiblingPath: media.playbackSiblingPath }

const PROJECT_REF = 'mzpqwuizhiaczxcnmxbt'
const TICKET_ID = '2483e1bd-475c-4c8e-8c92-afec3c9324fc'
const PATHS = [
  'sms/97b9b057-950d-4ce2-97af-e5ebc69cea1e/57c9a129-f6ac-4137-9667-a3db6fcb8827/1793715669808-0.3gp',
  'sms/97b9b057-950d-4ce2-97af-e5ebc69cea1e/a42f19df-5c14-4dcf-93aa-8135fd081f77/1793733659659-0.3gp',
]

try {
  for (const line of readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../.env'), 'utf8').split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq <= 0) continue
    const key = trimmed.slice(0, eq).trim()
    let value = trimmed.slice(eq + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    if (process.env[key] == null || process.env[key] === '') process.env[key] = value
  }
} catch {
  // optional .env
}

const url = process.env.SUPABASE_URL?.trim() || process.env.VITE_SUPABASE_URL?.trim()
let key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
if (!key) {
  const keys = JSON.parse(execSync(`supabase projects api-keys --project-ref ${PROJECT_REF} -o json`, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })) as { name?: string; id?: string; api_key?: string }[]
  key = keys.find((item) => item.name === 'service_role' || item.id === 'service_role')?.api_key
}
if (!url || !key) throw new Error('missing supabase env')
process.env.SUPABASE_URL = url
process.env.SUPABASE_SERVICE_ROLE_KEY = key

const supabase = createClient(url, key, { auth: { persistSession: false } })
let wrotePlayback = false
const before = await supabase
  .from('maintenance_requests')
  .select('photo_paths, created_at')
  .eq('id', TICKET_ID)
  .single()
if (before.error) throw before.error

for (const path of PATHS) {
  const result = await convertStoredSmsVideo(supabase, helpers, { path })
  const streams = String(result.probe ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('Stream #') || line.startsWith('Input #'))
  console.log(JSON.stringify({
    path,
    status: result.status,
    skipped: result.skipped ?? false,
    bytes: result.bytes ?? null,
    hasAudio: result.hasAudio ?? null,
    audioPreserved: result.audioPreserved ?? null,
    playbackPath: result.playbackPath ?? null,
    error: result.error ?? null,
    streams,
  }))
  if (result.status !== 'ready') process.exitCode = 1
  if (!result.skipped) wrotePlayback = true
}

const after = await supabase
  .from('maintenance_requests')
  .select('photo_paths, created_at')
  .eq('id', TICKET_ID)
  .single()
if (after.error) throw after.error
console.log(JSON.stringify({
  photoPathsUnchanged: JSON.stringify(before.data.photo_paths) === JSON.stringify(after.data.photo_paths),
  createdAtUnchanged: before.data.created_at === after.data.created_at,
  photo_paths: after.data.photo_paths,
}))

if (process.exitCode) process.exit(process.exitCode)
if (!wrotePlayback) {
  console.log(JSON.stringify({ activityEventId: null, skippedLog: true }))
  process.exit(0)
}

const logged = spawn('deno', [
  'run',
  '--allow-env',
  '--allow-net',
  '--allow-read',
  'scripts/log-sms-playback-prepared.ts',
], { stdio: 'inherit', env: process.env })
await new Promise((resolve, reject) => {
  logged.on('exit', (code) => (code === 0 ? resolve(undefined) : reject(new Error(`activity log exited ${code}`))))
  logged.on('error', reject)
})
