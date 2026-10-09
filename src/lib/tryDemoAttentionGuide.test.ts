import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clearTryDemoAttentionGuide,
  consumeTryDemoAttentionGuidePending,
  dismissTryDemoAttentionGuide,
  isTryDemoActiveTasksGuideStep,
  isTryDemoAskUloLayoutStep,
  isTryDemoAskUloShellSyncStep,
  isTryDemoAttentionGuidePending,
  isTryDemoAttentionGuideSeen,
  isTryDemoMessagesGuideStep,
  isTryDemoPropertiesGuideStep,
  isTryDemoResidentsGuideStep,
  isTryDemoVendorsGuideStep,
  isTryDemoUloActivityGuideStep,
  markTryDemoAttentionGuidePending,
  markTryDemoAttentionGuideSeen,
  readTryDemoAttentionGuideActiveStep,
  readTryDemoAttentionGuideVariant,
  startTryDemoAttentionGuideIfPending,
  tryDemoAttentionGuideDisplayPageLabel,
  tryDemoAttentionGuideStartStep,
  TRY_DEMO_ATTENTION_GUIDE_STEP_SETUP_SUCCESS,
  TRY_DEMO_SPOTLIGHT_SETUP_SUCCESS_ID,
  writeTryDemoAttentionGuideActiveStep,
  TRY_DEMO_ATTENTION_GUIDE_STEP_ACTIVE_TASKS,
  TRY_DEMO_ATTENTION_GUIDE_STEP_ASK_ULO,
  TRY_DEMO_ATTENTION_GUIDE_STEP_ASK_ULO_CHATS,
  TRY_DEMO_ATTENTION_GUIDE_STEP_ASK_ULO_DOCKED,
  TRY_DEMO_ATTENTION_GUIDE_STEP_ATTENTION,
  TRY_DEMO_ATTENTION_GUIDE_STEP_MESSAGES,
  TRY_DEMO_ATTENTION_GUIDE_STEP_PORTFOLIO,
  TRY_DEMO_ATTENTION_GUIDE_STEP_PROPERTIES,
  TRY_DEMO_ATTENTION_GUIDE_STEP_RESIDENTS,
  TRY_DEMO_ATTENTION_GUIDE_STEP_VENDORS,
  TRY_DEMO_ATTENTION_GUIDE_STEP_ULO_ACTIVITY,
  TRY_DEMO_ATTENTION_GUIDE_STEP_TOTAL,
  TRY_DEMO_SPOTLIGHT_ACTIVE_TASKS_FIRST_ROW_ID,
  TRY_DEMO_SPOTLIGHT_ASK_ULO_CONTENT_ID,
  TRY_DEMO_SPOTLIGHT_ASK_ULO_ID,
  TRY_DEMO_SPOTLIGHT_ASK_ULO_PANEL_ID,
  TRY_DEMO_SPOTLIGHT_ATTENTION_ID,
  TRY_DEMO_SPOTLIGHT_MESSAGES_KPI_ID,
  TRY_DEMO_SPOTLIGHT_PORTFOLIO_ID,
  TRY_DEMO_SPOTLIGHT_PROPERTIES_SECTION_ID,
  TRY_DEMO_SPOTLIGHT_RESIDENTS_ROWS_ID,
  TRY_DEMO_SPOTLIGHT_VENDORS_ROWS_ID,
  TRY_DEMO_SPOTLIGHT_ULO_ACTIVITY_ID,
  planTryDemoAttentionGuideAdvance,
  tipRouteMatchesLocation,
  isTryDemoTipDestinationReady,
  isTryDemoTipHostReady,
  tryDemoActiveTasksFirstRowColumnId,
  tryDemoAskUloViewModeForStep,
  tryDemoAttentionGuideBody,
  tryDemoAttentionGuideExtraTargetIds,
  tryDemoAttentionGuidePageLabel,
  tryDemoAttentionGuideRouteForStep,
  tryDemoAttentionGuideSeparateHoles,
  tryDemoAttentionGuideSkipHoleClamp,
  tryDemoAttentionGuideTargetId,
  tryDemoAttentionGuideTitle,
  tryDemoAttentionGuideTooltipSide,
  isTryDemoRouteMorphStep,
  withTryDemoTipAnimateSuppress,
  isTryDemoTipAnimateSuppressed,
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

