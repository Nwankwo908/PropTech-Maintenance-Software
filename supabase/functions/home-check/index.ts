import { serialFormatWarnings, hasLabelPlaceholder } from '../../../shared/vision/equipmentLabel.ts'
import { equipmentSerialFormatRules } from '../_shared/vision/getProvider.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1'
import { assertAskUloLandlordAccess } from '../_shared/ask_ulo/auth/assertAskUloLandlordAccess.ts'
import { recordActivityLog } from '../_shared/graph/recordActivityLog.ts'
import {
  confirmHomeCheck,
  createHomeCheck,
  requireData,
  reviewHomeCheckPhoto,
  uploadDashboardHomeCheckPhoto,
} from '../_shared/homeCheck/service.ts'
import { homeCheckTargets, homeCheckVendors } from '../_shared/homeCheck/sms.ts'
import { sendHomeCheckVendorAcceptance } from '../_shared/homeCheck/visitAct.ts'
import { homeCheckDashboardJobWindowEnd, homeCheckMetrics } from '../../../shared/homeCheck.ts'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, apikey, content-type, x-client-info, x-ulo-access-token',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  })
const str = (value: unknown) => typeof value === 'string' ? value.trim() : ''
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)
  const url = Deno.env.get('SUPABASE_URL') || ''
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
  if (!url || !key) return json({ error: 'Server misconfiguration' }, 500)
  const db = createClient(url, key, { auth: { persistSession: false } })
  try {
    if (Number(req.headers.get('content-length') || '0') > 15 * 1024 * 1024) {
      return json({ error: 'Photo too large' }, 413)
    }
    const raw = await req.text()
    if (raw.length > 15 * 1024 * 1024) return json({ error: 'Photo too large' }, 413)
    const body = JSON.parse(raw)
    const action = str(body.action)
    if (['open', 'upload', 'answers', 'start'].includes(action)) {
      return json({
        error:
          'This Home Check link is no longer used. Upload equipment photos from Property Intelligence.',
      }, 410)
    }
    const access = await assertAskUloLandlordAccess({
      req,
      supabase: db,
      supabaseUrl: url,
      anonKey: Deno.env.get('SUPABASE_ANON_KEY') || '',
      landlordId: str(body.landlordId),
    })
    if (!access.ok) return json({ error: access.error }, access.status)
    const landlordId = access.landlordId
    if (action === 'photo_reviews') {
      const propertyId = str(body.propertyId)
      if (!propertyId && body.portfolio !== true) return json({ error: 'Choose a property first.' }, 400)
      let query = db.from('home_checks')
        .select('id, property_id, property_label, detected_warning')
        .eq('landlord_id', landlordId)
        .not('detected_warning', 'is', null)
        .in('status', ['completed', 'confirmed'])
        .order('created_at', { ascending: false })
      if (propertyId) query = query.eq('property_id', propertyId)
      return json({ reviews: requireData(await query) })
    }
    if (action === 'options') {
      return json({
        targets: await homeCheckTargets(db, landlordId),
        ...(body.propertyId
          ? await homeCheckVendors(db, landlordId, str(body.propertyId))
          : { vendors: [], closest: null }),
      })
    }
    if (action === 'request') {
      const propertyId = str(body.propertyId)
      if (!propertyId) return json({ error: 'Choose a property first.' }, 400)
      const options = await homeCheckVendors(db, landlordId, propertyId)
      const vendor = options.vendors.find((row) => row.id === options.closest)
      if (!vendor?.id) {
        return json({
          error: options.vendors.length
            ? 'No contractor in this property’s state can take this home check.'
            : 'Go and set up your vendor first.',
        }, 400)
      }
      const shown = str(body.vendorId)
      if (shown && shown !== vendor.id) {
        return json({
          error: 'The selected contractor changed. Review the request and continue again.',
        }, 409)
      }
      const vendorName = str(vendor.name) || 'Contractor'
      const created = await createHomeCheck(db, {
        landlordId,
        propertyId,
        role: 'contractor',
        authorizedBy: access.user.id,
        vendorId: vendor.id,
        jobWindowEnd: homeCheckDashboardJobWindowEnd(),
        sendSms: false,
      })
      const acceptance = await sendHomeCheckVendorAcceptance(db, created.check)
      if (!acceptance.alreadySent) try {
        await recordActivityLog(db, {
          landlordId,
          eventType: 'home_check.requested',
          source: 'dashboard',
          actorType: 'landlord',
          actorId: access.user.id,
          propertyId,
          vendorId: vendor.id,
          maintenanceRequestId: created.check.ticket_id,
          workflowRunId: created.check.workflow_run_id,
          workflowTemplateId: 'home_check',
          metadata: {
            message: `${vendorName} was asked to accept a home check. Photo instructions wait until the visit time is confirmed.`,
          },
        })
      } catch (error) {
        console.error('[home-check] activity log', error)
      }
      return json({
        ok: true,
        checkId: created.check.id,
        workflowRunId: created.check.workflow_run_id,
        vendorName,
        deliveryError: acceptance.deliveryError,
      })
    }
    if (action === 'dashboard_photo') {
      const propertyId = str(body.propertyId)
      if (!propertyId) return json({ error: 'Choose a property first.' }, 400)
      const mime = str(body.contentType)
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(mime)) {
        return json({ error: 'Use JPEG, PNG or WebP photos.' }, 400)
      }
      const binary = atob(str(body.imageBase64))
      if (!binary.length || binary.length > 10 * 1024 * 1024) {
        return json({ error: 'Use a photo under 10 MB.' }, 400)
      }
      const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0))
      const signature = mime === 'image/jpeg'
        ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
        : mime === 'image/png'
        ? [137, 80, 78, 71, 13, 10, 26, 10].every((v, i) => bytes[i] === v)
        : new TextDecoder().decode(bytes.slice(0, 4)) === 'RIFF' &&
          new TextDecoder().decode(bytes.slice(8, 12)) === 'WEBP'
      if (!signature) return json({ error: 'Invalid image content.' }, 400)
      const saved = await uploadDashboardHomeCheckPhoto(db, {
        landlordId,
        propertyId,
        authorizedBy: access.user.id,
        bytes,
        contentType: mime,
      })
      return json({ ok: true, checkId: saved.checkId, slot: saved.slot })
    }
    if (action === 'photo_review') {
      const decision = str(body.decision)
      if (decision !== 'looks_fine' && decision !== 'repair' && decision !== 'closer_photo') {
        return json({ error: 'Choose whether the photo looks fine, needs a repair, or needs a closer photo.' }, 400)
      }
      const id = str(body.id)
      if (!id) return json({ error: 'Choose a photo review first.' }, 400)
      const result = await reviewHomeCheckPhoto(db, {
        landlordId,
        checkId: id,
        decision,
        actorId: access.user.id,
      })
      return json(result)
    }
    if (action === 'confirm') {
      const corrections = body.labelCorrections || []
      if (!Array.isArray(corrections) || corrections.length > 2) return json({ error: 'Invalid label corrections.' }, 400)
      const validated: Array<{assetId: string; modelNumber?: string; serialNumber?: string; manufactureYear?: number | null; manufactureMonth?: number | null}> = []
      for (const correction of corrections) {
        const asset = requireData<{brand: string | null; metadata: Record<string, unknown>}>(await db.from('unit_assets').select('brand, metadata').eq('id', str(correction.assetId)).eq('home_check_id', str(body.id)).eq('landlord_id', landlordId).single())
        const entry: {assetId: string; modelNumber?: string; serialNumber?: string; manufactureYear?: number | null; manufactureMonth?: number | null} = { assetId: str(correction.assetId) }
        for (const field of ['modelNumber','serialNumber'] as const) {
          if (!(field in correction)) continue
          if (typeof correction[field] !== 'string' || correction[field].length > 80 || hasLabelPlaceholder(correction[field])) return json({ error: 'Enter only label characters you can read.' }, 400)
          entry[field] = correction[field].trim()
        }
        if (entry.serialNumber) {
          const warnings = serialFormatWarnings(entry.serialNumber, asset.brand || '', String(asset.metadata.registryAssetType || ''), equipmentSerialFormatRules())
          if (warnings.length) return json({ error: warnings.join(' ') }, 400)
        }
        if ('manufactureYear' in correction || 'manufactureMonth' in correction) {
          const year = correction.manufactureYear == null || correction.manufactureYear === '' ? null : Number(correction.manufactureYear)
          const month = correction.manufactureMonth == null || correction.manufactureMonth === '' ? null : Number(correction.manufactureMonth)
          const currentYear = new Date().getUTCFullYear()
          if ((year != null && (!Number.isInteger(year) || year < 1970 || year > currentYear)) || (month != null && (!Number.isInteger(month) || month < 1 || month > 12))) {
            return json({ error: 'Enter a manufacture month and year from the data plate.' }, 400)
          }
          entry.manufactureYear = year
          entry.manufactureMonth = month
        }
        validated.push(entry)
      }
      await confirmHomeCheck(db, str(body.id), landlordId, validated)
      return json({ ok: true })
    }
    if (action === 'list') {
      const checks = requireData(
        await db.from('home_checks').select(
          'id, reference, role, property_label, unit_label, status, created_at, sent_at, opened_at, completed_at, confirmed_at, labels_readable, answers, detected_warning, issue_ticket_id, expires_at',
        ).eq('landlord_id', landlordId).eq('property_id', str(body.propertyId)).order(
          'created_at',
          { ascending: false },
        ),
      )
      const ids = checks.map((check) => check.id)
      const assets = ids.length
        ? requireData(
          await db.from('unit_assets').select('id, home_check_id, metadata').eq(
            'landlord_id',
            landlordId,
          ).in('home_check_id', ids),
        )
        : []
      const photos = ids.length
        ? requireData(
          await db.from('home_check_photos').select('check_id, slot, storage_path, inspection_photo_id').in(
            'check_id',
            ids,
          ),
        )
        : []
      const photoStates = photos.length ? requireData(await db.from('property_inspection_photos').select('id, status').in('id', photos.map((photo) => photo.inspection_photo_id))) : []
      const signed = photos.length
        ? requireData(
          await db.storage.from('inspection-uploads').createSignedUrls(
            photos.map((photo) => photo.storage_path),
            300,
          ),
        )
        : []
      const issueIds = checks.map((check) => check.issue_ticket_id).filter(Boolean)
      const issues = issueIds.length
        ? requireData(
          await db.from('maintenance_requests').select('id, spend_status').eq(
            'landlord_id',
            landlordId,
          ).in('id', issueIds),
        )
        : []
      const approvedEstimates = issueIds.length
        ? requireData(
          await db.from('maintenance_estimates').select('maintenance_request_id').eq(
            'landlord_id',
            landlordId,
          ).in('maintenance_request_id', issueIds).eq('status', 'approved'),
        )
        : []
      return json({
        checks: checks.map((check) => ({
          ...check,
          photos: photos.filter((photo) => photo.check_id === check.id).map((photo) => ({
            slot: photo.slot,
            state: photoStates.find((row) => row.id === photo.inspection_photo_id)?.status || 'queued',
            previewUrl: signed.find((url) => url.path === photo.storage_path)?.signedUrl || null,
          })),
          assets: assets.filter((asset) => asset.home_check_id === check.id).map((asset) => ({
            id: asset.id,
            ...asset.metadata.homeCheck,
            verified: asset.metadata.verificationStatus === 'confirmed',
          })),
        })),
        metrics: homeCheckMetrics(
          checks.map((check) => ({
            ...check,
            approved: issues.some((issue) =>
              issue.id === check.issue_ticket_id &&
              (issue.spend_status === 'recognized' ||
                approvedEstimates.some((estimate) => estimate.maintenance_request_id === issue.id))
            ),
          })),
        ),
      })
    }
    return json({ error: 'Unknown action' }, 400)
  } catch (error) {
    console.error('[home-check]', error instanceof Error ? error.message : 'Request failed')
    return json(
      { error: error instanceof Error ? error.message : 'Home Check request failed' },
      400,
    )
  }
})
