#!/usr/bin/env node
/**
 * Ask Ulo performance test — sends a fixed question set to each agent mode
 * (Ulo Agent, Legal Insights, Financial Insights, Maintenance Pro, Market
 * Intelligence) on the deployed ask-ulo function and reports latency and
 * answer health per mode.
 *
 * Read-only questions only: no numbered replies (those can act on a daily
 * priorities list) and no product-support wording (that can open a ticket).
 * Each question costs model tokens. Use a disposable test landlord, not LA1.
 *
 * Usage:
 *   ULO_ACCESS_TOKEN=... node scripts/ask-ulo-perf.mjs --landlord <landlord-uuid> [--runs 2] [--modes legal_insights,maintenance_pro]
 *
 * Reads VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY and VITE_ADMIN_REASSIGN_SECRET
 * from the environment or .env.local / .env. ULO_ACCESS_TOKEN is the signed-in
 * session token; in the app's browser console run:
 *   copy(JSON.parse(localStorage.getItem(Object.keys(localStorage).find(k => k.endsWith('-auth-token')))).access_token)
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'

const QUESTIONS = {
  ulo_agent: [
    'How many open work orders do I have?',
    'Which repairs are waiting for my approval?',
    'Summarize my maintenance spend this month.',
    'Which property has the most open maintenance requests?',
  ],
  legal_insights: [
    'How much notice do I need to give before entering a tenant’s unit in New Jersey?',
    'What is the maximum security deposit allowed in New Jersey?',
    'Can I charge a late fee on rent in Newark, NJ, and how much?',
    'What are the heat requirements for rental units in New Jersey?',
  ],
  financial_insights: [
    'What is a fair rent for a 2-bedroom apartment in Newark, NJ?',
    'How does my rent compare to market rents in my area?',
    'Which property has the highest maintenance cost per unit?',
    'What was my rent collection rate last month?',
  ],
  maintenance_pro: [
    'How often should a water heater be flushed?',
    'Which of my properties have recurring plumbing repairs?',
    'What preventive maintenance should I schedule before winter?',
    'How long does a gas furnace usually last before replacement?',
  ],
  market_intelligence: [
    'What are rent trends in Newark, NJ over the last year?',
    'Show comparable rentals near Newark, NJ for a 3-bedroom home.',
    'What is the rental vacancy rate in Essex County, NJ?',
    'Which neighborhoods near Newark are seeing rent growth?',
  ],
}

function loadEnvFile(path) {
  if (!existsSync(path)) return
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (!match || process.env[match[1]]) continue
    process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, '')
  }
}

function arg(name, fallback = null) {
  const index = process.argv.indexOf(`--${name}`)
  return index >= 0 ? process.argv[index + 1] ?? fallback : fallback
}

function percentile(values, p) {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)]
}

const seconds = (ms) => (ms == null ? '—' : `${(ms / 1000).toFixed(1)}s`)

async function ask({ base, anonKey, secret, token, landlordId, mode, question, timeoutMs }) {
  const started = performance.now()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(`${base}/functions/v1/ask-ulo`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'content-type': 'application/json',
        apikey: anonKey,
        authorization: `Bearer ${anonKey}`,
        'x-admin-reassign-secret': secret,
        'x-ulo-access-token': token,
      },
      body: JSON.stringify({ question, landlordId, messages: [], conversationId: null, agentMode: mode }),
    })
    const text = await res.text()
    const ms = Math.round(performance.now() - started)
    let body = null
    try {
      body = JSON.parse(text)
    } catch {
      // Non-JSON error page.
    }
    if (!res.ok || !body || typeof body.answer !== 'string') {
      return { mode, question, ok: false, ms, status: res.status, error: (body?.error ?? text).slice(0, 200) }
    }
    return {
      mode,
      question,
      ok: true,
      ms,
      status: res.status,
      answerMode: body.mode,
      model: body.model,
      intent: body.intent,
      agentMode: body.agentMode,
      evalId: body.evalId,
      citations: Array.isArray(body.citations) ? body.citations.length : 0,
      tools: Array.isArray(body.toolsUsed) ? body.toolsUsed.filter((t) => !/^(eval|latency_ms|faithfulness):/.test(t)) : [],
      answerChars: body.answer.length,
      answerPreview: body.answer.replace(/\s+/g, ' ').slice(0, 160),
    }
  } catch (error) {
    const ms = Math.round(performance.now() - started)
    const timedOut = error?.name === 'AbortError'
    return { mode, question, ok: false, ms, status: null, error: timedOut ? `timed out after ${seconds(timeoutMs)}` : String(error?.message ?? error) }
  } finally {
    clearTimeout(timer)
  }
}

function summarize(mode, rows) {
  const ok = rows.filter((row) => row.ok)
  const times = ok.map((row) => row.ms)
  return {
    mode,
    asked: rows.length,
    answered: ok.length,
    errors: rows.length - ok.length,
    fallback: ok.filter((row) => row.answerMode === 'fallback').length,
    p50: percentile(times, 50),
    p90: percentile(times, 90),
    max: times.length ? Math.max(...times) : null,
    avgCitations: ok.length ? +(ok.reduce((s, r) => s + r.citations, 0) / ok.length).toFixed(1) : null,
    avgAnswerChars: ok.length ? Math.round(ok.reduce((s, r) => s + r.answerChars, 0) / ok.length) : null,
    models: [...new Set(ok.map((row) => row.model).filter(Boolean))],
  }
}

async function main() {
  loadEnvFile('.env.local')
  loadEnvFile('.env')
  const base = process.env.VITE_SUPABASE_URL?.trim().replace(/\/$/, '')
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY?.trim()
  const secret = process.env.VITE_ADMIN_REASSIGN_SECRET?.trim()
  const token = process.env.ULO_ACCESS_TOKEN?.trim()
  const landlordId = arg('landlord')
  const runs = Math.max(1, Number(arg('runs', '1')) || 1)
  const timeoutMs = Math.max(10, Number(arg('timeout', '120')) || 120) * 1000
  const modes = (arg('modes') ?? Object.keys(QUESTIONS).join(',')).split(',').map((m) => m.trim()).filter((m) => QUESTIONS[m])

  const missing = [
    !base && 'VITE_SUPABASE_URL',
    !anonKey && 'VITE_SUPABASE_ANON_KEY',
    !secret && 'VITE_ADMIN_REASSIGN_SECRET',
    !token && 'ULO_ACCESS_TOKEN',
    !landlordId && '--landlord <uuid>',
  ].filter(Boolean)
  if (missing.length) {
    console.error(`Missing: ${missing.join(', ')}. See the header of scripts/ask-ulo-perf.mjs.`)
    process.exit(1)
  }

  const total = modes.reduce((n, m) => n + QUESTIONS[m].length, 0) * runs
  console.log(`Ask Ulo performance test: ${total} questions across ${modes.length} modes (${runs} run${runs > 1 ? 's' : ''}), one at a time.\n`)

  const rows = []
  for (let run = 1; run <= runs; run += 1) {
    for (const mode of modes) {
      for (const question of QUESTIONS[mode]) {
        const row = await ask({ base, anonKey, secret, token, landlordId, mode, question, timeoutMs })
        rows.push({ run, ...row })
        console.log(`${row.ok ? '✓' : '✗'} ${mode.padEnd(19)} ${seconds(row.ms).padStart(6)}  ${row.ok ? `${row.answerMode ?? ''} ${row.citations} cites` : `${row.status ?? ''} ${row.error}`}  — ${question}`)
        if (!row.ok && (row.status === 401 || row.status === 403)) {
          console.error('\nAuth failed. Refresh ULO_ACCESS_TOKEN (it expires after about an hour) and check the landlord id.')
          process.exit(1)
        }
      }
    }
  }

  const summary = modes.map((mode) => summarize(mode, rows.filter((row) => row.mode === mode)))
  const lines = [
    '| Mode | Answered | Errors | No-AI fallback | p50 | p90 | Slowest | Avg citations | Avg answer length |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- |',
    ...summary.map((s) =>
      `| ${s.mode} | ${s.answered}/${s.asked} | ${s.errors} | ${s.fallback} | ${seconds(s.p50)} | ${seconds(s.p90)} | ${seconds(s.max)} | ${s.avgCitations ?? '—'} | ${s.avgAnswerChars ?? '—'} chars |`
    ),
  ]
  const slowest = rows.filter((row) => row.ok).sort((a, b) => b.ms - a.ms).slice(0, 5)
  lines.push('', 'Slowest answers:', ...slowest.map((row) => `- ${seconds(row.ms)} ${row.mode}: ${row.question}`))
  const failed = rows.filter((row) => !row.ok)
  if (failed.length) lines.push('', 'Errors:', ...failed.map((row) => `- ${row.mode}: ${row.question} → ${row.status ?? ''} ${row.error}`))
  const evalIds = rows.map((row) => row.evalId).filter(Boolean)
  console.log(`\n${lines.join('\n')}\n`)

  const file = `ask-ulo-perf-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
  writeFileSync(file, JSON.stringify({ ranAt: new Date().toISOString(), runs, summary, rows, evalIds }, null, 2))
  console.log(`Saved full results to ${file}`)
  if (evalIds.length) {
    console.log(`\nServer-side breakdown (paste into the Supabase SQL editor):\n` +
      `select e.latency_ms, e.retrieve_ms, e.synthesize_ms, e.prompt_tokens, e.completion_tokens, e.estimated_cost_usd, e.mode, e.intent, e.question_excerpt\n` +
      `from ask_ulo_evals e where e.id in (${evalIds.map((id) => `'${id}'`).join(', ')}) order by e.latency_ms desc;`)
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
