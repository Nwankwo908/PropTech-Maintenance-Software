import { describe, expect, it } from 'vitest'
import { HOME_CHECK_PHOTOS } from './homeCheck.ts'
import {
  beginHomeCheckPhotoVisit,
  homeCheckAcceptanceAlreadySent,
  homeCheckLandlordStatus,
  homeCheckVendorAcceptanceSms,
  homeCheckVisitAllowsPhotos,
  homeCheckVisitPhotoDue,
  homeCheckVisitPhotoSms,
  reduceHomeCheckVisit,
  type HomeCheckVisit,
  type HomeCheckVisitEvent,
  type HomeCheckVisitMessage,
} from './homeCheckVisit.ts'

const location = '14 Maple Ave, Unit 2'
const invited: HomeCheckVisit = {
  phase: 'awaiting_acceptance',
  inviteSentAt: '2026-10-30T12:00:00.000Z',
  tenantReady: true,
}

describe('home check visit from the request button', () => {
  it('asks the vendor to accept and does not include photo instructions', () => {
    const text = homeCheckVendorAcceptanceSms(location)
    expect(text).toContain('Hi, this is Ulo. Can you complete a Home Check at 14 Maple Ave, Unit 2?')
    expect(text).toContain('The visit involves taking 4 appliance photos.')
    expect(text).toContain('Reply YES to accept or NO to decline.')
    expect(text).not.toContain('Next: send a clear photo')
    expect(homeCheckAcceptanceAlreadySent(invited)).toBe(true)
    expect(homeCheckAcceptanceAlreadySent(null)).toBe(false)
  })

  it('keeps an unanswered invitation awaiting acceptance', () => {
    expect(homeCheckLandlordStatus('awaiting_vendor_acceptance')).toBe('Awaiting vendor acceptance')
    expect(homeCheckVisitAllowsPhotos(invited)).toBe(false)
    expect(homeCheckVisitPhotoDue(invited, Date.parse('2026-10-30T18:00:00.000Z'))).toBe(false)
  })

  it('records YES and starts scheduling once', () => {
    const first = reduceHomeCheckVisit({
      visit: invited,
      event: { type: 'vendor_yes', at: '2026-10-30T13:00:00.000Z', replyId: 'm1', tenantReady: true },
      location,
      vendorName: 'Rapid Electric',
    })
    expect(first.visit.phase).toBe('scheduling')
    expect(first.visit.awaiting).toBe('vendor_window')
    expect(first.messages.map((message) => message.to)).toEqual(['vendor'])
    expect(first.messages[0].body).toContain('earliest availability')
    expect(first.messages[0].body).not.toContain('Next: send a clear photo')
    expect(homeCheckLandlordStatus('scheduling_visit')).toBe('Scheduling visit')

    const duplicate = reduceHomeCheckVisit({
      visit: first.visit,
      event: { type: 'vendor_yes', at: '2026-10-30T13:01:00.000Z', replyId: 'm1', tenantReady: true },
      location,
      vendorName: 'Rapid Electric',
    })
    expect(duplicate.messages).toEqual([])
    expect(duplicate.visit).toEqual(first.visit)
  })

  it('notifies the landlord on NO and offers another vendor', () => {
    const result = reduceHomeCheckVisit({
      visit: invited,
      event: { type: 'vendor_no', at: '2026-10-30T13:00:00.000Z', replyId: 'm2', },
      location,
      vendorName: 'Rapid Electric',
    })
    expect(result.close).toBe(true)
    expect(result.visit.phase).toBe('declined')
    expect(result.messages.find((message) => message.to === 'landlord')?.body).toContain(
      'Choose another vendor from the property page',
    )
    expect(homeCheckVisitAllowsPhotos(result.visit)).toBe(false)
  })

  it('keeps coordinating when the tenant rejects the proposed time', () => {
    const proposed = reduceHomeCheckVisit({
      visit: {
        ...invited,
        phase: 'scheduling',
        awaiting: 'vendor_window',
        acceptedAt: '2026-10-30T13:00:00.000Z',
        tenantReady: true,
      },
      event: {
        type: 'vendor_window',
        at: '2026-10-30T13:05:00.000Z',
        replyId: 'm3',
        window: 'Wed 9am–12pm',
        visitAt: '2026-11-04T14:00:00.000Z',
      },
      location,
      vendorName: 'Rapid Electric',
    })
    expect(proposed.visit.phase).toBe('scheduling')
    expect(proposed.visit.awaiting).toBe('tenant_confirm')
    expect(proposed.messages.find((message) => message.to === 'tenant')?.body).toContain('Wed 9am–12pm')
    expect(homeCheckLandlordStatus('scheduling_visit')).toBe('Scheduling visit')
    expect(homeCheckVisitPhotoDue(proposed.visit, Date.parse('2026-11-04T15:00:00.000Z'))).toBe(false)

    const rejected = reduceHomeCheckVisit({
      visit: proposed.visit,
      event: { type: 'tenant_no', at: '2026-10-30T13:10:00.000Z', replyId: 'm4' },
      location,
      vendorName: 'Rapid Electric',
    })
    expect(rejected.visit.phase).toBe('scheduling')
    expect(rejected.visit.confirmedAt ?? null).toBeNull()
    expect(rejected.messages.find((message) => message.to === 'tenant')?.body).toContain('What day and arrival window works')
    expect(rejected.messages.find((message) => message.to === 'vendor')?.body).toContain('can’t do Wed 9am–12pm')
  })

  it('confirms the same time with the vendor and the tenant before the visit is scheduled', () => {
    const scheduling: HomeCheckVisit = {
      ...invited,
      phase: 'scheduling',
      awaiting: 'tenant_confirm',
      proposedWindow: 'Wed 9am–12pm',
      proposedBy: 'vendor',
      visitAt: '2026-11-04T14:00:00.000Z',
      tenantReady: true,
    }
    const confirmed = reduceHomeCheckVisit({
      visit: scheduling,
      event: { type: 'tenant_yes', at: '2026-10-30T13:20:00.000Z', replyId: 'm5' },
      location,
      vendorName: 'Rapid Electric',
    })
    expect(confirmed.visit.phase).toBe('scheduled')
    expect(confirmed.visit.confirmedWindow).toBe('Wed 9am–12pm')
    expect(confirmed.messages).toHaveLength(3)
    for (const message of confirmed.messages) {
      expect(message.body).toContain('set for Wed 9am–12pm')
      expect(message.body).not.toContain('Next: send a clear photo')
    }
    expect(homeCheckLandlordStatus('visit_scheduled')).toBe('Visit scheduled')
    expect(homeCheckVisitAllowsPhotos(confirmed.visit)).toBe(false)
    expect(homeCheckVisitPhotoDue(confirmed.visit, Date.parse('2026-11-04T13:00:00.000Z'))).toBe(false)
    expect(homeCheckVisitPhotoDue(confirmed.visit, Date.parse('2026-11-04T14:00:00.000Z'))).toBe(true)
  })

  it('sends photo instructions only when the visit starts, then collects four photos one at a time', () => {
    const scheduled: HomeCheckVisit = {
      ...invited,
      phase: 'scheduled',
      confirmedWindow: 'Wed 9am–12pm',
      visitAt: '2026-11-04T14:00:00.000Z',
      detailsSentAt: '2026-10-30T13:20:00.000Z',
    }
    const started = beginHomeCheckPhotoVisit(scheduled, '2026-11-04T14:00:00.000Z')
    expect(started.phase).toBe('in_progress')
    expect(homeCheckVisitAllowsPhotos(started)).toBe(true)
    expect(homeCheckLandlordStatus('home_check_in_progress')).toBe('Home Check in progress')

    const first = homeCheckVisitPhotoSms({
      location,
      company: 'Maple Court',
      filled: [],
    })
    expect(first).toContain('Home Check photos for 14 Maple Ave, Unit 2.')
    expect(first).not.toContain('No repairs are authorized')
    expect(first).toContain('Water heater label')
    expect(first).not.toContain('furnace or boiler label')

    let filled: string[] = []
    const replies: string[] = []
    for (const photo of HOME_CHECK_PHOTOS) {
      const reply = homeCheckVisitPhotoSms({
        location,
        company: 'Maple Court',
        savedSlot: photo.slot,
        filled,
      })
      replies.push(reply)
      filled = [...filled, photo.slot]
    }
    expect(replies[0]).toContain('Saved as the water heater label')
    expect(replies[0]).toContain('whole water heater')
    expect(replies[1]).toContain('Saved as the whole water heater, including the base')
    expect(replies[1]).toContain('furnace or boiler label')
    expect(replies[2]).toContain('Saved as the furnace or boiler label')
    expect(replies[2]).toContain('whole furnace or boiler')
    expect(replies[3]).toContain('Saved as the whole furnace or boiler')
    expect(replies[3]).toContain('All four photos are in.')
    expect(homeCheckLandlordStatus('four_photos_received', 'completed')).toBe('Completed')
  })
})


