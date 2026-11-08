import { describe, expect, it } from 'vitest'
import {
  isGeneralistOfferedPestWork,
  landlordTextAsksForReply,
  NEEDS_YOUR_RESPONSE_WAIT_MS,
  offeredVendorNameFromAsk,
  threadNeedsYourResponse,
  unansweredLandlordTopics,
} from '@/lib/communicationNeedsResponse'

const now = Date.parse('2026-10-30T12:00:00Z')
const inbound = (hoursAgo: number) => ({
  direction: 'inbound',
  createdAtMs: now - hoursAgo * 60 * 60 * 1000,
})
const outbound = (hoursAgo: number) => ({
  direction: 'outbound',
  createdAtMs: now - hoursAgo * 60 * 60 * 1000,
})

describe('threadNeedsYourResponse', () => {
  it('counts a tenant or vendor text that has waited 4 hours', () => {
    expect(
      threadNeedsYourResponse({
        conversationType: 'resident_intake',
        closed: false,
        messages: [inbound(4)],
        atMs: now,
      }),
    ).toBe(true)
    expect(
      threadNeedsYourResponse({
        conversationType: 'vendor_alert',
        closed: false,
        messages: [inbound(5)],
        atMs: now,
      }),
    ).toBe(true)
  })

  it('waits out the 4 hour window', () => {
    expect(
      threadNeedsYourResponse({
        conversationType: 'resident_intake',
        closed: false,
        messages: [inbound(3.9)],
        atMs: now,
      }),
    ).toBe(false)
  })

  it('drops the thread when you or Ulo reply', () => {
    expect(
      threadNeedsYourResponse({
        conversationType: 'vendor_alert',
        closed: false,
        messages: [outbound(1), inbound(6)],
        atMs: now,
      }),
    ).toBe(false)
  })

  it('ignores closed threads and threads that are not with a tenant or vendor', () => {
    expect(
      threadNeedsYourResponse({
        conversationType: 'resident_intake',
        closed: true,
        messages: [inbound(8)],
        atMs: now,
      }),
    ).toBe(false)
    expect(
      threadNeedsYourResponse({
        conversationType: 'landlord_update',
        closed: false,
        messages: [inbound(8)],
        atMs: now,
      }),
    ).toBe(false)
    expect(
      threadNeedsYourResponse({
        conversationType: 'ai_copilot',
        closed: false,
        messages: [inbound(8)],
        atMs: now,
      }),
    ).toBe(false)
  })

  it('uses the same 4 hour wait at an earlier snapshot', () => {
    const fourWeeksAgo = now - 28 * 24 * 60 * 60 * 1000
    expect(NEEDS_YOUR_RESPONSE_WAIT_MS).toBe(4 * 60 * 60 * 1000)
    expect(
      threadNeedsYourResponse({
        conversationType: 'resident_intake',
        closed: false,
        messages: [inbound(0), { direction: 'inbound', createdAtMs: fourWeeksAgo - NEEDS_YOUR_RESPONSE_WAIT_MS }],
        atMs: fourWeeksAgo,
      }),
    ).toBe(true)
  })
})

const SENDER_PROMPTS = [
  "Hi — this is Ulo. I couldn't match this number to a vendor profile yet. Please reply with your company name, or contact the property team.",
  "Hi — this is Ulo. I couldn’t match this number to a vendor profile yet. Please reply with your company name, or contact the property team.",
  "Thanks for texting. We couldn't match this number to a property account. Please contact your property manager directly.",
  "Hi! I can help with that. I don't recognize this phone number yet. Which property and apartment are you contacting us about?",
  'Thanks. I found Apt 3B at 123 Main. Before I continue, may I save this phone number as a contact for that unit so we can route future updates correctly?',
  "No problem — just reply YES to save this number for that unit, or NO if you'd rather not.",
  "I wasn't able to match that unit on our end. I've flagged your property manager — someone will follow up with you shortly.",
]

const RESIDENT_HELP = [
  'Thanks for reaching out — this is Ulo. How can we help with your maintenance issue today?',
  'Happy to help. What do you need — a repair, something about rent or your lease, or something else?',
  "Hi — this is Ulo. Tell me what's going on with your unit (a photo or video helps too).",
  "Thanks for reaching out. I'll help get this taken care of. What kind of issue is it? Plumbing, electrical, appliance, HVAC, leak, pest, lock, or something else?",
  "When you're ready, reply with a short description of what's going on.",
]

const RENT_QUESTIONS = [
  'Unit 3 — $1,400 rent due today. Did you receive it?\n\nReply YES, NO, or PARTIAL.',
  'What was your payment method?\nReply Zelle, Venmo, ACH, Check, Cash, or Other.',
  'How much did you receive for Unit 3?',
  'Your rent of $1,406.00 was due October 1. Reply PAID, PARTIAL, or QUESTIONS.',
  'Are you asking about your rent balance?\n\nReply YES or NO.',
  'Ulo: Late rent escalation. Jane · Unit 2 · $1,400. This rent account needs a decision from you.',
]

