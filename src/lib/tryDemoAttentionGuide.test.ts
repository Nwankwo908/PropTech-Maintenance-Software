import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clearTryDemoAttentionGuide,
  consumeTryDemoAttentionGuidePending,
  dismissTryDemoAttentionGuide,
  isTryDemoAskUloLayoutStep,
  isTryDemoAttentionGuidePending,
  isTryDemoAttentionGuideSeen,
  markTryDemoAttentionGuidePending,
  markTryDemoAttentionGuideSeen,
  readTryDemoAttentionGuideActiveStep,
  writeTryDemoAttentionGuideActiveStep,
  TRY_DEMO_ATTENTION_GUIDE_STEP_ASK_ULO,
  TRY_DEMO_ATTENTION_GUIDE_STEP_ASK_ULO_CHATS,
  TRY_DEMO_ATTENTION_GUIDE_STEP_ASK_ULO_DOCKED,
  TRY_DEMO_ATTENTION_GUIDE_STEP_ATTENTION,
  TRY_DEMO_ATTENTION_GUIDE_STEP_PORTFOLIO,
  TRY_DEMO_ATTENTION_GUIDE_STEP_TOTAL,
  TRY_DEMO_SPOTLIGHT_ASK_ULO_CONTENT_ID,
  TRY_DEMO_SPOTLIGHT_ASK_ULO_ID,
  TRY_DEMO_SPOTLIGHT_ASK_ULO_PANEL_ID,
  tryDemoAskUloViewModeForStep,
  tryDemoAttentionGuideBody,
  tryDemoAttentionGuideExtraTargetIds,
  tryDemoAttentionGuidePageLabel,
  tryDemoAttentionGuideSkipHoleClamp,
  tryDemoAttentionGuideTargetId,
  tryDemoAttentionGuideTitle,
} from '@/lib/tryDemoAttentionGuide'

function makeStorageMock() {
  const store = new Map<string, string>()
  return {
    getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
    setItem: (key: string, value: string) => {
      store.set(key, String(value))
    },
    removeItem: (key: string) => {
      store.delete(key)
    },
    clear: () => {
      store.clear()
    },
  }
}

const localStorageMock = makeStorageMock()
const sessionStorageMock = makeStorageMock()

vi.stubGlobal('localStorage', localStorageMock)
vi.stubGlobal('sessionStorage', sessionStorageMock)
vi.stubGlobal('window', {
  localStorage: localStorageMock,
  sessionStorage: sessionStorageMock,
  dispatchEvent: () => true,
})

const ASK_ULO_LAYOUT_BODY =
  'Use Ask Ulo in a full view or move it to the side to keep working. Find past chats in the left sidebar and switch views anytime. When you visit another page, Ask Ulo moves to the side automatically.'