describe('owner access fallback and consent gates',()=>{
 const at='2026-11-01T17:00:00Z'
 const location='Disposable test property'
 const start={phase:'awaiting_acceptance',accessCoordinator:'landlord'} as const
 const act=(visit: HomeCheckVisit, event: HomeCheckVisitEvent)=>reduceHomeCheckVisit({visit,event,location,vendorName:'Test Vendor'})
 it('does not schedule or release photo instructions on vendor acceptance alone',()=>{
  const result=act(start,{type:'vendor_yes',at,replyId:'accept',tenantReady:true})
  expect(result.visit.phase).toBe('scheduling')
  expect(homeCheckVisitAllowsPhotos(result.visit)).toBe(false)
  expect(result.messages[0].body).toContain('property team')
 })
 it('requires owner access confirmation for a vendor-proposed time, without inventing a tenant',()=>{
  const accepted=act(start,{type:'vendor_yes',at,replyId:'accept',tenantReady:true})
  const proposed=act(accepted.visit,{type:'vendor_window',at,replyId:'window',window:'Today 2-4pm',visitAt:'2026-11-01T19:00:00Z'})
  expect(proposed.visit.phase).toBe('scheduling')
  expect(proposed.messages.find((m: HomeCheckVisitMessage)=>m.to==='vendor')?.body).toContain('property team')
  const agreed=act(proposed.visit,{type:'tenant_yes',at,replyId:'owner-yes'})
  expect(agreed.visit.phase).toBe('scheduled')
  expect(agreed.messages.map((m: HomeCheckVisitMessage)=>m.to)).toEqual(['vendor','tenant'])
  expect(homeCheckVisitAllowsPhotos(agreed.visit)).toBe(false)
 })
 it('requires vendor confirmation of an access-contact counterproposal',()=>{
  const accepted=act({...start,phase:'scheduling',awaiting:'tenant_confirm',tenantReady:true},{type:'tenant_window',at,replyId:'counter',window:'Tomorrow 10am',visitAt:'2026-11-02T15:00:00Z'})
  expect(accepted.visit.phase).toBe('scheduling')
  expect(accepted.visit.awaiting).toBe('vendor_confirm')
  expect(homeCheckVisitAllowsPhotos(accepted.visit)).toBe(false)
  const agreed=act(accepted.visit,{type:'vendor_yes',at,replyId:'vendor-agrees',tenantReady:true})
  expect(agreed.visit.phase).toBe('scheduled')
 })
})


