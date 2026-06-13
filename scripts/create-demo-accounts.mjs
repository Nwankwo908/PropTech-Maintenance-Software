#!/usr/bin/env node
/**
 * Create the two landlord showcase auth accounts:
 *   demo@ulohome.io        — Demo Property Management (seeded data)
 *   newlandlord@ulohome.io — New Landlord (empty state)
 *
 * Idempotent: existing users are left alone (password updated only with --reset-passwords).
 *
 * Usage:
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/create-demo-accounts.mjs
 *   ... node scripts/create-demo-accounts.mjs --reset-passwords
 */

import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL =
  process.env.SUPABASE_URL?.trim() || process.env.VITE_SUPABASE_URL?.trim()
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
const RESET_PASSWORDS = process.argv.includes('--reset-passwords')

const ACCOUNTS = [
  {
    email: 'demo@ulohome.io',
    password: process.env.DEMO_ACCOUNT_PASSWORD?.trim() || 'UloDemo-2026!',
    name: 'Demo Property Management',
  },
  {
    email: 'newlandlord@ulohome.io',
    password: process.env.NEW_LANDLORD_PASSWORD?.trim() || 'UloNew-2026!',
    name: 'New Landlord',
  },
]

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error(
    'Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY environment variables.',
  )
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

async function findUserByEmail(email) {
  let page = 1
  for (;;) {
    const { data, error } = await supabase.auth.admin.listUsers({
      page,
      perPage: 200,
    })
    if (error) throw new Error(error.message)
    const match = data.users.find(
      (u) => u.email?.toLowerCase() === email.toLowerCase(),
    )
    if (match) return match
    if (data.users.length < 200) return null
    page += 1
  }
}

for (const account of ACCOUNTS) {
  const existing = await findUserByEmail(account.email)

  if (existing) {
    if (RESET_PASSWORDS) {
      const { error } = await supabase.auth.admin.updateUserById(existing.id, {
        password: account.password,
        email_confirm: true,
      })
      if (error) {
        console.error(`FAIL  ${account.email} — password reset: ${error.message}`)
        process.exitCode = 1
        continue
      }
      console.log(`OK    ${account.email} — exists, password reset`)
    } else {
      console.log(`OK    ${account.email} — already exists (skipped)`)
    }
    continue
  }

  const { error } = await supabase.auth.admin.createUser({
    email: account.email,
    password: account.password,
    email_confirm: true,
    user_metadata: { full_name: account.name, ulo_account_kind: 'showcase' },
  })
  if (error) {
    console.error(`FAIL  ${account.email} — ${error.message}`)
    process.exitCode = 1
    continue
  }
  console.log(`OK    ${account.email} — created (password: ${account.password})`)
}

console.log(`
Next steps:
  1. Run migrations:        supabase db push
  2. Seed the demo account: paste supabase/seed_demo_landlord_account.sql into the SQL Editor
  3. Log in at /admin/login with either account
     (staff logins keep an "Account" switcher in the top bar for testing)
`)