describe('tryDemoAttentionGuide', () => {
  beforeEach(() => {
    localStorageMock.clear()
    sessionStorageMock.clear()
  })

  it('arms pending until consumed or dismissed', () => {
    expect(isTryDemoAttentionGuidePending()).toBe(false)
    markTryDemoAttentionGuidePending()
    expect(isTryDemoAttentionGuidePending()).toBe(true)
    consumeTryDemoAttentionGuidePending()
    expect(isTryDemoAttentionGuidePending()).toBe(false)
    expect(isTryDemoAttentionGuideSeen()).toBe(false)
  })

  it('dismiss marks seen so it does not re-arm until marked pending again', () => {
    markTryDemoAttentionGuidePending()
    dismissTryDemoAttentionGuide()
    expect(isTryDemoAttentionGuidePending()).toBe(false)
    expect(isTryDemoAttentionGuideSeen()).toBe(true)
    markTryDemoAttentionGuidePending()
    expect(isTryDemoAttentionGuidePending()).toBe(true)
  })

  it('formats tooltip copy and page label', () => {
    expect(tryDemoAttentionGuideTitle(TRY_DEMO_ATTENTION_GUIDE_STEP_ATTENTION)).toBe(
      'See what needs your attention',
    )
    expect(tryDemoAttentionGuideBody(TRY_DEMO_ATTENTION_GUIDE_STEP_ATTENTION)).toBe(
      'from overdue repairs and late rent to missing lease details, failed texts, and invoices to review.',
    )
    expect(tryDemoAttentionGuideTitle(TRY_DEMO_ATTENTION_GUIDE_STEP_PORTFOLIO)).toBe(
      'Your Properties at a Glance',
    )
    expect(tryDemoAttentionGuideBody(TRY_DEMO_ATTENTION_GUIDE_STEP_PORTFOLIO)).toBe(
      'Get a quick view of your open repairs, upcoming visits, overall property condition, and maintenance costs so far this year.',
    )
    expect(tryDemoAttentionGuideTitle(TRY_DEMO_ATTENTION_GUIDE_STEP_ASK_ULO)).toBe(
      'Find What You Need',
    )
    expect(tryDemoAttentionGuideBody(TRY_DEMO_ATTENTION_GUIDE_STEP_ASK_ULO)).toBe(
      'Quickly find properties, residents, vendors, repairs, or pages. Select a result to open it, or ask a question to get help from Ask Ulo. Open search with ⌘K on Mac or Ctrl+K on Windows.',
    )
    expect(tryDemoAttentionGuideTitle(TRY_DEMO_ATTENTION_GUIDE_STEP_ASK_ULO_DOCKED)).toBe(
      'Ask Ulo, Your Way',
    )
    expect(tryDemoAttentionGuideBody(TRY_DEMO_ATTENTION_GUIDE_STEP_ASK_ULO_DOCKED)).toBe(
      ASK_ULO_LAYOUT_BODY,
    )
    expect(tryDemoAttentionGuideBody(TRY_DEMO_ATTENTION_GUIDE_STEP_ASK_ULO_CHATS)).toBe(
      ASK_ULO_LAYOUT_BODY,
    )
    expect(isTryDemoAskUloLayoutStep(TRY_DEMO_ATTENTION_GUIDE_STEP_ASK_ULO_DOCKED)).toBe(true)
    expect(isTryDemoAskUloLayoutStep(TRY_DEMO_ATTENTION_GUIDE_STEP_ASK_ULO)).toBe(false)
    expect(tryDemoAttentionGuideTargetId(TRY_DEMO_ATTENTION_GUIDE_STEP_ASK_ULO)).toBe(
      TRY_DEMO_SPOTLIGHT_ASK_ULO_ID,
    )
    expect(tryDemoAttentionGuideTargetId(TRY_DEMO_ATTENTION_GUIDE_STEP_ASK_ULO_DOCKED)).toBe(
      TRY_DEMO_SPOTLIGHT_ASK_ULO_PANEL_ID,
    )
    expect(tryDemoAttentionGuideTargetId(TRY_DEMO_ATTENTION_GUIDE_STEP_ASK_ULO_CHATS)).toBe(
      TRY_DEMO_SPOTLIGHT_ASK_ULO_CONTENT_ID,
    )
    expect(tryDemoAttentionGuideExtraTargetIds(TRY_DEMO_ATTENTION_GUIDE_STEP_ASK_ULO_CHATS)).toEqual(
      [],
    )
    expect(tryDemoAttentionGuideSkipHoleClamp(TRY_DEMO_ATTENTION_GUIDE_STEP_ASK_ULO_CHATS)).toBe(
      true,
    )
    expect(tryDemoAttentionGuideSkipHoleClamp(TRY_DEMO_ATTENTION_GUIDE_STEP_ASK_ULO_DOCKED)).toBe(
      false,
    )
    expect(
      tryDemoAttentionGuidePageLabel(
        TRY_DEMO_ATTENTION_GUIDE_STEP_ATTENTION,
        TRY_DEMO_ATTENTION_GUIDE_STEP_TOTAL,
      ),
    ).toBe('1 of 5')
    expect(
      tryDemoAttentionGuidePageLabel(
        TRY_DEMO_ATTENTION_GUIDE_STEP_ASK_ULO_CHATS,
        TRY_DEMO_ATTENTION_GUIDE_STEP_TOTAL,
      ),
    ).toBe('5 of 5')
  })

  it('clear removes pending and seen', () => {
    markTryDemoAttentionGuidePending()
    dismissTryDemoAttentionGuide()
    clearTryDemoAttentionGuide()
    expect(isTryDemoAttentionGuidePending()).toBe(false)
    expect(isTryDemoAttentionGuideSeen()).toBe(false)
  })

  it('active step survives seen mark and clears on dismiss', () => {
    writeTryDemoAttentionGuideActiveStep(TRY_DEMO_ATTENTION_GUIDE_STEP_ASK_ULO_DOCKED)
    markTryDemoAttentionGuideSeen()
    expect(readTryDemoAttentionGuideActiveStep()).toBe(
      TRY_DEMO_ATTENTION_GUIDE_STEP_ASK_ULO_DOCKED,
    )
    expect(isTryDemoAttentionGuideSeen()).toBe(true)
    dismissTryDemoAttentionGuide()
    expect(readTryDemoAttentionGuideActiveStep()).toBe(null)
  })

  it('maps tip steps to Ask Ulo view modes', () => {
    expect(tryDemoAskUloViewModeForStep(TRY_DEMO_ATTENTION_GUIDE_STEP_ASK_ULO)).toBe(null)
    expect(tryDemoAskUloViewModeForStep(TRY_DEMO_ATTENTION_GUIDE_STEP_ASK_ULO_DOCKED)).toBe(
      'docked',
    )
    expect(tryDemoAskUloViewModeForStep(TRY_DEMO_ATTENTION_GUIDE_STEP_ASK_ULO_CHATS)).toBe(
      'full',
    )
  })
})
