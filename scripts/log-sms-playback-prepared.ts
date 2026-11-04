/**
 * Audit the saved playable copies. Does not send SMS.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1'
import { recordActivityLog } from '../supabase/functions/_shared/graph/recordActivityLog.ts'

const url = Deno.env.get('SUPABASE_URL')?.trim()
const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')?.trim()
if (!url || !key) throw new Error('missing supabase env')

const supabase = createClient(url, key, { auth: { persistSession: false } })
const ticketId = '2483e1bd-475c-4c8e-8c92-afec3c9324fc'
const { data: ticket, error } = await supabase
  .from('maintenance_requests')
  .select('id, landlord_id, property_id, unit_id, resident_id')
  .eq('id', ticketId)
  .single()
if (error || !ticket) throw error ?? new Error('ticket missing')

const eventId = await recordActivityLog(supabase, {
  landlordId: ticket.landlord_id,
  eventType: 'maintenance.playback_prepared',
  source: 'automation',
  actorType: 'system',
  propertyId: ticket.property_id,
  unitId: ticket.unit_id,
  residentId: ticket.resident_id,
  maintenanceRequestId: ticket.id,
  conversationId: '97b9b057-950d-4ce2-97af-e5ebc69cea1e',
  messageId: 'a42f19df-5c14-4dcf-93aa-8135fd081f77',
  metadata: {
    message: 'Saved playable copies of both November 3 videos. The original files are unchanged.',
    message_ids: [
      '57c9a129-f6ac-4137-9667-a3db6fcb8827',
      'a42f19df-5c14-4dcf-93aa-8135fd081f77',
    ],
    playback: true,
  },
})

console.log(JSON.stringify({ activityEventId: eventId }))