const ASK_ULO_DOCKED_BODY =
  'Move to side to keep working.'

const ASK_ULO_FULL_BODY =
  'Use Ask Ulo in a full view.'

const MESSAGES_BODY =
  'View tenant and vendor texts, with the latest conversations first.'

const ACTIVE_TASKS_BODY =
  'Track repairs, move-ins, move-outs, inspections, and lease tasks from New Intake to Completed. Select a card to view details or take action. The board updates as work progresses.'

const PROPERTIES_BODY =
  'See all your buildings in one place, with a quick view of occupancy, property condition, and maintenance spending. Select a building to explore its details.'

const RESIDENTS_BODY =
  'Manage residents, their units, lease details, and rent in one place. Start or retry their welcome text from Residents.'

const VENDORS_BODY =
  'Manage your vendors and track their setup progress. After adding a vendor, select Setup Vendor to send their verification link.'

const ULO_ACTIVITY_BODY =
  'Select the bell icon to see Ulo’s latest updates—from new repairs and vendor replies to setup progress and failed texts.'

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

  it('starts step 1 only when armed and no tour is running', () => {
    expect(startTryDemoAttentionGuideIfPending()).toBe(false)
    markTryDemoAttentionGuidePending()
    expect(startTryDemoAttentionGuideIfPending()).toBe(true)
    expect(readTryDemoAttentionGuideActiveStep()).toBe(TRY_DEMO_ATTENTION_GUIDE_STEP_ATTENTION)
    expect(isTryDemoAttentionGuidePending()).toBe(false)
    expect(isTryDemoAttentionGuideSeen()).toBe(true)
    // Re-arming mid-tour must not restart it.
    markTryDemoAttentionGuidePending()
    expect(startTryDemoAttentionGuideIfPending()).toBe(false)
  })

  it('post-setup tour starts on the setup card as 1 of 12', () => {
    markTryDemoAttentionGuidePending('setup')
    expect(startTryDemoAttentionGuideIfPending({ setupCardReady: true })).toBe(true)
    expect(readTryDemoAttentionGuideActiveStep()).toBe(TRY_DEMO_ATTENTION_GUIDE_STEP_SETUP_SUCCESS)
    expect(tryDemoAttentionGuideDisplayPageLabel(TRY_DEMO_ATTENTION_GUIDE_STEP_SETUP_SUCCESS)).toBe(
      '1 of 12',
    )
    expect(planTryDemoAttentionGuideAdvance(TRY_DEMO_ATTENTION_GUIDE_STEP_SETUP_SUCCESS)).toEqual({
      kind: 'step',
      step: TRY_DEMO_ATTENTION_GUIDE_STEP_ATTENTION,
    })
  })

  it('post-setup tour skips to Needs Your Attention when the card never appears', () => {
    markTryDemoAttentionGuidePending('setup')
    expect(startTryDemoAttentionGuideIfPending({ setupCardReady: false })).toBe(true)
    expect(readTryDemoAttentionGuideActiveStep()).toBe(TRY_DEMO_ATTENTION_GUIDE_STEP_ATTENTION)
  })

  it('re-arms after a reset clears a previously seen tour', () => {
    markTryDemoAttentionGuidePending()
    startTryDemoAttentionGuideIfPending()
    dismissTryDemoAttentionGuide()
    clearTryDemoAttentionGuide()
    markTryDemoAttentionGuidePending()
    expect(startTryDemoAttentionGuideIfPending()).toBe(true)
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
      ASK_ULO_DOCKED_BODY,
    )
    expect(tryDemoAttentionGuideBody(TRY_DEMO_ATTENTION_GUIDE_STEP_ASK_ULO_CHATS)).toBe(
      ASK_ULO_FULL_BODY,
    )
    expect(tryDemoAttentionGuideTitle(TRY_DEMO_ATTENTION_GUIDE_STEP_MESSAGES)).toBe(
      'Your Conversations in One Place',
    )
    expect(tryDemoAttentionGuideBody(TRY_DEMO_ATTENTION_GUIDE_STEP_MESSAGES)).toBe(MESSAGES_BODY)
    expect(tryDemoAttentionGuideTitle(TRY_DEMO_ATTENTION_GUIDE_STEP_ACTIVE_TASKS)).toBe(
      'Track Every Task’s Progress',
    )
    expect(tryDemoAttentionGuideBody(TRY_DEMO_ATTENTION_GUIDE_STEP_ACTIVE_TASKS)).toBe(
      ACTIVE_TASKS_BODY,
    )
    expect(tryDemoAttentionGuideTitle(TRY_DEMO_ATTENTION_GUIDE_STEP_PROPERTIES)).toBe(
      'Your Buildings at a Glance',
    )
    expect(tryDemoAttentionGuideBody(TRY_DEMO_ATTENTION_GUIDE_STEP_PROPERTIES)).toBe(
      PROPERTIES_BODY,
    )
    expect(tryDemoAttentionGuideTitle(TRY_DEMO_ATTENTION_GUIDE_STEP_RESIDENTS)).toBe(
      'Manage Your Residents',
    )
    expect(tryDemoAttentionGuideBody(TRY_DEMO_ATTENTION_GUIDE_STEP_RESIDENTS)).toBe(
      RESIDENTS_BODY,
    )
    expect(tryDemoAttentionGuideTitle(TRY_DEMO_ATTENTION_GUIDE_STEP_VENDORS)).toBe(
      'Manage Your Vendor Network',
    )
    expect(tryDemoAttentionGuideBody(TRY_DEMO_ATTENTION_GUIDE_STEP_VENDORS)).toBe(VENDORS_BODY)
    expect(tryDemoAttentionGuideTitle(TRY_DEMO_ATTENTION_GUIDE_STEP_ULO_ACTIVITY)).toBe(
      'See Ulo’s Latest Updates',
    )
    expect(tryDemoAttentionGuideBody(TRY_DEMO_ATTENTION_GUIDE_STEP_ULO_ACTIVITY)).toBe(
      ULO_ACTIVITY_BODY,
    )
    expect(isTryDemoAskUloLayoutStep(TRY_DEMO_ATTENTION_GUIDE_STEP_ASK_ULO_DOCKED)).toBe(true)
    expect(isTryDemoAskUloLayoutStep(TRY_DEMO_ATTENTION_GUIDE_STEP_ASK_ULO)).toBe(false)
    expect(isTryDemoMessagesGuideStep(TRY_DEMO_ATTENTION_GUIDE_STEP_MESSAGES)).toBe(true)
    expect(tryDemoAttentionGuideTooltipSide(TRY_DEMO_ATTENTION_GUIDE_STEP_ASK_ULO_DOCKED)).toBe(
      'left',
    )
    expect(tryDemoAttentionGuideTooltipSide(TRY_DEMO_ATTENTION_GUIDE_STEP_MESSAGES)).toBe('left')
    expect(tryDemoAttentionGuideTooltipSide(TRY_DEMO_ATTENTION_GUIDE_STEP_RESIDENTS)).toBe('left')
    expect(tryDemoAttentionGuideTooltipSide(TRY_DEMO_ATTENTION_GUIDE_STEP_VENDORS)).toBe('left')
    expect(tryDemoAttentionGuideTooltipSide(TRY_DEMO_ATTENTION_GUIDE_STEP_ULO_ACTIVITY)).toBe('left')
    expect(tryDemoAttentionGuideTooltipSide(TRY_DEMO_ATTENTION_GUIDE_STEP_ATTENTION)).toBe('auto')
    expect(isTryDemoRouteMorphStep(TRY_DEMO_ATTENTION_GUIDE_STEP_MESSAGES)).toBe(true)
    expect(isTryDemoRouteMorphStep(TRY_DEMO_ATTENTION_GUIDE_STEP_ACTIVE_TASKS)).toBe(true)
    expect(isTryDemoRouteMorphStep(TRY_DEMO_ATTENTION_GUIDE_STEP_PROPERTIES)).toBe(true)
    expect(isTryDemoRouteMorphStep(TRY_DEMO_ATTENTION_GUIDE_STEP_RESIDENTS)).toBe(true)
    expect(isTryDemoRouteMorphStep(TRY_DEMO_ATTENTION_GUIDE_STEP_VENDORS)).toBe(true)
    expect(isTryDemoRouteMorphStep(TRY_DEMO_ATTENTION_GUIDE_STEP_ULO_ACTIVITY)).toBe(true)
    expect(isTryDemoRouteMorphStep(TRY_DEMO_ATTENTION_GUIDE_STEP_ATTENTION)).toBe(false)
    expect(isTryDemoActiveTasksGuideStep(TRY_DEMO_ATTENTION_GUIDE_STEP_ACTIVE_TASKS)).toBe(true)
    expect(isTryDemoPropertiesGuideStep(TRY_DEMO_ATTENTION_GUIDE_STEP_PROPERTIES)).toBe(true)
    expect(isTryDemoResidentsGuideStep(TRY_DEMO_ATTENTION_GUIDE_STEP_RESIDENTS)).toBe(true)
    expect(isTryDemoVendorsGuideStep(TRY_DEMO_ATTENTION_GUIDE_STEP_VENDORS)).toBe(true)
    expect(isTryDemoUloActivityGuideStep(TRY_DEMO_ATTENTION_GUIDE_STEP_ULO_ACTIVITY)).toBe(true)
    expect(tryDemoAttentionGuideTargetId(TRY_DEMO_ATTENTION_GUIDE_STEP_ATTENTION)).toBe(
      TRY_DEMO_SPOTLIGHT_ATTENTION_ID,
    )
    expect(tryDemoAttentionGuideTargetId(TRY_DEMO_ATTENTION_GUIDE_STEP_PORTFOLIO)).toBe(
      TRY_DEMO_SPOTLIGHT_PORTFOLIO_ID,
    )
    expect(tryDemoAttentionGuideTargetId(TRY_DEMO_ATTENTION_GUIDE_STEP_ASK_ULO)).toBe(
      TRY_DEMO_SPOTLIGHT_ASK_ULO_ID,
    )
    expect(tryDemoAttentionGuideTargetId(TRY_DEMO_ATTENTION_GUIDE_STEP_ASK_ULO_DOCKED)).toBe(
      TRY_DEMO_SPOTLIGHT_ASK_ULO_PANEL_ID,
    )
    expect(tryDemoAttentionGuideTargetId(TRY_DEMO_ATTENTION_GUIDE_STEP_ASK_ULO_CHATS)).toBe(
      TRY_DEMO_SPOTLIGHT_ASK_ULO_CONTENT_ID,
    )
    expect(tryDemoAttentionGuideTargetId(TRY_DEMO_ATTENTION_GUIDE_STEP_MESSAGES)).toBe(
      TRY_DEMO_SPOTLIGHT_MESSAGES_KPI_ID,
    )
    expect(tryDemoAttentionGuideTargetId(TRY_DEMO_ATTENTION_GUIDE_STEP_ACTIVE_TASKS)).toBe(
      TRY_DEMO_SPOTLIGHT_ACTIVE_TASKS_FIRST_ROW_ID,
    )
    expect(tryDemoAttentionGuideTargetId(TRY_DEMO_ATTENTION_GUIDE_STEP_PROPERTIES)).toBe(
      TRY_DEMO_SPOTLIGHT_PROPERTIES_SECTION_ID,
    )
    expect(tryDemoAttentionGuideTargetId(TRY_DEMO_ATTENTION_GUIDE_STEP_RESIDENTS)).toBe(
      TRY_DEMO_SPOTLIGHT_RESIDENTS_ROWS_ID,
    )
    expect(tryDemoAttentionGuideTargetId(TRY_DEMO_ATTENTION_GUIDE_STEP_VENDORS)).toBe(
      TRY_DEMO_SPOTLIGHT_VENDORS_ROWS_ID,
    )
    expect(tryDemoAttentionGuideTargetId(TRY_DEMO_ATTENTION_GUIDE_STEP_ULO_ACTIVITY)).toBe(
      TRY_DEMO_SPOTLIGHT_ULO_ACTIVITY_ID,
    )
    expect(tryDemoAttentionGuideExtraTargetIds(TRY_DEMO_ATTENTION_GUIDE_STEP_ASK_ULO_CHATS)).toEqual(
      [],
    )
    expect(tryDemoAttentionGuideExtraTargetIds(TRY_DEMO_ATTENTION_GUIDE_STEP_MESSAGES)).toEqual(
      [],
    )
    expect(tryDemoAttentionGuideExtraTargetIds(TRY_DEMO_ATTENTION_GUIDE_STEP_ACTIVE_TASKS)).toEqual([
      tryDemoActiveTasksFirstRowColumnId(1),
      tryDemoActiveTasksFirstRowColumnId(2),
      tryDemoActiveTasksFirstRowColumnId(3),
    ])
    expect(tryDemoAttentionGuideExtraTargetIds(TRY_DEMO_ATTENTION_GUIDE_STEP_RESIDENTS)).toEqual(
      [],
    )
    expect(tryDemoAttentionGuideExtraTargetIds(TRY_DEMO_ATTENTION_GUIDE_STEP_VENDORS)).toEqual([])
    expect(tryDemoAttentionGuideExtraTargetIds(TRY_DEMO_ATTENTION_GUIDE_STEP_ULO_ACTIVITY)).toEqual(
      [],
    )
    expect(tryDemoAttentionGuideSkipHoleClamp(TRY_DEMO_ATTENTION_GUIDE_STEP_ASK_ULO_CHATS)).toBe(
      true,
    )
    expect(tryDemoAttentionGuideSkipHoleClamp(TRY_DEMO_ATTENTION_GUIDE_STEP_ASK_ULO_DOCKED)).toBe(
      false,
    )
    expect(tryDemoAttentionGuideSkipHoleClamp(TRY_DEMO_ATTENTION_GUIDE_STEP_ACTIVE_TASKS)).toBe(
      true,
    )
    expect(tryDemoAttentionGuideSkipHoleClamp(TRY_DEMO_ATTENTION_GUIDE_STEP_PROPERTIES)).toBe(
      true,
    )
    expect(tryDemoAttentionGuideSkipHoleClamp(TRY_DEMO_ATTENTION_GUIDE_STEP_RESIDENTS)).toBe(true)
    expect(tryDemoAttentionGuideSkipHoleClamp(TRY_DEMO_ATTENTION_GUIDE_STEP_VENDORS)).toBe(true)
    expect(tryDemoAttentionGuideSkipHoleClamp(TRY_DEMO_ATTENTION_GUIDE_STEP_ULO_ACTIVITY)).toBe(
      true,
    )
    expect(tryDemoAttentionGuideSeparateHoles(TRY_DEMO_ATTENTION_GUIDE_STEP_MESSAGES)).toBe(false)
    expect(tryDemoAttentionGuideSeparateHoles(TRY_DEMO_ATTENTION_GUIDE_STEP_ACTIVE_TASKS)).toBe(
      false,
    )
    expect(tryDemoAttentionGuideSeparateHoles(TRY_DEMO_ATTENTION_GUIDE_STEP_ASK_ULO_CHATS)).toBe(
      false,
    )
    expect(
      tryDemoAttentionGuidePageLabel(
        TRY_DEMO_ATTENTION_GUIDE_STEP_ATTENTION,
        TRY_DEMO_ATTENTION_GUIDE_STEP_TOTAL,
      ),
    ).toBe('1 of 11')
    expect(
      tryDemoAttentionGuidePageLabel(
        TRY_DEMO_ATTENTION_GUIDE_STEP_MESSAGES,
        TRY_DEMO_ATTENTION_GUIDE_STEP_TOTAL,
      ),
    ).toBe('6 of 11')
    expect(
      tryDemoAttentionGuidePageLabel(
        TRY_DEMO_ATTENTION_GUIDE_STEP_ACTIVE_TASKS,
        TRY_DEMO_ATTENTION_GUIDE_STEP_TOTAL,
      ),
    ).toBe('7 of 11')
    expect(
      tryDemoAttentionGuidePageLabel(
        TRY_DEMO_ATTENTION_GUIDE_STEP_PROPERTIES,
        TRY_DEMO_ATTENTION_GUIDE_STEP_TOTAL,
      ),
    ).toBe('8 of 11')
    expect(
      tryDemoAttentionGuidePageLabel(
        TRY_DEMO_ATTENTION_GUIDE_STEP_RESIDENTS,
        TRY_DEMO_ATTENTION_GUIDE_STEP_TOTAL,
      ),
    ).toBe('9 of 11')
    expect(
      tryDemoAttentionGuidePageLabel(
        TRY_DEMO_ATTENTION_GUIDE_STEP_VENDORS,
        TRY_DEMO_ATTENTION_GUIDE_STEP_TOTAL,
      ),
    ).toBe('10 of 11')
    expect(
      tryDemoAttentionGuidePageLabel(
        TRY_DEMO_ATTENTION_GUIDE_STEP_ULO_ACTIVITY,
        TRY_DEMO_ATTENTION_GUIDE_STEP_TOTAL,
      ),
    ).toBe('11 of 11')
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

  it('only tip steps 4–5 allow Ask Ulo setDocked shell sync', () => {
    expect(isTryDemoAskUloShellSyncStep(TRY_DEMO_ATTENTION_GUIDE_STEP_ASK_ULO_DOCKED)).toBe(true)
    expect(isTryDemoAskUloShellSyncStep(TRY_DEMO_ATTENTION_GUIDE_STEP_ASK_ULO_CHATS)).toBe(true)
    expect(isTryDemoAskUloShellSyncStep(TRY_DEMO_ATTENTION_GUIDE_STEP_MESSAGES)).toBe(false)
    expect(isTryDemoAskUloShellSyncStep(TRY_DEMO_ATTENTION_GUIDE_STEP_ASK_ULO)).toBe(false)
    expect(isTryDemoAskUloShellSyncStep(null)).toBe(false)
  })

  it('maps tip steps to Ask Ulo view modes', () => {
    expect(tryDemoAskUloViewModeForStep(TRY_DEMO_ATTENTION_GUIDE_STEP_ASK_ULO)).toBe(null)
    expect(tryDemoAskUloViewModeForStep(TRY_DEMO_ATTENTION_GUIDE_STEP_ASK_ULO_DOCKED)).toBe(
      'docked',
    )
    expect(tryDemoAskUloViewModeForStep(TRY_DEMO_ATTENTION_GUIDE_STEP_ASK_ULO_CHATS)).toBe(
      'full',
    )
    expect(tryDemoAskUloViewModeForStep(TRY_DEMO_ATTENTION_GUIDE_STEP_MESSAGES)).toBe(null)
    expect(tryDemoAskUloViewModeForStep(TRY_DEMO_ATTENTION_GUIDE_STEP_ACTIVE_TASKS)).toBe(null)
    expect(tryDemoAskUloViewModeForStep(TRY_DEMO_ATTENTION_GUIDE_STEP_PROPERTIES)).toBe(null)
    expect(tryDemoAskUloViewModeForStep(TRY_DEMO_ATTENTION_GUIDE_STEP_RESIDENTS)).toBe(null)
    expect(tryDemoAskUloViewModeForStep(TRY_DEMO_ATTENTION_GUIDE_STEP_VENDORS)).toBe(null)
    expect(tryDemoAskUloViewModeForStep(TRY_DEMO_ATTENTION_GUIDE_STEP_ULO_ACTIVITY)).toBe(null)
  })

  it('post-setup guide starts on the setup card as step 1 of 12', () => {
    markTryDemoAttentionGuidePending('setup')
    expect(readTryDemoAttentionGuideVariant()).toBe('setup')
    expect(tryDemoAttentionGuideStartStep()).toBe(TRY_DEMO_ATTENTION_GUIDE_STEP_SETUP_SUCCESS)
    expect(tryDemoAttentionGuideTitle(TRY_DEMO_ATTENTION_GUIDE_STEP_SETUP_SUCCESS)).toBe(
      'Stay Ahead of Property Problems',
    )
    expect(tryDemoAttentionGuideBody(TRY_DEMO_ATTENTION_GUIDE_STEP_SETUP_SUCCESS)).toBe(
      'Finish these steps to help Ulo move your properties from reacting to problems to staying ahead of them.',
    )
    expect(tryDemoAttentionGuideTargetId(TRY_DEMO_ATTENTION_GUIDE_STEP_SETUP_SUCCESS)).toBe(
      TRY_DEMO_SPOTLIGHT_SETUP_SUCCESS_ID,
    )
    expect(tryDemoAttentionGuideRouteForStep(TRY_DEMO_ATTENTION_GUIDE_STEP_SETUP_SUCCESS)).toBe(
      '/admin',
    )
    expect(
      tryDemoAttentionGuideDisplayPageLabel(TRY_DEMO_ATTENTION_GUIDE_STEP_SETUP_SUCCESS),
    ).toBe('1 of 12')
    expect(tryDemoAttentionGuideDisplayPageLabel(TRY_DEMO_ATTENTION_GUIDE_STEP_ATTENTION)).toBe(
      '2 of 12',
    )
    expect(tryDemoAttentionGuideDisplayPageLabel(TRY_DEMO_ATTENTION_GUIDE_STEP_ULO_ACTIVITY)).toBe(
      '12 of 12',
    )
    expect(planTryDemoAttentionGuideAdvance(TRY_DEMO_ATTENTION_GUIDE_STEP_SETUP_SUCCESS)).toEqual({
      kind: 'step',
      step: TRY_DEMO_ATTENTION_GUIDE_STEP_ATTENTION,
    })
    markTryDemoAttentionGuidePending()
    expect(readTryDemoAttentionGuideVariant()).toBe('demo')
    expect(tryDemoAttentionGuideStartStep()).toBe(TRY_DEMO_ATTENTION_GUIDE_STEP_ATTENTION)
    expect(tryDemoAttentionGuideDisplayPageLabel(TRY_DEMO_ATTENTION_GUIDE_STEP_ATTENTION)).toBe(
      '1 of 11',
    )
  })

  it('plans Next advances and expected routes', () => {
    expect(planTryDemoAttentionGuideAdvance(TRY_DEMO_ATTENTION_GUIDE_STEP_ATTENTION)).toEqual({
      kind: 'step',
      step: TRY_DEMO_ATTENTION_GUIDE_STEP_PORTFOLIO,
    })
    expect(planTryDemoAttentionGuideAdvance(TRY_DEMO_ATTENTION_GUIDE_STEP_ASK_ULO_CHATS)).toEqual({
      kind: 'step',
      step: TRY_DEMO_ATTENTION_GUIDE_STEP_MESSAGES,
      askUlo: 'close-to',
      navigateTo: '/admin/communication',
    })
    expect(planTryDemoAttentionGuideAdvance(TRY_DEMO_ATTENTION_GUIDE_STEP_MESSAGES)).toEqual({
      kind: 'step',
      step: TRY_DEMO_ATTENTION_GUIDE_STEP_ACTIVE_TASKS,
      navigateTo: '/admin/workflows',
    })
    expect(planTryDemoAttentionGuideAdvance(TRY_DEMO_ATTENTION_GUIDE_STEP_ACTIVE_TASKS)).toEqual({
      kind: 'step',
      step: TRY_DEMO_ATTENTION_GUIDE_STEP_PROPERTIES,
      navigateTo: '/admin',
    })
    expect(planTryDemoAttentionGuideAdvance(TRY_DEMO_ATTENTION_GUIDE_STEP_PROPERTIES)).toEqual({
      kind: 'step',
      step: TRY_DEMO_ATTENTION_GUIDE_STEP_RESIDENTS,
      navigateTo: '/admin/residents',
    })
    expect(planTryDemoAttentionGuideAdvance(TRY_DEMO_ATTENTION_GUIDE_STEP_RESIDENTS)).toEqual({
      kind: 'step',
      step: TRY_DEMO_ATTENTION_GUIDE_STEP_VENDORS,
      navigateTo: '/admin/vendors',
    })
    expect(planTryDemoAttentionGuideAdvance(TRY_DEMO_ATTENTION_GUIDE_STEP_VENDORS)).toEqual({
      kind: 'step',
      step: TRY_DEMO_ATTENTION_GUIDE_STEP_ULO_ACTIVITY,
      navigateTo: '/admin',
    })
    expect(planTryDemoAttentionGuideAdvance(TRY_DEMO_ATTENTION_GUIDE_STEP_ULO_ACTIVITY)).toEqual({
      kind: 'done',
    })
    expect(tryDemoAttentionGuideRouteForStep(TRY_DEMO_ATTENTION_GUIDE_STEP_ATTENTION)).toBe(
      '/admin',
    )
    expect(tryDemoAttentionGuideRouteForStep(TRY_DEMO_ATTENTION_GUIDE_STEP_MESSAGES)).toBe(
      '/admin/communication',
    )
    expect(tryDemoAttentionGuideRouteForStep(TRY_DEMO_ATTENTION_GUIDE_STEP_ACTIVE_TASKS)).toBe(
      '/admin/workflows',
    )
    expect(tryDemoAttentionGuideRouteForStep(TRY_DEMO_ATTENTION_GUIDE_STEP_PROPERTIES)).toBe(
      '/admin',
    )
    expect(tryDemoAttentionGuideRouteForStep(TRY_DEMO_ATTENTION_GUIDE_STEP_RESIDENTS)).toBe(
      '/admin/residents',
    )
    expect(tryDemoAttentionGuideRouteForStep(TRY_DEMO_ATTENTION_GUIDE_STEP_VENDORS)).toBe(
      '/admin/vendors',
    )
    expect(tryDemoAttentionGuideRouteForStep(TRY_DEMO_ATTENTION_GUIDE_STEP_ULO_ACTIVITY)).toBe(
      '/admin',
    )
    // `/admin` must not match nested admin pages (step 8/9/11 stranding).
    expect(tipRouteMatchesLocation('/admin', '/admin')).toBe(true)
    expect(tipRouteMatchesLocation('/admin/', '/admin')).toBe(true)
    expect(tipRouteMatchesLocation('/admin/residents', '/admin')).toBe(false)
    expect(tipRouteMatchesLocation('/admin/vendors', '/admin')).toBe(false)
    expect(tipRouteMatchesLocation('/admin/communication', '/admin')).toBe(false)
    expect(tipRouteMatchesLocation('/admin/residents', '/admin/residents')).toBe(true)
    expect(tipRouteMatchesLocation('/admin/residents/abc', '/admin/residents')).toBe(true)
    expect(tipRouteMatchesLocation('/admin', '/admin/residents')).toBe(false)
  })

  it('destination ready requires the expected route before host checks', () => {
    expect(isTryDemoTipHostReady(null)).toBe(true)
    expect(isTryDemoTipDestinationReady(TRY_DEMO_ATTENTION_GUIDE_STEP_MESSAGES, '/admin')).toBe(
      false,
    )
    expect(
      isTryDemoTipDestinationReady(TRY_DEMO_ATTENTION_GUIDE_STEP_RESIDENTS, '/admin/vendors'),
    ).toBe(false)
    // Right route but host not in DOM → not ready (prevents early morph/copy).
    expect(
      isTryDemoTipDestinationReady(
        TRY_DEMO_ATTENTION_GUIDE_STEP_MESSAGES,
        '/admin/communication',
      ),
    ).toBe(false)
    expect(
      isTryDemoTipDestinationReady(TRY_DEMO_ATTENTION_GUIDE_STEP_RESIDENTS, '/admin/residents'),
    ).toBe(false)
  })

  it('suppresses Ask Ulo View Transitions while tip advances own the motion', () => {
    expect(isTryDemoTipAnimateSuppressed()).toBe(false)
    const result = withTryDemoTipAnimateSuppress(() => {
      expect(isTryDemoTipAnimateSuppressed()).toBe(true)
      return 'ok'
    })
    expect(result).toBe('ok')
    expect(isTryDemoTipAnimateSuppressed()).toBe(false)
  })
})