describe('rent questions', () => {
  it('does not count them while rent reminders are paused', () => {
    for (const text of RENT_QUESTIONS) {
      expect(landlordTextAsksForReply(text)).toBe(false)
    }
    expect(
      unansweredLandlordTopics(
        RENT_QUESTIONS.map((text, index) => ({
          id: `rent-${index}`,
          direction: 'outbound',
          createdAtMs: now + index,
          text,
        })),
      ),
    ).toEqual([])
  })
})

describe('resident help questions', () => {
  it('does not count them as a landlord ask', () => {
    for (const text of RESIDENT_HELP) {
      expect(landlordTextAsksForReply(text)).toBe(false)
    }
    expect(
      unansweredLandlordTopics(
        RESIDENT_HELP.map((text, index) => ({
          id: `help-${index}`,
          direction: 'outbound',
          createdAtMs: now + index,
          text,
        })),
      ),
    ).toEqual([])
  })

  it('still counts a visit question for the landlord', () => {
    expect(
      landlordTextAsksForReply(
        'What day and time works for the bathroom light? Reply with a day and arrival window.',
      ),
    ).toBe(true)
  })
})

const GENERALIST_PEST_ASK = `Hi KendoProperties — Ivanhomesolutions can take the Pest issue at 78 Maple Ave · Unit 3.

The assigned vendor isn't able to take this job.

Reply YES to send the job to Ivanhomesolutions.

View details:
https://www.ulohome.io/admin/requests?q=WO-F412`

describe('generalist offered for pest work', () => {
  it('does not count the offer', () => {
    expect(offeredVendorNameFromAsk(GENERALIST_PEST_ASK)).toBe('Ivanhomesolutions')
    expect(
      isGeneralistOfferedPestWork({
        text: GENERALIST_PEST_ASK,
        vendorFound: true,
        vendorCategory: 'general',
        issueCategory: 'pest_control',
      }),
    ).toBe(true)
    expect(
      unansweredLandlordTopics([
        {
          id: 'pest-generalist',
          direction: 'outbound',
          createdAtMs: now,
          text: GENERALIST_PEST_ASK,
          generalistPestOffer: true,
        },
      ]),
    ).toEqual([])
  })

  it('still counts a pest specialist and a generalist on other work', () => {
    expect(
      isGeneralistOfferedPestWork({
        text: GENERALIST_PEST_ASK,
        vendorFound: true,
        vendorCategory: 'pest_control',
        issueCategory: 'pest_control',
      }),
    ).toBe(false)
    expect(
      isGeneralistOfferedPestWork({
        text: 'Reply YES to send the job to Ivanhomesolutions.',
        vendorFound: true,
        vendorCategory: 'general',
        issueCategory: 'plumbing',
      }),
    ).toBe(false)
    expect(
      isGeneralistOfferedPestWork({
        text: GENERALIST_PEST_ASK,
        vendorFound: false,
        vendorCategory: null,
        issueCategory: 'pest_control',
      }),
    ).toBe(false)
  })
})

describe('unrecognized sender prompts', () => {
  it('does not count any of them as a landlord ask', () => {
    for (const text of SENDER_PROMPTS) {
      expect(landlordTextAsksForReply(text)).toBe(false)
    }
    expect(
      unansweredLandlordTopics(
        SENDER_PROMPTS.map((text, index) => ({
          id: `sender-${index}`,
          direction: 'outbound',
          createdAtMs: now + index,
          text,
        })),
      ),
    ).toEqual([])
  })

  it('drops a thread once its work order is completed', () => {
    expect(
      unansweredLandlordTopics([
        {
          id: 'done-ask',
          direction: 'outbound',
          createdAtMs: now,
          text: 'Reply YES to send this to Ivanhomesolutions and we will handle the rest.',
          workOrderCompleted: true,
        },
        {
          id: 'done-follow-up',
          direction: 'outbound',
          createdAtMs: now + 1,
          text: 'Reply APPROVE or DECLINE for the estimate.',
          workOrderCompleted: true,
        },
      ]),
    ).toEqual([])
  })

  it('keeps an open work order ask beside a completed one', () => {
    const topics = unansweredLandlordTopics([
      {
        id: 'done-ask',
        direction: 'outbound',
        createdAtMs: now,
        text: 'Reply YES to send this to the old vendor.',
        workOrderCompleted: true,
      },
      {
        id: 'open-ask',
        direction: 'outbound',
        createdAtMs: now + 1,
        text: 'Reply YES to send this to the new vendor.',
      },
    ])
    expect(topics.map((topic) => topic.messageId)).toEqual(['open-ask'])
  })

  it('still counts a real ask to the landlord', () => {
    expect(
      landlordTextAsksForReply('Reply YES to send this to Ivanhomesolutions and we will handle the rest.'),
    ).toBe(true)
    expect(
      landlordTextAsksForReply(
        'Reply CONFIRM to acknowledge the new time, or contact the property team if this no longer works for you.',
      ),
    ).toBe(true)
  })
})
