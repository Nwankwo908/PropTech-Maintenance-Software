#!/usr/bin/env node
/**
 * Live smoke test: inspection-asset-assess hybrid (Dib + vision).
 * Usage: node scripts/test-dib-inspection.mjs
 */

import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const envPath = resolve(__dirname, '../.env')

for (const line of readFileSync(envPath, 'utf8').split('\n')) {
  const trimmed = line.trim()
  if (!trimmed || trimmed.startsWith('#')) continue
  const eq = trimmed.indexOf('=')
  if (eq <= 0) continue
  const key = trimmed.slice(0, eq).trim()
  let value = trimmed.slice(eq + 1).trim()
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1)
  }
  if (process.env[key] == null || process.env[key] === '') process.env[key] = value
}

const SUPABASE_URL =
  process.env.SUPABASE_URL?.trim() ||
  process.env.VITE_SUPABASE_URL?.trim() ||
  ''
const ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY?.trim() || ''
const LANDLORD_ID =
  process.env.VITE_DEFAULT_LANDLORD_ID?.trim() ||
  '068daf53-07e4-4493-bd7f-6106e3c8c62f'

if (!SUPABASE_URL || !ANON_KEY) {
  console.error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY in .env')
  process.exit(1)
}

const FN_URL = `${SUPABASE_URL}/functions/v1/inspection-asset-assess`
const IMAGE_PATH = resolve(__dirname, '../src/assets/appliance-repair.png')

async function invoke(body) {
  const res = await fetch(FN_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${ANON_KEY}`,
      apikey: ANON_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ ...body, landlordId: LANDLORD_ID }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error(data.error || res.statusText || `HTTP ${res.status}`)
  }
  if (data?.error) throw new Error(String(data.error))
  return data
}

function summarizePhoto(photo) {
  const ai = photo?.aiResult && typeof photo.aiResult === 'object' ? photo.aiResult : null
  const dib = ai && '_dib' in ai ? ai._dib : null
  return {
    id: photo?.id,
    status: photo?.status,
    provider: photo?.provider,
    latencyMs: photo?.latencyMs,
    errorMessage: photo?.errorMessage,
    identifiedType: ai?.identifiedItem?.type ?? null,
    brand: ai?.identifiedItem?.brand ?? null,
    model: ai?.identifiedItem?.modelNumber ?? null,
    serial: ai?.identifiedItem?.serialNumber ?? null,
    category: ai?.category ?? null,
    condition: ai?.condition?.rating ?? null,
    dib: dib
      ? {
          confidence: dib.confidence ?? null,
          rawCandidateCount: dib.rawCandidateCount ?? null,
          latencyMs: dib.latencyMs ?? null,
        }
      : null,
  }
}

async function main() {
  const bytes = readFileSync(IMAGE_PATH)
  const imageBase64 = bytes.toString('base64')

  console.log('Creating assessment…')
  const created = await invoke({
    action: 'create_assessment',
    building: 'Dib hybrid smoke test',
  })
  const assessmentId = created.assessment?.id
  if (!assessmentId) throw new Error('No assessment id returned')

  console.log('Uploading and analyzing photo…')
  const analyzed = await invoke({
    action: 'upload_and_analyze',
    assessmentId,
    imageBase64,
    contentType: 'image/png',
    fileName: 'appliance-repair.png',
    mode: 'photo',
    hintCategory: 'appliance',
  })

  const summary = summarizePhoto(analyzed.photo)
  console.log('\nResult:')
  console.log(JSON.stringify(summary, null, 2))

  if (summary.status !== 'needs_review' && summary.status !== 'confirmed') {
    console.error('\nUnexpected status — see errorMessage above.')
    process.exit(1)
  }

  if (String(summary.provider || '').startsWith('dib+')) {
    console.log('\nPASS  Hybrid provider label present.')
  } else {
    console.log('\nWARN  Provider is vision-only — Dib pass did not attach (check DIB_API_KEY auth).')
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