it.each(['tenant','landlord'] as const)('names the verified %s who coordinates access', coordinator => {
 const text = homeCheckVendorAcceptanceSms('12 Oak St', coordinator)
 expect(text).toContain(`If you accept, we’ll coordinate a visit time with the ${coordinator}.`)
 expect(text).not.toContain('access contact')
 expect(text).not.toContain(coordinator === 'tenant' ? 'with the landlord' : 'with the tenant')
})

it.each(['tenant_yes','vendor_yes'] as const)('sends photo-instruction expectations only to the vendor after %s',type=>{
 const result=reduceHomeCheckVisit({visit:{phase:'scheduling',awaiting:type==='tenant_yes'?'tenant_confirm':'vendor_confirm',accessCoordinator:'tenant',tenantReady:true,proposedWindow:'Wed 9–10:30am',visitAt:'2026-11-04T14:00:00Z'},event:type==='vendor_yes'?{type,at:'2026-11-04T13:38:00Z',replyId:'confirm',tenantReady:true}:{type,at:'2026-11-04T13:38:00Z',replyId:'confirm'},location:'200 Test Lane, Unit 1',vendorName:'Test Vendor'})
 expect(result.messages.find(m=>m.to==='vendor')?.body).toContain('Photo instructions will arrive by text when it’s time for the visit.')
 const tenant=result.messages.find(m=>m.to==='tenant')?.body??''
 expect(tenant).toContain('Test Vendor will take four appliance photos.')
 expect(tenant).toContain('Ulo will send the photo instructions directly to the vendor.')
 expect(tenant).not.toContain('Photo instructions will arrive by text')
 expect(tenant).not.toMatch(/send.*photo here|upload|Reply 1/i)
 expect(result.visit.phase).toBe('scheduled')
})
