// Browser contract smoke test. Uses local mocked API responses; sends no SMS
// and requires no provider credentials. Run Vite with the fixture config in
// supabase/HOME_CHECK.md before running this script.
import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'
import { unlink, writeFile } from 'node:fs/promises'

const driver = process.env.HOME_CHECK_BROWSER_DRIVER
const { chromium } = await import(driver ? pathToFileURL(driver).href : 'playwright')
const base = process.env.HOME_CHECK_BASE_URL || 'http://127.0.0.1:5180'
assert(['127.0.0.1', 'localhost'].includes(new URL(base).hostname), 'Use a local fixture server')
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
  headless: true,
  args: ['--no-sandbox'],
})
const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
const errors = []
page.on('pageerror', (error) => {
  errors.push(error.message)
  console.error(error.message)
})
const slots = ['water_heater_label', 'water_heater_whole', 'heating_label', 'heating_whole']
const received = new Map()
const calls = []
const replacements = new Set()
let showReview = false
let confirmed = false
const retakeMessage = 'Label unreadable, please send a closer photo without flash.'
const reviewAssets = ['water_heater', 'heating_system'].map((system, index) => ({
  id: `asset-${index}`,
  system,
  verified: false,
  fields: Object.fromEntries(
    ['make', 'model', 'serial', 'approximateAge', 'condition', 'lastService', 'lastFilterChange']
      .map((
        name,
      ) => [name, { value: null, source: 'photo_text', capturedBy: 'tenant', confidence: 'low' }]),
  ),
  labelReadability: index === 0
    ? {
      status: 'uncertain',
      retakeRequested: true,
      retakeMessage,
      modelConfidence: 90,
      serialConfidence: 40,
      uncertainCharacters: [{ field: 'serialNumber', index: 2, alternatives: ['0', 'O'] }],
      formatWarnings: [],
      readings: { serialNumber: 'AB[0/O]1234' },
    }
    : undefined,
}))
let role = 'tenant'
const token = 'b'.repeat(64)
const photo = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5p8AAAAASUVORK5CYII=',
  'base64',
)
await page.route('**/*', async (route) => {
  const url = new URL(route.request().url())
  if (
    url.hostname === '127.0.0.1' && url.port === '55432' &&
    url.pathname === '/functions/v1/home-check'
  ) {
    const body = route.request().postDataJSON()
    calls.push(body)
    if (body.action === 'options') {
      return route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          targets: [{
            propertyId: 'birch',
            unitId: 'birch-12a',
            propertyName: 'Birch',
            address: '1 Main St',
            unitLabel: '12A',
          }, {
            propertyId: 'oak',
            unitId: 'oak-12a',
            propertyName: 'Oak',
            address: '2 Main St',
            unitLabel: '12A',
          }],
          vendors: [{ id: 'near', name: 'Nearby contractor', distanceKm: 1 }, {
            id: 'unknown',
            name: 'Unlocated contractor',
            distanceKm: null,
          }],
          closest: 'near',
        }),
      })
    }
    if (body.action === 'list') {
      return route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          checks: showReview
            ? [{
              id: 'review',
              reference: 'HC-AABBCCDDEEFF',
              role: 'tenant',
              property_label: 'Birch',
              unit_label: '12A',
              status: 'completed',
              completed_at: new Date().toISOString(),
              confirmed_at: confirmed ? new Date().toISOString() : null,
              labels_readable: false,
              assets: reviewAssets.map((asset) => ({ ...asset, verified: confirmed })),
              photos: slots.map((slot) => ({ slot, state: 'needs_review', previewUrl: null })),
            }]
            : [],
          metrics: [],
        }),
      })
    }
    if (body.action === 'confirm') {
      assert.equal(body.id, 'review')
      assert.deepEqual(body.labelCorrections, [{
        assetId: 'asset-0',
        modelNumber: 'XE40',
        serialNumber: 'AB01234',
      }])
      confirmed = true
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true }) })
    }
    if (body.action === 'start') {
      return route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          id: body.role,
          link: `https://app.ulohome.io/c/${body.role}#${token}`,
          deliveryError: null,
        }),
      })
    }
    assert(!url.href.includes(token), 'Capture token must stay out of request URLs')
    if (body.id === 'expired') {
      return route.fulfill({
        status: 410,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'This Home Check link is invalid or has expired.' }),
      })
    }
    const current = received.get(body.id) || new Set()
    if (body.action === 'upload') {
      assert(slots.includes(body.slot))
      if (current.has(body.slot)) replacements.add(body.id)
      current.add(body.slot)
      received.set(body.id, current)
    }
    const check = {
      id: body.id,
      reference: 'HC-AABBCCDDEEFF',
      role,
      location: `${role === 'landlord' ? 'Oak' : 'Birch'} / 12A`,
      expiresAt: new Date(Date.now() + 86400000).toISOString(),
      slots: [...current],
      status: current.size === 4 ? 'completed' : 'collecting',
      feedback: current.size >= 2 && !replacements.has(body.id)
        ? [{
          slot: 'water_heater_label',
          state: 'needs_review',
          retakeMessage,
          uncertainCharacters: [{ field: 'serialNumber', index: 2, alternatives: ['0', 'O'] }],
          formatWarnings: [],
        }]
        : [],
    }
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(body.action === 'answers' ? { ok: true } : check),
    })
  }
  if (url.hostname === new URL(base).hostname && url.port === new URL(base).port) {
    return route.continue()
  }
  return route.abort()
})
try {
  const fixturePath = '.home-check-smoke.local.html'
  await writeFile(
    fixturePath,
    `<html><body><div id="root"></div><script type="module">
    import React from 'react'; import {createRoot} from 'react-dom/client';
    import {HomeCheckPanel} from '/src/components/HomeCheckPanel.tsx';
    import '/src/index.css';
    function Harness() { const [property, setProperty] = React.useState('birch'); return React.createElement('div', null,
      React.createElement('button', {onClick: () => setProperty('birch')}, 'Open Birch'),
      React.createElement('button', {onClick: () => setProperty('oak')}, 'Open Oak'),
      React.createElement(HomeCheckPanel, {key: property, building: property === 'birch' ? 'Birch' : 'Oak', propertyId: property})); }
    createRoot(document.getElementById('root')).render(React.createElement(Harness));
    </script></body></html>`,
  )
  await page.goto(`${base}/${fixturePath}`)
  await page.getByRole('button', { name: 'Ask my tenant', exact: true }).click()
  assert(
    await page.getByRole('button', { name: 'Send Home Check', exact: true }).isDisabled(),
    'Tenant requests must require an exact unit',
  )
  await page.getByLabel('Property / unit').selectOption('birch-12a')
  await page.getByRole('button', { name: 'Send Home Check', exact: true }).click()
  await page.getByRole('link', { name: 'Open scoped capture page' }).waitFor()
  assert(
    calls.some((call) =>
      call.action === 'start' && call.propertyId === 'birch' && call.unitId === 'birch-12a' &&
      call.role === 'tenant'
    ),
  )
  await page.getByRole('button', { name: 'Send to my contractor', exact: true }).click()
  await page.getByRole('button', { name: 'Choose closest located contractor' }).click()
  await page.getByLabel('Job window ends').fill(
    new Date(Date.now() + 86400000).toISOString().slice(0, 16),
  )
  await page.getByRole('button', { name: 'Send Home Check', exact: true }).click()
  await page.getByRole('link', { name: 'Open scoped capture page' }).waitFor()
  assert(
    calls.some((call) =>
      call.action === 'start' && call.role === 'contractor' && call.vendorId === 'near' &&
      call.jobWindowEnd
    ),
  )
  await page.getByRole('button', { name: 'Open Oak', exact: true }).click()
  await page.getByRole('button', { name: 'Open my Home Check', exact: true }).click()
  await page.getByRole('link', { name: 'Open scoped capture page' }).waitFor()
  assert(
    calls.some((call) =>
      call.action === 'start' && call.role === 'landlord' && call.propertyId === 'oak' &&
      call.unitId === null
    ),
  )
  assert(
    !(await page.getByLabel('Property / unit').innerText()).includes('Birch'),
    'Changing properties must reset scope',
  )
  showReview = true
  await page.reload()
  await page.getByRole('button', { name: 'Confirm asset records' }).waitFor()
  assert(await page.getByRole('button', { name: 'Confirm asset records' }).isDisabled())
  await page.getByText(retakeMessage, { exact: true }).waitFor()
  await page.getByRole('button', { name: 'I checked the data plate', exact: false }).click()
  await page.getByLabel('Verified model', { exact: true }).fill('XE40')
  await page.getByLabel('Verified serial', { exact: true }).fill('AB01234')
  await page.getByRole('button', { name: 'Confirm asset records' }).click()
  await page.getByText('Landlord confirmed', { exact: false }).first().waitFor()
  for (const participant of ['tenant', 'contractor', 'landlord']) {
    role = participant
    await page.goto(`${base}/c/${participant}?role=wrong#${token}`)
    await page.getByRole('heading', {
      name: `${participant === 'landlord' ? 'Oak' : 'Birch'} / 12A`,
    }).waitFor()
    assert.equal(await page.locator('input[type=file]').count(), 4)
    assert(!(await page.locator('main').innerText()).match(/\bAI\b/))
    for (let index = 0; index < 4; index++) {
      await page.locator('input[type=file]').nth(index).setInputFiles({
        name: 'label.png',
        mimeType: 'image/png',
        buffer: photo,
      })
      await page.getByText(`${index + 1} of 4 photos received`, { exact: false }).waitFor()
    }
    await page.getByText(retakeMessage, { exact: true }).waitFor()
    await page.getByText('Serial character 3: 0 / O. Please check the label.', { exact: true })
      .waitFor()
    await page.locator('input[type=file]').nth(0).setInputFiles({
      name: 'closer-label.png',
      mimeType: 'image/png',
      buffer: photo,
    })
    await page.getByText(retakeMessage, { exact: true }).waitFor({ state: 'detached' })
    await page.getByText('4 of 4 photos received', { exact: false }).waitFor()
    await page.getByRole('radio', { name: 'Yes', exact: true }).check()
    await page.getByLabel('What did you notice?').fill('Leak at water heater base')
    await page.getByLabel('Water heater last service', { exact: true }).fill('June 2025')
    await page.getByRole('button', { name: 'Save observations' }).click()
    await page.getByText('Observations saved.', { exact: false }).waitFor()
    await page.getByText('All four photos received.', { exact: false }).waitFor()
    assert(
      calls.some((call) =>
        call.action === 'answers' && call.id === participant &&
        call.answers.warningSigns === true && call.answers.lastFilterChange === '' &&
        call.answers.waterHeaterLastService === 'June 2025'
      ),
    )
  }
  await page.goto(`${base}/c/expired#${token}`)
  await page.getByRole('alert').waitFor()
  assert.equal(await page.locator('input[type=file]').count(), 0)
  assert.equal(errors.length, 0, errors.join('\n'))
  console.log(
    'Browser smoke passed: initiation, property/unit scope, all three capture roles, four distinct uploads, retake and uncertain-character feedback, landlord label corrections, observations, expired links and no runtime errors.',
  )
} finally {
  await browser.close()
  await unlink('.home-check-smoke.local.html').catch(() => {})
}
