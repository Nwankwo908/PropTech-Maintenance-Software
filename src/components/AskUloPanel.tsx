import { useEffect, useId, useRef, useState, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import sandboxLogo from '@/assets/landing/sandbox_logo.svg'
import regenerateIcon from '@/assets/ask-ulo-regenerate.png'
import copyIcon from '@/assets/noun-copy.png'
import { LANDING_DOCUMENT_IMPORT_ICONS } from '@/components/landing/LandingIcons'
import { ASK_ULO_OVERRIDE_REASON_OPTIONS, postAskUlo, postAskUloCounselHandoff, postAskUloFeedback, type AskUloAnswerConfidence, type AskUloCitation, type AskUloCounselExpertRoleId, type AskUloJurisdiction, type AskUloLegalAudit, type AskUloOverrideReason, type AskUloSafetyBoundary, type AskUloVisualContext } from '@/api/askUlo'
import { useAskUlo } from '@/components/AskUloContext'
import { AskUloHistoryAnswer } from '@/components/AskUloHistoryAnswer'
import { AskUloMarkdown } from '@/components/AskUloMarkdown'
import { AskUloMarketAnswer } from '@/components/AskUloMarketAnswer'
import { getActiveLandlordId } from '@/lib/activeLandlord'
import {
  appendAskUloMessage,
  ensureAskUloConversationForPrompt,
  loadAskUloMessages,
} from '@/lib/askUloConversations'
import { askUloLoadingMessagesForPrompt } from '@/lib/askUloLoadingCopy'
import { streamAskUloAnswer } from '@/lib/askUloStreamText'

type AskUloPanelProps = {
  onClose: () => void
  /** Full takeover of the main content area, or slim right-rail beside the dashboard. */
  variant?: 'full' | 'rail'
}

type ChatMessage = {
  id: string
  role: 'user' | 'assistant'
  text: string
  citations?: AskUloCitation[]
  visualContext?: AskUloVisualContext | null
  jurisdiction?: AskUloJurisdiction | null
  legalAudit?: AskUloLegalAudit | null
  safetyBoundary?: AskUloSafetyBoundary | null
  intent?: string | null
  mode?: 'openai' | 'fallback'
  /** Continuous-eval row id (feedback / override metrics). */
  evalId?: string | null
  error?: boolean
  /** Waiting on the API — show contextual understanding status. */
  pending?: boolean
  /** Client-side text stream in progress. */
  streaming?: boolean
  /** Fresh answer (not restored history) — enable progressive rich media. */
  liveReveal?: boolean
  /** Stream + rich reveal finished — show message actions. */
  complete?: boolean
  /** Client: human review already flagged for this answer. */
  counselHandoffDone?: boolean
}

/** Drop redundant "## Sources Used" blocks — citations live under Compliance & References. */
function stripSourcesUsedSection(markdown: string): string {
  return markdown
    .replace(/\n*##\s*Sources Used\b[\s\S]*?(?=\n##\s|\n*$)/gi, '')
    .trimEnd()
}

const SUGGESTIONS: Array<{ id: string; prompt: string; icon: 'attention' | 'money' | 'wrench' | 'user' }> = [
  { id: 'attention', prompt: 'What needs my attention right now?', icon: 'attention' },
  { id: 'market', prompt: 'How do my rents compare to the local market?', icon: 'money' },
  { id: 'maintenance', prompt: 'Summarize open maintenance across my portfolio', icon: 'wrench' },
  { id: 'renewal', prompt: 'Which leases are coming up for renewal?', icon: 'user' },
]

type AskUloAgentMode =
  | 'ulo_agent'
  | 'legal_insights'
  | 'financial_insights'
  | 'maintenance_pro'
  | 'market_intelligence'

const ASK_ULO_AGENT_MODES: Array<{ id: AskUloAgentMode; label: string; description: string }> = [
  {
    id: 'ulo_agent',
    label: 'Ulo Agent',
    description: 'All property intelligence in one',
  },
  {
    id: 'legal_insights',
    label: 'Legal Insights',
    description: 'Primary Legal Sources & Housing Codes',
  },
  {
    id: 'financial_insights',
    label: 'Financial Insights',
    description: 'Rental Market and Comparable Pricing',
  },
  {
    id: 'maintenance_pro',
    label: 'Maintenance Pro',
    description: 'Property operations and Maintenance',
  },
  {
    id: 'market_intelligence',
    label: 'Market Intelligence',
    description: 'Comps, rents, and neighborhood trends',
  },
]

function agentModeLabel(mode: AskUloAgentMode): string {
  return ASK_ULO_AGENT_MODES.find((m) => m.id === mode)?.label ?? 'Agent'
}

function UloAgentModeGlyph({ className = 'size-3.5' }: { className?: string }) {
  return (
    <svg className={`shrink-0 ${className}`} viewBox="0 0 100 100" fill="currentColor" aria-hidden>
      <path d="M50,68.6A19.34,19.34,0,0,0,65.9,60.22a3.88,3.88,0,0,0,.48,0,3.94,3.94,0,0,0,2.52-7A19.35,19.35,0,1,0,50,68.6Zm0-35.71a16.33,16.33,0,0,1,16,19.5,3.92,3.92,0,0,0-2.75,6.34A16.35,16.35,0,1,1,50,32.89Zm0,50.59A34.22,34.22,0,0,0,67.83,20.05a3.87,3.87,0,0,0,0-.43,3.95,3.95,0,0,0-6.79-2.75A34.23,34.23,0,1,0,50,83.48ZM50,18a31.09,31.09,0,0,1,10,1.65,4,4,0,0,0,4,3.92,3.92,3.92,0,0,0,2.47-.89A31.21,31.21,0,1,1,50,18ZM91.5,49.25a1.5,1.5,0,0,1-3,0,38.47,38.47,0,0,0-1.9-12,1.5,1.5,0,0,1,2.85-.93A41.46,41.46,0,0,1,91.5,49.25ZM88.65,64.4a41.54,41.54,0,0,1-14.1,18.32,1.5,1.5,0,1,1-1.78-2.42,38.55,38.55,0,0,0,13.08-17,1.5,1.5,0,0,1,2.79,1.1ZM55.93,88.86a1.5,1.5,0,0,1-1.33,1.66,42.16,42.16,0,0,1-4.63.25A41.57,41.57,0,0,1,29.22,85.2a3.92,3.92,0,0,1-6.07-4.28,41.36,41.36,0,0,1-3.93-3.78,1.5,1.5,0,0,1,2.22-2A38.36,38.36,0,0,0,25,78.55,3.91,3.91,0,0,1,26.94,78a3.91,3.91,0,0,1,3.89,4.64A38.57,38.57,0,0,0,50,87.77a39.3,39.3,0,0,0,4.3-.24A1.5,1.5,0,0,1,55.93,88.86ZM13,38.58A38.57,38.57,0,0,0,11.5,47.4,1.5,1.5,0,0,1,10,48.83H9.93A1.5,1.5,0,0,1,8.5,47.26a41.49,41.49,0,0,1,1.57-9.51,1.5,1.5,0,1,1,2.88.83ZM18.49,24.5a1.5,1.5,0,0,1-.17-2.11A41.5,41.5,0,0,1,38.65,9.29a1.5,1.5,0,0,1,.82,2.89A38.5,38.5,0,0,0,20.6,24.33a1.5,1.5,0,0,1-2.11.17Zm53.3-8.85a1.5,1.5,0,0,1,2.09-.36A42,42,0,0,1,85.74,28.13a1.5,1.5,0,1,1-2.58,1.53,39,39,0,0,0-11-11.92A1.5,1.5,0,0,1,71.78,15.65ZM50,75.84A26.59,26.59,0,1,0,26.78,36.25l-.22,0a3.94,3.94,0,0,0-2.49,7A26.57,26.57,0,0,0,50,75.84Zm0-50.19A23.61,23.61,0,1,1,27,44.1a3.92,3.92,0,0,0,2.54-6.55A23.6,23.6,0,0,1,50,25.65Zm0,31a7.45,7.45,0,1,0-7.45-7.45A7.46,7.46,0,0,0,50,56.7Zm0-11.9a4.45,4.45,0,1,1-4.45,4.45A4.46,4.46,0,0,1,50,44.79Z" />
    </svg>
  )
}

function LegalInsightsModeGlyph({ className = 'size-3.5' }: { className?: string }) {
  return (
    <svg className={`shrink-0 ${className}`} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M20.70471,9.37738,18.65814,5.96649a.49613.49613,0,0,0-.27044-.95379l-13,3a.50017.50017,0,0,0-.375.5996.49475.49475,0,0,0,.39654.37232l-2.0357,3.39276a1.95256,1.95256,0,0,0-.17908,1.68738,3.00123,3.00123,0,0,0,5.61108,0,1.95256,1.95256,0,0,0-.17908-1.68738L6.47321,8.78864,11.5,7.6286V18h-3a.5.5,0,0,0,0,1h7a.5.5,0,0,0,0-1h-3V7.39783l4.80481-1.10877-1.853,3.08832a1.95259,1.95259,0,0,0-.17907,1.68738,3.00123,3.00123,0,0,0,5.61108,0A1.95259,1.95259,0,0,0,20.70471,9.37738ZM7.54279,13.25085H4.45721a.25.25,0,0,1-.21435-.3786L6,9.94366l1.75714,2.92859A.25.25,0,0,1,7.54279,13.25085Zm12.07824-3H16.53546a.25.25,0,0,1-.21435-.3786l1.75714-2.92859,1.75714,2.92859A.25.25,0,0,1,19.621,10.25085Z" />
    </svg>
  )
}

function FinancialInsightsModeGlyph({ className = 'size-3.5' }: { className?: string }) {
  return (
    <svg className={`shrink-0 ${className}`} viewBox="0 0 72 72" fill="currentColor" aria-hidden>
      <path d="M34.8,59.1h3.1c0.2,0,0.4-0.2,0.4-0.4v-4.1c0-0.2,0.1-0.3,0.3-0.4c2.8-0.3,5.1-1.3,6.7-3   c1.7-1.7,2.6-3.9,2.6-6.8c0-2.9-0.9-5.1-2.6-6.7c-1.7-1.6-4.4-3.1-8-4.5c-1.9-0.8-3.3-1.5-4-2.3c-0.7-0.8-1.1-1.8-1.1-3.1   c0-1.3,0.3-2.4,1-3.2c0.7-0.8,1.7-1.2,3.1-1.2c1.3,0,2.4,0.5,3.2,1.6c0.7,0.9,1.1,2.3,1.2,3.9c0,0.3,0.2,0.5,0.5,0.5h5.9   c0.3,0,0.6-0.3,0.6-0.6c0,0,0-0.1,0-0.1c-0.1-2.9-0.9-5.2-2.4-7c-1.6-1.9-3.7-3-6.4-3.5c-0.2,0-0.4-0.2-0.4-0.4v-4.5   c0-0.2-0.2-0.4-0.4-0.4h-3c-0.2,0-0.4,0.2-0.4,0.4v4.4c0,0.2-0.2,0.4-0.4,0.4c-2.8,0.4-5,1.4-6.7,3c-1.7,1.7-2.6,4-2.6,6.7   c0,2.9,0.9,5.2,2.6,6.8c1.7,1.6,4.4,3.1,8,4.4c1.8,0.7,3.1,1.5,3.9,2.3c0.8,0.8,1.1,1.9,1.1,3.2c0,1.3-0.4,2.4-1.2,3.2   c-0.8,0.8-1.9,1.2-3.4,1.2c-1.5,0-2.8-0.5-3.8-1.4c-1-0.9-1.5-2.3-1.5-4.3c0-0.2-0.2-0.3-0.3-0.3h-6.3c-0.2,0-0.3,0.2-0.3,0.3   c0,0.3,0,0.8,0,1c0.2,3,1.1,5.3,2.9,6.9c1.9,1.8,4.3,2.8,7.2,3.2c0.2,0,0.3,0.2,0.3,0.4v4.1C34.4,59,34.6,59.1,34.8,59.1z" />
      <path d="M36,4.4c7.3,0,14.1,2.4,19.8,6.9h-4.3c-1.1,0-2,0.9-2,2s0.9,2,2,2h9.3c1.1,0,2-0.9,2-2V4c0-1.1-0.9-2-2-2   s-2,0.9-2,2l0.1,4.9C52.5,3.5,44.4,0.5,36,0.5C16.4,0.5,0.5,16.4,0.5,36c0,1.1,0.9,2,2,2s2-0.9,2-2C4.4,18.6,18.6,4.4,36,4.4z" />
      <path d="M69.5,34c-1.1,0-2,0.9-2,2c0,17.4-14.2,31.6-31.6,31.6c-7.4,0-14.5-2.6-20.2-7.3h4.3c1.1,0,2-0.9,2-2   s-0.9-2-2-2h-9.3c-1.1,0-2,0.9-2,2v9.3c0,1.1,0.9,2,2,2s2-0.9,2-2v-4.7c6.4,5.6,14.7,8.6,23.2,8.6c19.6,0,35.5-15.9,35.5-35.5   C71.5,34.9,70.6,34,69.5,34z" />
    </svg>
  )
}

function MaintenanceProModeGlyph({ className = 'size-3.5' }: { className?: string }) {
  return (
    <svg className={`shrink-0 ${className}`} viewBox="-5 -10 110 110" fill="currentColor" aria-hidden>
      <path d="m11.461 73.871c0.33984 0.55078 0.17187 1.2617-0.37109 1.6016-0.19141 0.12109-0.39844 0.17188-0.60938 0.17188-0.39062 0-0.76953-0.19141-0.98828-0.55078-4.6836-7.5156-7.1406-16.195-7.1406-25.094 0-12.73 4.9609-24.699 13.961-33.699s20.969-13.961 33.699-13.961c6.7383 0 13.262 1.3789 19.379 4.1016 5.2617 2.3398 9.9805 5.5703 14.07 9.6094v-4.1406c0-0.64062 0.51953-1.1602 1.1602-1.1602s1.1602 0.51953 1.1602 1.1602v6.9492c0 0.64062-0.51953 1.1602-1.1602 1.1602h-6.9492c-0.64062 0-1.1602-0.51953-1.1602-1.1602s0.51953-1.1602 1.1602-1.1602h4.1406c-8.4531-8.3008-19.934-13.027-31.812-13.027-24.988 0-45.328 20.34-45.328 45.328 0 8.4609 2.3477 16.719 6.7891 23.871zm79.059-48.973c-0.33984-0.55078-1.0586-0.71094-1.6016-0.37109-0.55078 0.33984-0.71094 1.0586-0.37109 1.6016 4.4414 7.1484 6.7891 15.41 6.7891 23.871 0 24.988-20.328 45.328-45.328 45.328-11.891 0-23.359-4.7188-31.801-13.031h4.1406c0.64062 0 1.1602-0.51953 1.1602-1.1602s-0.51953-1.1602-1.1602-1.1602h-6.9492c-0.64063 0-1.1602 0.51953-1.1602 1.1602v6.9492c0 0.64062 0.51953 1.1602 1.1602 1.1602 0.64062 0 1.1602-0.51953 1.1602-1.1602v-4.1406c4.0703 4.0117 8.7617 7.2305 13.988 9.5703 6.1406 2.75 12.68 4.1406 19.461 4.1406 12.73 0 24.699-4.9609 33.699-13.961s13.961-20.969 13.961-33.699c-0.019531-8.8945-2.4766-17.574-7.1484-25.098zm-27.359 21.551-3.8906 3.8906c0.019531 0.17188 0.050781 0.33984 0.050781 0.51953 0 0.28125-0.039062 0.55078-0.10156 0.82031 1.6602 0.89844 3.2695 1.0195 5.4102 1.0586 0.30078 0.011719 0.57812 0.12891 0.78906 0.33984l10.441 10.441c1.8789 1.8789 2.8008 4.1484 2.6484 6.5508-0.12891 2.1094-1.0898 4.1602-2.6914 5.7617-1.6016 1.6016-3.6484 2.5586-5.7617 2.6914-0.17188 0.011718-0.33984 0.019531-0.51172 0.019531-2.2109 0-4.2891-0.91016-6.0391-2.6719l-10.426-10.441c-0.21094-0.21094-0.32812-0.5-0.33984-0.80078-0.050781-2.1406-0.16016-3.75-1.0586-5.4102-0.26953 0.058594-0.53906 0.10156-0.82031 0.10156-0.17188 0-0.35156-0.03125-0.51953-0.050781l-17.281 17.281c-1.2812 1.2812-2.9805 1.9805-4.8008 1.9805-1.8203 0-3.5312-0.69922-4.8008-1.9805-2.6484-2.6484-2.6484-6.9609 0-9.6094l18.93-18.93-10.086-10.07-4.1484-1.3789c-0.44922-0.14844-0.80859-0.42188-1.0703-0.80859l-5.25-7.6914c-0.57031-0.82812-0.46094-1.9609 0.25-2.6719l3.3203-3.3203c0.71094-0.71094 1.8398-0.82031 2.6719-0.25l7.6914 5.25c0.39062 0.26172 0.66016 0.62891 0.80859 1.0703l1.3789 4.1484 10.078 10.078 5.5391-5.5391c-0.92969-4.1992 0.35156-8.6094 3.3984-11.672 2.8711-2.8711 6.9805-4.1914 10.988-3.5312 0.98828 0.16016 1.7695 0.82812 2.0781 1.7891 0.30859 0.96094 0.070313 1.9609-0.64062 2.6719l-4.7891 4.7891 0.55859 4.0586 4.0586 0.55859 4.7188-4.7188c0.71875-0.71875 1.7305-0.96094 2.6914-0.64063 0.96875 0.32031 1.6289 1.1094 1.7812 2.1211 0.57813 3.9414-0.76172 7.9688-3.5703 10.781-3.0742 3.0664-7.4844 4.3359-11.684 3.4141zm-29.25-10.188 15.578 15.578 2.3594-2.3594-15.586-15.57c-0.23828-0.23828-0.39844-0.51172-0.51172-0.82031l-1.3711-4.1211-7.4688-5.1016-3.0508 3.0508 5.1016 7.4688 4.1211 1.3711c0.31641 0.10156 0.58984 0.26172 0.82812 0.50391zm14.262 21.887c-1.1914-1.2891-1.2891-3.2188-0.28906-4.6211l-3.8711-3.8711-18.922 18.934c-0.83984 0.83984-1.3008 1.9609-1.3008 3.1602s0.46094 2.3203 1.3008 3.1602c1.7383 1.7383 4.5781 1.7383 6.3203 0zm3.6289-1.5391 4.8086-4.8086c0.25-0.25 0.39062-0.58984 0.39062-0.94922 0-0.35937-0.14062-0.69922-0.39062-0.94922s-0.58984-0.39062-0.94922-0.39062-0.69922 0.14062-0.94922 0.39062l-4.8086 4.8086c-0.51953 0.51953-0.51953 1.3711 0 1.8906 0.52734 0.52734 1.3789 0.52734 1.8984 0.007813zm1.8711 1.4219c0.73047 1.3086 1.0586 2.5898 1.2305 3.9297l7.0703-7.0703c-1.3398-0.16016-2.6211-0.5-3.9414-1.2305zm10.93-2.4922-9.0586 9.0586 9.6211 9.6211c1.3984 1.3984 3.0508 2.0781 4.7617 1.9688 1.5391-0.10156 3.0586-0.80859 4.2617-2.0117 1.1992-1.1992 1.9219-2.7109 2.0117-4.2617 0.10938-1.7188-0.57031-3.3594-1.9688-4.7617zm-1.4922-11.5c3.5898 1 7.4492-0.011718 10.07-2.6406 2.3281-2.3281 3.3906-5.5391 2.9102-8.8008-0.019532-0.12891-0.078125-0.21094-0.21094-0.25-0.12109-0.039062-0.21875-0.019531-0.30859 0.070313l-4.7617 4.7617c-0.48828 0.48828-1.1719 0.71875-1.8594 0.62891l-4.1992-0.57031c-1-0.14062-1.7617-0.89844-1.8906-1.8906l-0.57031-4.1992c-0.089843-0.69141 0.12891-1.3711 0.62891-1.8594l4.8281-4.8281c0.089844-0.089844 0.12109-0.19141 0.078125-0.30859-0.039063-0.12109-0.10938-0.19141-0.23828-0.21094-3.2695-0.53906-6.6289 0.53906-8.9688 2.8789-2.6289 2.6289-3.6406 6.4883-2.6406 10.07 0.10938 0.39844 0 0.83984-0.30078 1.1289l-6 6 3.8711 3.8711c0.62109-0.44922 1.3516-0.69141 2.1289-0.69141 0.92969 0 1.8086 0.35156 2.4805 0.98047l3.8398-3.8398c0.28516-0.30078 0.71484-0.41016 1.1133-0.30078zm-34.879 25.859c-1.0586 0-1.9219 0.85937-1.9219 1.9219 0 1.0586 0.85938 1.9219 1.9219 1.9219 1.0586 0 1.9219-0.85938 1.9219-1.9219-0.003906-1.0586-0.86328-1.9219-1.9219-1.9219zm33.738-6.0078c-0.44922-0.44922-1.1914-0.44922-1.6406 0s-0.44922 1.1914 0 1.6406l7.2695 7.2695c0.23047 0.23047 0.51953 0.33984 0.82031 0.33984s0.58984-0.10938 0.82031-0.33984c0.44922-0.44922 0.44922-1.1914 0-1.6406zm1.9219-3.5703c-0.44922 0.44922-0.44922 1.1914 0 1.6406l7.2695 7.2695c0.23047 0.23047 0.51953 0.33984 0.82031 0.33984s0.58984-0.10937 0.82031-0.33984c0.44922-0.44922 0.44922-1.1914 0-1.6406l-7.2695-7.2695c-0.45312-0.44922-1.1797-0.44922-1.6406 0z" />
    </svg>
  )
}

function MarketIntelligenceModeGlyph({ className = 'size-3.5' }: { className?: string }) {
  return (
    <svg className={`shrink-0 ${className}`} viewBox="-5 -10 110 110" fill="currentColor" aria-hidden>
      <path d="m66.637 76.383c-3.4609 1.1406-7.0781 1.7227-10.746 1.7227-18.906 0-34.281-15.379-34.281-34.281 0-18.91 15.379-34.293 34.281-34.293 18.91 0 34.293 15.383 34.293 34.293 0 4.8555-0.99609 9.5547-2.9609 13.961-0.22656 0.50391 0 1.0938 0.50781 1.3203 0.50781 0.22656 1.0977 0 1.3203-0.50781 2.0781-4.668 3.1328-9.6406 3.1328-14.777 0-20.012-16.281-36.293-36.293-36.293-20.008 0-36.281 16.281-36.281 36.293 0 7.5234 2.3047 14.523 6.2422 20.324l-3.9023 3.9023-0.34766-0.34766c-0.39062-0.39062-1.0234-0.39062-1.4141 0s-0.39062 1.0234 0 1.4141l0.34766 0.34766-10.91 10.91-0.34766-0.34766c-0.39062-0.39063-1.0234-0.39063-1.4141 0-0.39062 0.39062-0.39062 1.0234 0 1.4141l0.34766 0.34766-1.6602 1.6602c-1 1-1.5469 2.3242-1.5469 3.7344 0 1.4102 0.55078 2.7383 1.5469 3.7305 0.99219 1.0039 2.3203 1.5547 3.7344 1.5547 1.4219 0 2.75-0.55469 3.7422-1.5508l1.6602-1.6602 0.34766 0.34766c0.19531 0.19531 0.45312 0.29297 0.70703 0.29297 0.25391 0 0.51172-0.097656 0.70703-0.29297 0.39062-0.39062 0.39062-1.0234 0-1.4141l-0.34766-0.34766 10.91-10.91 0.34766 0.34766c0.19531 0.19531 0.45312 0.29297 0.70703 0.29297s0.51172-0.097656 0.70703-0.29297c0.39062-0.39062 0.39062-1.0234 0-1.4141l-0.34766-0.34766 3.5781-3.5781c6.25 5.0977 14.223 8.1641 22.898 8.1641 3.8828 0 7.707-0.61328 11.371-1.8242 0.52344-0.17188 0.80859-0.73828 0.63672-1.2617s-0.73828-0.8125-1.2617-0.63672zm-54.035 13.125c-1.2227 1.2344-3.3984 1.25-4.6406-0.003906-0.62109-0.62109-0.96094-1.4453-0.96094-2.3203s0.34375-1.6992 0.96094-2.3203l1.6602-1.6602 4.6406 4.6406-1.6641 1.6641zm3.0781-3.0742-4.6406-4.6406 10.91-10.91 4.6406 4.6406zm12.324-12.328-4.6406-4.6406 3.6758-3.6758c1.332 1.7461 2.8164 3.3711 4.4375 4.8477l-3.4688 3.4688zm52.969-17.48c2.0547-3.9805 3.0977-8.2852 3.0977-12.801 0-15.539-12.641-28.18-28.18-28.18-15.531 0-28.168 12.641-28.168 28.18 0 15.531 12.637 28.168 28.168 28.168 3.5391 0 6.9766-0.64844 10.223-1.9297 0.51562-0.20312 1.0938 0.050781 1.2969 0.5625 0.20312 0.51562-0.050781 1.0938-0.5625 1.2969-3.4766 1.3711-7.1641 2.0664-10.957 2.0664-16.633 0-30.168-13.531-30.168-30.168 0-16.641 13.531-30.18 30.168-30.18 16.641 0 30.18 13.539 30.18 30.18 0 4.8359-1.1172 9.4531-3.3203 13.719-0.25391 0.48828-0.85938 0.67969-1.3477 0.42969-0.49219-0.25391-0.68359-0.85938-0.42969-1.3477zm-34.145-12.664h-6.2773c-0.55469 0-1 0.44531-1 1v10.246h-4.582c-0.55469 0-1 0.44531-1 1 0 0.55469 0.44531 1 1 1h41.844c0.55469 0 1-0.44531 1-1 0-0.55469-0.44531-1-1-1h-4.582v-25.125c0-0.55469-0.44531-1-1-1h-6.2773c-0.55469 0-1 0.44531-1 1v25.125h-3.9258v-17.688c0-0.55469-0.44531-1-1-1h-6.2773c-0.55469 0-1 0.44531-1 1v17.688h-3.9258v-10.246c0-0.55469-0.44531-1-1-1zm-5.2773 2h4.2773v9.2461h-4.2773zm24.406-14.875h4.2773v24.125h-4.2773zm-12.203 7.4375h4.2773v16.688h-4.2773zm28.527 21.758c-7.0156 0-12.719 5.707-12.719 12.719 0 7.0156 5.707 12.719 12.719 12.719 7.0156 0 12.719-5.707 12.719-12.719 0-7.0156-5.707-12.719-12.719-12.719zm0 23.441c-5.9102 0-10.719-4.8086-10.719-10.719s4.8086-10.719 10.719-10.719 10.719 4.8086 10.719 10.719-4.8086 10.719-10.719 10.719zm5.668-14.211c0.41016 0.36719 0.44531 1 0.078125 1.4141l-6.1133 6.8164c-0.17969 0.20312-0.43359 0.32031-0.70312 0.33203h-0.039063c-0.25781 0-0.5-0.097657-0.6875-0.27344l-3.6172-3.4297c-0.39844-0.37891-0.41797-1.0117-0.039063-1.4141 0.37891-0.39844 1.0156-0.41797 1.4141-0.039062l2.8711 2.7227 5.4258-6.0508c0.37109-0.41016 1-0.44531 1.4141-0.078125z" />
    </svg>
  )
}

const AGENT_MODE_CHIP_THEME: Partial<
  Record<
    AskUloAgentMode,
    { chip: string; icon: string; send: string; Glyph: (props: { className?: string }) => ReactNode }
  >
> = {
  ulo_agent: {
    chip: 'bg-[#E0F2EF] text-[#187960] hover:bg-[#d4ebe7]',
    icon: 'text-[#187960]',
    send: 'enabled:bg-[#187960] enabled:hover:bg-[#146b55] focus-visible:ring-[#187960]',
    Glyph: UloAgentModeGlyph,
  },
  legal_insights: {
    chip: 'bg-[#D2F4FF] text-[#0A7C9E] hover:bg-[#c3eefc]',
    icon: 'text-[#0A7C9E]',
    send: 'enabled:bg-[#0A7C9E] enabled:hover:bg-[#096b88] focus-visible:ring-[#0A7C9E]',
    Glyph: LegalInsightsModeGlyph,
  },
  financial_insights: {
    chip: 'bg-[#F1E4F1] text-[#8B4A8B] hover:bg-[#e9d8e9]',
    icon: 'text-[#8B4A8B]',
    send: 'enabled:bg-[#8B4A8B] enabled:hover:bg-[#7a3f7a] focus-visible:ring-[#8B4A8B]',
    Glyph: FinancialInsightsModeGlyph,
  },
  maintenance_pro: {
    chip: 'bg-[#E6F4E9] text-[#2F6B3A] hover:bg-[#d8edd9]',
    icon: 'text-[#2F6B3A]',
    send: 'enabled:bg-[#2F6B3A] enabled:hover:bg-[#275c32] focus-visible:ring-[#2F6B3A]',
    Glyph: MaintenanceProModeGlyph,
  },
  market_intelligence: {
    chip: 'bg-[#E6E9F2] text-[#3D4F6F] hover:bg-[#dce0eb]',
    icon: 'text-[#3D4F6F]',
    send: 'enabled:bg-[#3D4F6F] enabled:hover:bg-[#33425c] focus-visible:ring-[#3D4F6F]',
    Glyph: MarketIntelligenceModeGlyph,
  },
}

function CloseIcon() {
  return (
    <svg className="size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
      <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" />
    </svg>
  )
}

function MiniSparkleIcon({ className = 'size-3.5' }: { className?: string }) {
  return (
    <svg viewBox="10 10 20 20" fill="none" stroke="currentColor" strokeWidth={1.8} className={className} aria-hidden>
      <path
        d="M18.2809 22.9167C18.2065 22.6283 18.0561 22.3651 17.8455 22.1545C17.6349 21.9439 17.3718 21.7936 17.0834 21.7192L11.9709 20.4008C11.8836 20.3761 11.8069 20.3236 11.7522 20.2512C11.6975 20.1789 11.668 20.0907 11.668 20C11.668 19.9093 11.6975 19.8211 11.7522 19.7488C11.8069 19.6765 11.8836 19.6239 11.9709 19.5992L17.0834 18.28C17.3717 18.2057 17.6348 18.0555 17.8454 17.845C18.056 17.6346 18.2063 17.3716 18.2809 17.0833L19.5992 11.9708C19.6237 11.8833 19.6762 11.8061 19.7486 11.7512C19.8211 11.6962 19.9095 11.6665 20.0004 11.6665C20.0914 11.6665 20.1798 11.6962 20.2523 11.7512C20.3247 11.8061 20.3772 11.8833 20.4017 11.9708L21.7192 17.0833C21.7936 17.3717 21.9439 17.6349 22.1545 17.8455C22.3651 18.0561 22.6283 18.2064 22.9167 18.2808L28.0292 19.5983C28.1171 19.6226 28.1946 19.675 28.2499 19.7476C28.3052 19.8201 28.3351 19.9088 28.3351 20C28.3351 20.0912 28.3052 20.1799 28.2499 20.2524C28.1946 20.325 28.1171 20.3774 28.0292 20.4017L22.9167 21.7192C22.6283 21.7936 22.3651 21.9439 22.1545 22.1545C21.9439 22.3651 21.7936 22.6283 21.7192 22.9167L20.4009 28.0292C20.3764 28.1167 20.3239 28.1939 20.2514 28.2489C20.179 28.3038 20.0905 28.3336 19.9996 28.3336C19.9087 28.3336 19.8202 28.3038 19.7478 28.2489C19.6754 28.1939 19.6229 28.1167 19.5984 28.0292L18.2809 22.9167Z"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M26.6666 12.5V15.8333" strokeLinecap="round" />
      <path d="M28.3333 14.1667H25" strokeLinecap="round" />
    </svg>
  )
}

function SuggestionIcon({ kind }: { kind: (typeof SUGGESTIONS)[number]['icon'] }) {
  if (kind === 'attention') {
    return (
      <svg className="size-4 shrink-0 text-[#b45309]" viewBox="0 0 24 24" fill="none" aria-hidden>
        <path
          d="M12 3.5L21.5 20h-19L12 3.5z"
          stroke="currentColor"
          strokeWidth={1.75}
          strokeLinejoin="round"
        />
        <path d="M12 10v4M12 17h.01" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" />
      </svg>
    )
  }
  if (kind === 'money') {
    return (
      <svg className="size-4 shrink-0 text-[#047857]" viewBox="0 0 24 24" fill="none" aria-hidden>
        <circle cx="12" cy="12" r="8.25" stroke="currentColor" strokeWidth={1.75} />
        <path
          d="M12 7.5v9M14.5 9.5c0-1-1.1-1.75-2.5-1.75S9.5 8.5 9.5 9.5 10.6 11.25 12 11.25s2.5.75 2.5 1.75-1.1 1.75-2.5 1.75-2.5-.75-2.5-1.75"
          stroke="currentColor"
          strokeWidth={1.75}
          strokeLinecap="round"
        />
      </svg>
    )
  }
  if (kind === 'wrench') {
    return (
      <svg className="size-4 shrink-0 text-[#c2410c]" viewBox="0 0 24 24" fill="none" aria-hidden>
        <path
          d="M14.7 6.3a4.5 4.5 0 00-6.1 5.9L4 17.5 6.5 20l5.3-4.6a4.5 4.5 0 005.9-6.1l-2.2 2.2-2.8-2.2 2-2z"
          stroke="currentColor"
          strokeWidth={1.6}
          strokeLinejoin="round"
        />
      </svg>
    )
  }
  return (
    <svg className="size-4 shrink-0 text-[#4f46e5]" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="8" r="3.25" stroke="currentColor" strokeWidth={1.75} />
      <path
        d="M5.5 19.5c.8-3.2 3.2-5 6.5-5s5.7 1.8 6.5 5"
        stroke="currentColor"
        strokeWidth={1.75}
        strokeLinecap="round"
      />
    </svg>
  )
}

function confidencePresentation(level: AskUloAnswerConfidence | null | undefined): {
  title: string
  support: string
  tone: 'high' | 'medium' | 'low'
} | null {
  if (!level) return null
  if (level === 'high') {
    return {
      title: 'High Confidence',
      support:
        'This answer is based on official laws, government guidance, and your property information.',
      tone: 'high',
    }
  }
  if (level === 'medium') {
    return {
      title: 'Medium Confidence',
      support:
        'This answer uses official guidance and your property information, but some details may need a closer look.',
      tone: 'medium',
    }
  }
  if (level === 'low') {
    return {
      title: 'Low Confidence',
      support:
        'Some sources are incomplete or uncertain. Check the details before you act.',
      tone: 'low',
    }
  }
  return {
    title: 'Needs Review',
    support:
      'This topic needs a human expert before you act. Open the details and flag for human review if needed.',
    tone: 'low',
  }
}

/** Map internal citation / table labels to landlord-facing names. */
function friendlySourceLabel(raw: string): string {
  const t = raw.trim()
  const lower = t.toLowerCase()
  const map: Array<[RegExp, string]> = [
    [/^maintenance_request_enriched\s*\+\s*vendors$/i, 'Vendor History'],
    [/^maintenance_request_enriched$/i, 'Maintenance History'],
    [/^workflow_runs$/i, 'Active Workflows'],
    [/^operations_graph_events$/i, 'Recent Activity'],
    [/^users\s*\+\s*occupancy$/i, 'Occupancy Information'],
    [/^portfolio unit inventory$/i, 'Property Details'],
    [/^property profile\s*&\s*company policies$/i, 'Company Policies'],
    [/^lease\s*&\s*occupancy roll$/i, 'Lease Information'],
    [/^open maintenance tickets$/i, 'Maintenance History'],
    [/^open workflow runs$/i, 'Active Workflows'],
    [/^operations graph \(recent\)$/i, 'Recent Activity'],
    [/^maintenance\s*&\s*vendor performance$/i, 'Vendor History'],
    [/^property maintenance\s*\/\s*ops history$/i, 'Maintenance History'],
    [/portfolio context$/i, 'Property Details'],
    [/^jurisdiction:\s*/i, ''],
  ]
  for (const [re, label] of map) {
    if (re.test(t)) {
      if (label === '' && /^jurisdiction:\s*/i.test(t)) {
        return t.replace(/^jurisdiction:\s*/i, '').trim() || t
      }
      return label
    }
  }
  if (lower.includes('pending') && (lower.includes('codif') || lower.includes('ordinance'))) {
    return t.replace(/pending\s+codification/gi, 'Pending Publication')
  }
  // Hide raw snake_case table-ish tokens when they appear alone as the display string.
  if (/^[a-z][a-z0-9_]+(\s*\+\s*[a-z][a-z0-9_]+)*$/i.test(t) && t.includes('_')) {
    return t
      .split(/\s*\+\s*/)
      .map((part) =>
        part
          .split('_')
          .filter(Boolean)
          .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
          .join(' '),
      )
      .join(' · ')
  }
  return t
}

type SourceBucket = 'laws' | 'guidance' | 'property' | 'updates'

function classifyCitationBucket(c: AskUloCitation): SourceBucket {
  if (c.tool === 'ops_graph' || c.tool === 'market_data') return 'property'
  const hay = `${c.title} ${c.citation ?? ''} ${c.excerpt ?? ''}`.toLowerCase()
  if (
    c.sourceTier === 'untrusted' ||
    /\bpending\b/.test(hay) ||
    /\bcodif/.test(hay) ||
    /\bneeds verification\b/.test(hay)
  ) {
    return 'updates'
  }
  if (
    c.sourceTier === 'agency_guidance' ||
    /\bhud\b/.test(hay) ||
    /\bhousing authority\b/.test(hay) ||
    /\bsection\s*8\b/.test(hay) ||
    /\bhcv\b/.test(hay) ||
    /\bfmr\b/.test(hay) ||
    /\bpayment standard/.test(hay)
  ) {
    return 'guidance'
  }
  return 'laws'
}

function citationListLabel(c: AskUloCitation): string {
  const title = c.title?.trim()
  const cite = c.citation?.trim()
  if (title) return friendlySourceLabel(title)
  if (cite) return friendlySourceLabel(cite)
  return 'Cited source'
}

function citationSourceLabel(c: AskUloCitation): string {
  const cite = c.citation?.trim()
  const title = c.title?.trim()
  // Prefer exact legal citations; skip raw table/key citations.
  if (cite && !/^[a-z][a-z0-9_]+(\s*\+\s*[a-z][a-z0-9_]+)*$/i.test(cite)) {
    return friendlySourceLabel(cite)
  }
  if (title) return friendlySourceLabel(title)
  if (cite) return friendlySourceLabel(cite)
  return 'Cited source'
}

function citationCategoryTag(c: AskUloCitation): string | null {
  if (c.tool === 'ops_graph' || c.tool === 'market_data') return 'Your Property'
  if (c.sourceTier === 'primary_official') return 'Law'
  if (c.sourceTier === 'agency_guidance') return 'Government Guidance'
  if (c.sourceTier === 'discovery_mirror') return 'Pending Publication'
  if (c.sourceTier === 'untrusted') return 'Needs Verification'
  if (c.tool === 'legal_rag' || c.tool === 'structured') return 'Law'
  return null
}

function uniqueLabels(labels: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const label of labels) {
    const key = label.toLowerCase()
    if (!label || seen.has(key)) continue
    seen.add(key)
    out.push(label)
  }
  return out
}

function LegalContextBanner({
  jurisdiction,
  legalAudit,
  safetyBoundary,
  citations,
}: {
  jurisdiction?: ChatMessage['jurisdiction']
  legalAudit?: AskUloLegalAudit | null
  safetyBoundary?: AskUloSafetyBoundary | null
  citations?: AskUloCitation[]
}) {
  const panelId = useId()
  const forceOpen = Boolean(safetyBoundary?.blocked || legalAudit?.requireCounsel)
  const [open, setOpen] = useState(forceOpen)

  useEffect(() => {
    if (forceOpen) setOpen(true)
  }, [forceOpen])

  const citationList = citations ?? []
  const hasCitations = citationList.length > 0
  if (!legalAudit && !jurisdiction?.stateCode && !safetyBoundary?.blocked && !hasCitations) {
    return null
  }

  const confidence = confidencePresentation(legalAudit?.answerConfidence ?? null)

  const updateItems = uniqueLabels(
    citationList.filter((c) => classifyCitationBucket(c) === 'updates').map(citationListLabel),
  )
  if (legalAudit && legalAudit.pendingOrdinanceCount > 0) {
    const pendingNote =
      'A recently adopted ordinance may not yet appear in the published city code.'
    if (!updateItems.some((item) => item.toLowerCase() === pendingNote.toLowerCase())) {
      updateItems.unshift(pendingNote)
    }
  }

  const chipToneClass =
    confidence?.tone === 'high'
      ? 'border-[#b7e4d8] bg-[#e8f7f2] text-[#187960]'
      : confidence?.tone === 'medium'
        ? 'border-[#f5e0a8] bg-[#fffbeb] text-[#92400e]'
        : 'border-[#f5d0b5] bg-[#fff7ed] text-[#9a3412]'

  return (
    <div className="mt-3 rounded-lg border border-[#e5e7eb] bg-[#f9fafb] text-[12px] leading-4 text-[#4b5563]">
      <div className="space-y-2 px-2.5 py-2.5">
        <p className="font-medium text-[#111827]">Compliance &amp; References</p>
        {confidence ? (
          <div className="space-y-1.5">
            <span
              className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-semibold leading-4 ${chipToneClass}`}
            >
              {confidence.title}
            </span>
            <p className="text-[12px] leading-4 text-[#4b5563]">{confidence.support}</p>
          </div>
        ) : null}
        <button
          type="button"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen((v) => !v)}
          className="inline-flex cursor-pointer items-center gap-1 text-[12px] font-medium text-[#0A4D38] outline-none hover:underline focus-visible:ring-2 focus-visible:ring-[#0A4D38]/30"
        >
          {open ? 'Hide details' : 'View details'}
          <svg
            viewBox="0 0 16 16"
            className={`size-3.5 transition-transform ${open ? 'rotate-90' : ''}`}
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            aria-hidden
          >
            <path d="M6 3.5 10.5 8 6 12.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>

      {open ? (
        <div id={panelId} className="space-y-3 border-t border-[#e5e7eb] px-2.5 py-2.5">
          {safetyBoundary?.blocked ? (
            <p className="font-medium text-[#9a3412]">
              {safetyBoundary.kind === 'fair_housing'
                ? 'Fair Housing safety — I won’t recommend approve/deny based on protected traits, proxies, or invented denial reasons. Follow written lawful criteria and company counsel.'
                : 'You stay in control — I won’t automatically send notices, deny applicants, change rents, shut off utilities, or file paperwork.'}
            </p>
          ) : null}

          {legalAudit?.requireCounsel ? (
            <p className="font-medium text-[#9a3412]">
              Sensitive topic — have a qualified professional review before you act
              {legalAudit.sensitiveTopics.length > 0
                ? ` (${legalAudit.sensitiveTopics.map((t) => t.label).join('; ')})`
                : ''}
              .
            </p>
          ) : null}

          {updateItems.length > 0 ? (
            <div className="space-y-1 rounded-md border border-[#f5d0b5] bg-[#fff7ed] px-2.5 py-2">
              <p className="font-medium text-[#9a3412]">Important Updates</p>
              <ul className="list-disc space-y-0.5 pl-4 text-[#9a3412]">
                {updateItems.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {hasCitations ? (
            <div className="space-y-1">
              <p className="font-medium text-[#111827]">Sources</p>
              <CitationChips citations={citationList} />
            </div>
          ) : null}

          {legalAudit?.gateStatus === 'ok' || hasCitations ? (
            <p className="text-[#6b7280]">
              This is operational guidance from the sources above — not legal advice. I explain the
              rules; a human expert should make judgment calls.
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

function canFlagCounselHandoff(msg: ChatMessage): boolean {
  if (!msg.legalAudit || msg.streaming || msg.pending || msg.error) return false
  if (msg.intent && msg.intent !== 'legal') return false
  return true
}

function CounselHandoffModal({
  open,
  onClose,
  msg,
  conversationId,
  lastUserQuestion,
  onFlagged,
}: {
  open: boolean
  onClose: () => void
  msg: ChatMessage
  conversationId: string | null
  lastUserQuestion: string | null
  onFlagged: (messageId: string, confirmationMarkdown: string) => void
}) {
  const legalAudit = msg.legalAudit
  const experts =
    legalAudit && legalAudit.handoffExperts.length > 0
      ? legalAudit.handoffExperts
      : [
          {
            id: 'regional_property_manager' as const,
            label: 'Experienced regional property manager',
            shortLabel: 'Regional PM',
            description: '',
            whenToUse: '',
          },
        ]
  const defaultExpertId = legalAudit?.recommendedExpertId || experts[0].id
  const [expertRole, setExpertRole] = useState<AskUloCounselExpertRoleId>(defaultExpertId)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setError(null)
    setNote('')
    setExpertRole(defaultExpertId)
  }, [open, defaultExpertId])

  useEffect(() => {
    if (!open) return
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape' || busy) return
      event.preventDefault()
      event.stopImmediatePropagation()
      onClose()
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [open, busy, onClose])

  if (!open || !legalAudit || msg.counselHandoffDone) return null

  const selected = experts.find((e) => e.id === expertRole) ?? experts[0]

  return createPortal(
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40 p-4">
      <button
        type="button"
        className="absolute inset-0 cursor-default"
        aria-label="Close flag for review"
        disabled={busy}
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="ask-ulo-counsel-title"
        className="relative z-[1] w-full max-w-md space-y-3 rounded-xl border border-[#e5e7eb] bg-white p-4 text-[13px] leading-5 text-[#4b5563] shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <p id="ask-ulo-counsel-title" className="font-medium text-[#111827]">
            Flag for human review
          </p>
          <button
            type="button"
            disabled={busy}
            onClick={onClose}
            className="rounded-md px-1.5 py-0.5 text-[12px] font-medium text-[#6b7280] outline-none hover:bg-[#f3f4f6] hover:text-[#111827] focus-visible:ring-2 focus-visible:ring-[#101828]"
          >
            Close
          </button>
        </div>
        <p>
          I find and explain the rules — I don’t replace a lawyer. Hand complicated judgment to a
          qualified professional.
        </p>
        <label className="block">
          <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-[#6b7280]">
            Expert type
          </span>
          <select
            value={expertRole}
            onChange={(e) => setExpertRole(e.target.value as AskUloCounselExpertRoleId)}
            className="w-full rounded-md border border-[#d1d5db] bg-white px-2 py-1.5 text-[12px] text-[#111827] outline-none focus:border-[#101828] focus:ring-1 focus:ring-[#101828]"
          >
            {experts.map((e) => (
              <option key={e.id} value={e.id}>
                {e.label}
                {e.id === legalAudit.recommendedExpertId ? ' (suggested)' : ''}
              </option>
            ))}
          </select>
        </label>
        {selected?.whenToUse ? (
          <p className="text-[12px] text-[#6b7280]">{selected.whenToUse}</p>
        ) : null}
        <label className="block">
          <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-[#6b7280]">
            Note (optional)
          </span>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            maxLength={400}
            placeholder="What should the reviewer focus on?"
            className="w-full resize-none rounded-md border border-[#d1d5db] bg-white px-2 py-1.5 text-[12px] text-[#111827] outline-none focus:border-[#101828] focus:ring-1 focus:ring-[#101828]"
          />
        </label>
        {error ? <p className="text-[12px] text-[#9a3412]">{error}</p> : null}
        <div className="flex items-center justify-end gap-2 pt-1">
          <button
            type="button"
            disabled={busy}
            onClick={onClose}
            className="inline-flex items-center justify-center rounded-md px-3 py-1.5 text-[12px] font-medium text-[#4b5563] outline-none transition-colors hover:bg-[#f3f4f6] focus-visible:ring-2 focus-visible:ring-[#101828] disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              void (async () => {
                setBusy(true)
                setError(null)
                try {
                  const result = await postAskUloCounselHandoff({
                    expertRole,
                    conversationId,
                    messageId: msg.id.startsWith('local-') ? null : msg.id,
                    evalId: msg.evalId ?? null,
                    question: lastUserQuestion,
                    answerExcerpt: msg.text.slice(0, 800),
                    sensitiveTopicIds: legalAudit.sensitiveTopics.map((t) => t.id),
                    note: note.trim() || null,
                    stateCode: msg.jurisdiction?.stateCode ?? null,
                    cityLabel: msg.jurisdiction?.cityLabel ?? null,
                  })
                  onFlagged(msg.id, result.confirmationMarkdown)
                  onClose()
                } catch (err) {
                  setError(err instanceof Error ? err.message : 'Could not flag for review')
                } finally {
                  setBusy(false)
                }
              })()
            }}
            className="inline-flex items-center justify-center rounded-md bg-[#101828] px-3 py-1.5 text-[12px] font-medium text-white outline-none transition-colors hover:bg-[#1e2939] focus-visible:ring-2 focus-visible:ring-[#101828] focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy ? 'Flagging…' : 'Flag for human review'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

function CopyCheckIcon({ className = 'size-3.5' }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.25"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M5 13l4 4L19 7" />
    </svg>
  )
}

function ThumbUpIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M7 11v8a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1h3Z" />
      <path d="M7 11l4.2-8.1A2 2 0 0 1 13 2a2.8 2.8 0 0 1 2.7 3.6L14.8 9H20a2 2 0 0 1 2 2.3l-1.1 6.2A2.5 2.5 0 0 1 18.5 20H10a2 2 0 0 1-2-2v-7Z" />
    </svg>
  )
}

function ThumbDownIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M17 13V5a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1h-3Z" />
      <path d="M17 13l-4.2 8.1A2 2 0 0 1 11 22a2.8 2.8 0 0 1-2.7-3.6L9.2 15H4a2 2 0 0 1-2-2.3l1.1-6.2A2.5 2.5 0 0 1 5.5 4H14a2 2 0 0 1 2 2v7Z" />
    </svg>
  )
}

function CitationChips({ citations }: { citations: AskUloCitation[] }) {
  if (citations.length === 0) return null
  return (
    <div className="flex flex-wrap gap-1.5">
      {citations.map((c, i) => {
        const label = citationSourceLabel(c)
        const tag = citationCategoryTag(c)
        const chip = (
          <span className="inline-flex max-w-full items-center gap-1 rounded-md border border-[#e5e7eb] bg-white px-2 py-0.5 text-[11px] font-medium leading-4 text-[#374151]">
            {tag ? (
              <span
                className={
                  tag === 'Law'
                    ? 'shrink-0 text-[#187960]'
                    : tag === 'Government Guidance'
                      ? 'shrink-0 text-[#0A7C9E]'
                      : tag === 'Needs Verification' || tag === 'Pending Publication'
                        ? 'shrink-0 text-[#9a3412]'
                        : 'shrink-0 text-[#6b7280]'
                }
              >
                {tag}
              </span>
            ) : null}
            <span className="truncate">{label}</span>
          </span>
        )
        if (c.url) {
          return (
            <a
              key={`${c.tool}-${label}-${i}`}
              href={c.url}
              target="_blank"
              rel="noreferrer"
              className="outline-none transition-opacity hover:opacity-80 focus-visible:ring-2 focus-visible:ring-[#101828]"
              title={c.excerpt ?? c.title}
            >
              {chip}
            </a>
          )
        }
        return (
          <span key={`${c.tool}-${label}-${i}`} title={c.excerpt ?? c.title}>
            {chip}
          </span>
        )
      })}
    </div>
  )
}

function UnderstandingStatus({ line }: { line: string }) {
  return (
    <div className="flex items-start gap-2.5 py-0.5" role="status" aria-live="polite">
      <span className="mt-1.5 flex shrink-0 gap-0.5" aria-hidden>
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="size-1.5 rounded-full bg-[#0A4D38]"
            style={{
              animation: 'ask-ulo-status-dot 1.1s ease-in-out infinite',
              animationDelay: `${i * 0.16}s`,
            }}
          />
        ))}
      </span>
      <p className="text-[13px] leading-5 text-[#4b5563] transition-opacity duration-200">{line}</p>
    </div>
  )
}

function MessageActions({
  text,
  onRegenerate,
  feedback,
  onFeedback,
  overrideReason,
  onOverrideReason,
  showOverrideReasons,
}: {
  text: string
  onRegenerate?: () => void
  feedback: 'up' | 'down' | null
  onFeedback: (value: 'up' | 'down') => void
  overrideReason: AskUloOverrideReason | null
  onOverrideReason: (reason: AskUloOverrideReason) => void
  showOverrideReasons: boolean
}) {
  const [copied, setCopied] = useState(false)
  const copiedResetRef = useRef<number | null>(null)

  useEffect(() => {
    return () => {
      if (copiedResetRef.current != null) window.clearTimeout(copiedResetRef.current)
    }
  }, [])

  const feedbackAcknowledged =
    feedback === 'up' ||
    (feedback === 'down' && (!showOverrideReasons || Boolean(overrideReason)))

  const waitingForOverrideReason =
    feedback === 'down' && showOverrideReasons && !overrideReason

  return (
    <div className="ask-ulo-actions-enter mt-3 flex flex-col gap-2 border-t border-[#f3f4f6] pt-2">
      <div className="flex flex-wrap items-center gap-1">
      <button
        type="button"
        aria-label={copied ? 'Copied' : 'Copy'}
        title={copied ? 'Copied' : 'Copy'}
        aria-pressed={copied}
        className={
          copied
            ? 'inline-flex cursor-pointer items-center justify-center rounded-md bg-[#ecfdf5] px-2 py-1 text-[#065f46] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[#101828]'
            : 'inline-flex cursor-pointer items-center justify-center rounded-md px-2 py-1 text-[#6a7282] outline-none transition-colors hover:bg-[#f3f4f6] hover:text-[#0a0a0a] active:bg-[#e5e7eb] focus-visible:ring-2 focus-visible:ring-[#101828]'
        }
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(text)
            setCopied(true)
            if (copiedResetRef.current != null) window.clearTimeout(copiedResetRef.current)
            copiedResetRef.current = window.setTimeout(() => {
              setCopied(false)
              copiedResetRef.current = null
            }, 1600)
          } catch {
            /* ignore */
          }
        }}
      >
        {copied ? (
          <CopyCheckIcon />
        ) : (
          <img src={copyIcon} alt="" aria-hidden className="size-3.5 object-contain" />
        )}
      </button>
      {onRegenerate ? (
        <button
          type="button"
          aria-label="Regenerate"
          title="Regenerate"
          className="inline-flex cursor-pointer items-center justify-center rounded-md px-2 py-1 text-[#6a7282] outline-none transition-colors hover:bg-[#f3f4f6] hover:text-[#0a0a0a] focus-visible:ring-2 focus-visible:ring-[#101828] disabled:cursor-not-allowed disabled:opacity-40"
          onClick={onRegenerate}
        >
          <img src={regenerateIcon} alt="" aria-hidden className="size-4 object-contain opacity-90" />
        </button>
      ) : null}
      {feedbackAcknowledged ? (
        <span
          className="inline-flex items-center gap-1 rounded-md bg-[#ecfdf5] px-2 py-1 text-[#065f46]"
          role="status"
          aria-live="polite"
          title="Thanks for the feedback"
        >
          <CopyCheckIcon />
          <span className="sr-only">Thanks for the feedback</span>
        </span>
      ) : (
        <>
          <button
            type="button"
            aria-label="Thumbs up"
            className="inline-flex cursor-pointer items-center justify-center rounded-md px-2 py-1 text-[#6a7282] outline-none transition-colors hover:bg-[#f3f4f6] hover:text-[#0a0a0a] focus-visible:ring-2 focus-visible:ring-[#101828]"
            onClick={() => onFeedback('up')}
          >
            <ThumbUpIcon />
          </button>
          <button
            type="button"
            aria-label="Thumbs down"
            aria-pressed={feedback === 'down'}
            className={
              feedback === 'down'
                ? 'inline-flex cursor-pointer items-center justify-center rounded-md bg-[#fff7ed] px-2 py-1 text-[#9a3412] outline-none transition-colors hover:bg-[#ffedd5] focus-visible:ring-2 focus-visible:ring-[#101828]'
                : 'inline-flex cursor-pointer items-center justify-center rounded-md px-2 py-1 text-[#6a7282] outline-none transition-colors hover:bg-[#f3f4f6] hover:text-[#0a0a0a] focus-visible:ring-2 focus-visible:ring-[#101828]'
            }
            onClick={() => onFeedback('down')}
          >
            <ThumbDownIcon />
          </button>
        </>
      )}
      </div>
      {waitingForOverrideReason ? (
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="What went wrong">
          {ASK_ULO_OVERRIDE_REASON_OPTIONS.map((opt) => (
            <button
              key={opt.id}
              type="button"
              aria-pressed={overrideReason === opt.id}
              className={
                overrideReason === opt.id
                  ? 'rounded-md bg-[#fff7ed] px-2 py-1 text-[11px] font-medium text-[#9a3412] outline-none ring-1 ring-[#fdba74] focus-visible:ring-2 focus-visible:ring-[#101828]'
                  : 'rounded-md bg-[#f9fafb] px-2 py-1 text-[11px] font-medium text-[#4b5563] outline-none hover:bg-[#f3f4f6] focus-visible:ring-2 focus-visible:ring-[#101828]'
              }
              onClick={() => onOverrideReason(opt.id)}
            >
              {opt.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}

function Composer({
  draft,
  setDraft,
  canSend,
  loading,
  onSend,
  inputRef,
  id,
  agentMode,
  onAgentModeChange,
}: {
  draft: string
  setDraft: (v: string) => void
  canSend: boolean
  loading: boolean
  onSend: () => void
  inputRef: RefObject<HTMLTextAreaElement | null>
  id: string
  agentMode: AskUloAgentMode
  onAgentModeChange: (mode: AskUloAgentMode) => void
}) {
  const [modeMenuOpen, setModeMenuOpen] = useState(false)
  const modeMenuRef = useRef<HTMLDivElement>(null)
  const modeTheme = AGENT_MODE_CHIP_THEME[agentMode]
  const ModeGlyph = modeTheme?.Glyph

  useEffect(() => {
    if (!modeMenuOpen) return
    function onPointerDown(event: MouseEvent) {
      if (!modeMenuRef.current?.contains(event.target as Node)) {
        setModeMenuOpen(false)
      }
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setModeMenuOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [modeMenuOpen])

  return (
    <div className="w-full rounded-[18px] border border-[#e5e7eb] bg-white p-4 shadow-[0px_8px_30px_rgba(16,24,40,0.06)]">
      <label className="sr-only" htmlFor={id}>
        Message for Ulo
      </label>
      <textarea
        id={id}
        ref={inputRef}
        rows={3}
        value={draft}
        disabled={loading}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            onSend()
          }
        }}
        placeholder="Write your message..."
        className="min-h-[72px] w-full resize-none bg-transparent text-[15px] leading-6 tracking-[-0.15px] text-[#0a0a0a] outline-none placeholder:text-[#9ca3af] disabled:opacity-60"
      />
      <div className="mt-3 flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <div className="relative min-w-0" ref={modeMenuRef}>
            <button
              type="button"
              disabled={loading}
              aria-haspopup="listbox"
              aria-expanded={modeMenuOpen}
              aria-label={`Ulo agent mode: ${agentModeLabel(agentMode)}`}
              onClick={() => setModeMenuOpen((open) => !open)}
              className={[
                'inline-flex h-8 max-w-full cursor-pointer items-center gap-1.5 rounded-full px-2.5 text-[12px] font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[#101828] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60',
                modeTheme
                  ? modeTheme.chip
                  : 'bg-transparent text-[#6a7282] hover:bg-[#f3f4f6] hover:text-[#374151]',
              ].join(' ')}
            >
              {ModeGlyph ? (
                <ModeGlyph className={`size-3.5 ${modeTheme.icon}`} />
              ) : (
                <MiniSparkleIcon className="size-3.5 shrink-0 text-[#6a7282]" />
              )}
              <span className="truncate">{agentModeLabel(agentMode)}</span>
              <svg
                className={`size-3.5 shrink-0 opacity-80 transition-transform duration-150 ${modeMenuOpen ? 'rotate-180' : ''}`}
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                aria-hidden
              >
                <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            {modeMenuOpen ? (
              <div
                role="listbox"
                aria-label="Ulo agent modes"
                className="absolute bottom-[calc(100%+8px)] left-0 z-30 w-[min(100vw-2rem,280px)] overflow-hidden rounded-[12px] border border-[#e5e7eb] bg-white py-1 shadow-[0px_12px_32px_rgba(16,24,40,0.12)]"
              >
                {ASK_ULO_AGENT_MODES.map((mode) => {
                  const selected = mode.id === agentMode
                  const optionTheme = AGENT_MODE_CHIP_THEME[mode.id]
                  const OptionGlyph = optionTheme?.Glyph
                  return (
                    <button
                      key={mode.id}
                      type="button"
                      role="option"
                      aria-selected={selected}
                      onClick={() => {
                        onAgentModeChange(mode.id)
                        setModeMenuOpen(false)
                      }}
                      className={[
                        'flex w-full cursor-pointer items-center gap-2.5 px-3 py-2.5 text-left outline-none transition-colors',
                        selected ? 'bg-[#f3f4f6]' : 'hover:bg-[#f9fafb]',
                      ].join(' ')}
                    >
                      {OptionGlyph ? (
                        <OptionGlyph className={`size-8 shrink-0 ${optionTheme.icon}`} />
                      ) : null}
                      <span className="flex min-w-0 flex-col gap-0.5">
                        <span className="text-[13px] font-medium leading-4 text-[#0a0a0a]">
                          {mode.label}
                        </span>
                        <span className="text-[11px] leading-4 text-[#6a7282]">{mode.description}</span>
                      </span>
                    </button>
                  )
                })}
              </div>
            ) : null}
          </div>
        </div>
        <button
          type="button"
          disabled={!canSend || loading}
          onClick={onSend}
          className={[
            'inline-flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-full bg-[#d1d5db] text-white outline-none transition-colors focus-visible:ring-2 focus-visible:ring-offset-2 disabled:cursor-not-allowed',
            modeTheme?.send ??
              'enabled:bg-[#101828] enabled:hover:bg-[#1e2939] focus-visible:ring-[#101828]',
          ].join(' ')}
          aria-label="Send message"
        >
          {loading ? (
            <span className="size-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
          ) : (
            <svg className="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.25}>
              <path d="M12 19V5M6 11l6-6 6 6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
        </button>
      </div>
    </div>
  )
}

function PropertyClarifyChips({
  options,
  disabled,
  onSelect,
}: {
  options: string[]
  disabled?: boolean
  onSelect: (building: string) => void
}) {
  if (options.length === 0) return null
  return (
    <div className="mt-3">
      <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-[#6b7280]">
        Choose a property
      </p>
      <div className="flex flex-wrap gap-1.5">
        {options.map((building) => (
          <button
            key={building}
            type="button"
            disabled={disabled}
            onClick={() => onSelect(building)}
            className="cursor-pointer rounded-lg border border-[#d1d5db] bg-white px-2.5 py-1.5 text-left text-[12px] font-medium text-[#111827] transition-colors hover:border-[#0A4D38] hover:bg-[#E0F2EF] hover:text-[#0A4D38] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {building}
          </button>
        ))}
      </div>
    </div>
  )
}

function AssistantBody({
  msg,
  statusLine,
  conversationId,
  lastUserQuestion,
  onCounselFlagged,
  onRegenerate,
  onSelectProperty,
  propertySelectDisabled,
}: {
  msg: ChatMessage
  statusLine: string | null
  conversationId: string | null
  lastUserQuestion: string | null
  onCounselFlagged: (messageId: string, confirmationMarkdown: string) => void
  onRegenerate?: () => void
  onSelectProperty?: (building: string) => void
  propertySelectDisabled?: boolean
}) {
  const [feedback, setFeedback] = useState<'up' | 'down' | null>(
    msg.counselHandoffDone ? 'down' : null,
  )
  const [overrideReason, setOverrideReason] = useState<AskUloOverrideReason | null>(null)
  const [handoffOpen, setHandoffOpen] = useState(false)

  const submitFeedback = (
    rating: 'up' | 'down',
    reason: AskUloOverrideReason | null = null,
  ) => {
    setFeedback(rating)
    if (rating === 'up') setOverrideReason(null)
    if (!msg.evalId) return
    void postAskUloFeedback({
      evalId: msg.evalId,
      rating,
      overrideReason: rating === 'down' ? reason : null,
      conversationId,
      messageId: msg.id.startsWith('local-') ? null : msg.id,
    }).catch((err) => {
      console.warn('[AskUlo] feedback failed', err)
    })
  }

  if (msg.error) {
    return <div className="whitespace-pre-wrap">{msg.text}</div>
  }

  if (msg.pending) {
    return <UnderstandingStatus line={statusLine ?? 'Gathering the right context…'} />
  }

  const displayText = stripSourcesUsedSection(msg.text)

  const showRich =
    !msg.streaming &&
    Boolean(msg.visualContext) &&
    displayText.trim().length > 0

  const clarifyOptions =
    msg.complete &&
    !msg.streaming &&
    msg.legalAudit?.gateStatus === 'clarify' &&
    (msg.legalAudit.propertyClarifyOptions?.length ?? 0) > 0
      ? msg.legalAudit.propertyClarifyOptions
      : []

  const handoffAvailable = canFlagCounselHandoff(msg)

  return (
    <>
      {showRich &&
      (msg.visualContext?.kind === 'price_history' ||
        msg.visualContext?.kind === 'rent_history') ? (
        <AskUloHistoryAnswer
          content={displayText}
          visual={msg.visualContext}
          progressive={Boolean(msg.liveReveal)}
        />
      ) : showRich &&
        (msg.visualContext?.kind === 'market_analysis' ||
          msg.visualContext?.kind === 'comparable_rentals') ? (
        <AskUloMarketAnswer
          content={displayText}
          visual={msg.visualContext}
          progressive={Boolean(msg.liveReveal)}
        />
      ) : (
        <div className="relative">
          {displayText ? <AskUloMarkdown content={displayText} /> : null}
          {msg.streaming ? <span className="ask-ulo-stream-caret" aria-hidden /> : null}
        </div>
      )}
      {clarifyOptions.length > 0 && onSelectProperty ? (
        <PropertyClarifyChips
          options={clarifyOptions}
          disabled={propertySelectDisabled}
          onSelect={onSelectProperty}
        />
      ) : null}
      {!msg.streaming &&
      (msg.legalAudit ||
        msg.intent === 'legal' ||
        msg.safetyBoundary?.blocked ||
        (msg.citations?.length ?? 0) > 0) ? (
        <LegalContextBanner
          jurisdiction={msg.jurisdiction}
          legalAudit={msg.legalAudit}
          safetyBoundary={msg.safetyBoundary}
          citations={msg.citations}
        />
      ) : null}
      {msg.counselHandoffDone ? (
        <div className="mt-2 rounded-lg border border-[#d1fae5] bg-[#ecfdf5] px-2.5 py-2 text-[12px] leading-4 text-[#065f46]">
          Flagged for human review. A professional should make the judgment call — Ulo stays in
          explanation mode.
        </div>
      ) : null}
      {msg.complete && !msg.streaming && displayText.trim() ? (
        <MessageActions
          text={displayText}
          feedback={feedback}
          overrideReason={overrideReason}
          showOverrideReasons={
            feedback === 'down' && Boolean(msg.evalId) && !msg.counselHandoffDone
          }
          onOverrideReason={(reason) => {
            setOverrideReason(reason)
            submitFeedback('down', reason)
          }}
          onFeedback={(value) => {
            submitFeedback(value, value === 'down' ? overrideReason : null)
            if (value === 'down' && handoffAvailable && !msg.counselHandoffDone) {
              setHandoffOpen(true)
            } else {
              setHandoffOpen(false)
            }
          }}
          onRegenerate={onRegenerate}
        />
      ) : null}
      {handoffAvailable ? (
        <CounselHandoffModal
          open={handoffOpen}
          onClose={() => setHandoffOpen(false)}
          msg={msg}
          conversationId={conversationId}
          lastUserQuestion={lastUserQuestion}
          onFlagged={onCounselFlagged}
        />
      ) : null}
    </>
  )
}

/** Ask Ulo composer + chat for the operations overview area. */
export function AskUloPanel({ onClose, variant = 'full' }: AskUloPanelProps) {
  const titleId = useId()
  const inputId = useId()
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const requestGenRef = useRef(0)
  const streamAbortRef = useRef<AbortController | null>(null)
  const isRail = variant === 'rail'
  const {
    conversationId,
    setConversationId,
    persistEnabled,
    refreshConversations,
    pendingPrompt,
    clearPendingPrompt,
  } = useAskUlo()

  const [draft, setDraft] = useState('')
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [loading, setLoading] = useState(false)
  const [hydrating, setHydrating] = useState(false)
  const [statusLine, setStatusLine] = useState<string | null>(null)
  const [lastPrompt, setLastPrompt] = useState<string | null>(null)
  const [agentMode, setAgentMode] = useState<AskUloAgentMode>('ulo_agent')
  /** Skip one hydrate after we create a thread mid-send (avoid wiping in-flight messages). */
  const skipHydrateOnceRef = useRef(false)
  const canSend = draft.trim().length > 0 && !loading
  const hasMessages = messages.length > 0

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  // Load messages when active conversation changes (or clear on New chat).
  useEffect(() => {
    let cancelled = false
    void (async () => {
      if (!conversationId) {
        setMessages([])
        setDraft('')
        setLastPrompt(null)
        setHydrating(false)
        queueMicrotask(() => inputRef.current?.focus())
        return
      }
      if (skipHydrateOnceRef.current) {
        skipHydrateOnceRef.current = false
        setHydrating(false)
        return
      }
      if (!persistEnabled) {
        setHydrating(false)
        return
      }
      setHydrating(true)
      const rows = await loadAskUloMessages(conversationId)
      if (cancelled) return
      setMessages(
        rows
          .filter((m) => m.role === 'user' || m.role === 'assistant')
          .map((m) => ({
            id: m.id,
            role: m.role as 'user' | 'assistant',
            text: m.content,
            citations: m.citations,
            visualContext:
              (m.metadata?.visualContext as AskUloVisualContext | undefined) ?? null,
            jurisdiction:
              (m.metadata?.jurisdiction as ChatMessage['jurisdiction']) ?? null,
            legalAudit: (m.metadata?.legalAudit as AskUloLegalAudit | undefined) ?? null,
            safetyBoundary:
              (m.metadata?.safetyBoundary as AskUloSafetyBoundary | undefined) ?? null,
            intent: typeof m.metadata?.intent === 'string' ? m.metadata.intent : null,
            evalId: typeof m.metadata?.evalId === 'string' ? m.metadata.evalId : null,
            complete: m.role === 'assistant',
            counselHandoffDone: Boolean(
              m.metadata?.counselHandoffDone || m.metadata?.counselHandoff,
            ),
          })),
      )
      const lastUser = [...rows].reverse().find((m) => m.role === 'user')
      setLastPrompt(lastUser?.content?.trim() || null)
      setHydrating(false)
      queueMicrotask(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'auto', block: 'end' })
      })
    })()
    return () => {
      cancelled = true
    }
  }, [conversationId, persistEnabled])

  useEffect(() => {
    if (!hasMessages) return
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [messages, loading, statusLine, hasMessages])

  function applySuggestion(prompt: string) {
    setDraft(prompt)
    inputRef.current?.focus()
  }

  async function handleSend(overridePrompt?: string, opts?: { regenerate?: boolean }) {
    const question = (overridePrompt ?? draft).trim()
    if (!question || loading) return

    streamAbortRef.current?.abort()
    const gen = ++requestGenRef.current
    const abort = new AbortController()
    streamAbortRef.current = abort

    const history = messages
      .filter((m) => !m.error && !m.pending && (m.role === 'user' || m.role === 'assistant'))
      .map((m) => ({ role: m.role, content: m.text }))

    const userMsg: ChatMessage = {
      id: `u-${Date.now()}`,
      role: 'user',
      text: question,
    }
    const assistantId = `a-${Date.now()}`
    const assistantShell: ChatMessage = {
      id: assistantId,
      role: 'assistant',
      text: '',
      pending: true,
      liveReveal: true,
    }

    setLastPrompt(question)
    setMessages((prev) =>
      opts?.regenerate ? [...prev, assistantShell] : [...prev, userMsg, assistantShell],
    )
    setDraft('')
    setLoading(true)

    const rotateLines = askUloLoadingMessagesForPrompt(question)
    let rotateIdx = 0
    setStatusLine(rotateLines[0] ?? 'Gathering the right context…')
    const rotateTimer = window.setInterval(() => {
      rotateIdx = (rotateIdx + 1) % rotateLines.length
      setStatusLine(rotateLines[rotateIdx] ?? null)
    }, 700)

    let activeConversationId = conversationId

    try {
      if (persistEnabled) {
        const conv = await ensureAskUloConversationForPrompt({
          conversationId,
          prompt: question,
          landlordId: getActiveLandlordId(),
        })
        if (gen !== requestGenRef.current) return
        if (conv) {
          activeConversationId = conv.id
          if (conversationId !== conv.id) {
            skipHydrateOnceRef.current = true
            setConversationId(conv.id)
          }
          if (!opts?.regenerate) {
            const stored = await appendAskUloMessage({
              conversationId: conv.id,
              role: 'user',
              content: question,
              landlordId: getActiveLandlordId(),
            })
            if (gen !== requestGenRef.current) return
            if (stored) {
              setMessages((prev) =>
                prev.map((m) => (m.id === userMsg.id ? { ...m, id: stored.id } : m)),
              )
            }
          }
          void refreshConversations()
        }
      }

      const result = await postAskUlo({
        question,
        landlordId: getActiveLandlordId(),
        history,
        conversationId: activeConversationId,
        agentMode,
      })
      if (gen !== requestGenRef.current) return

      window.clearInterval(rotateTimer)
      setStatusLine(null)

      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId
            ? {
                ...m,
                pending: false,
                streaming: true,
                text: '',
                mode: result.mode,
              }
            : m,
        ),
      )

      await streamAskUloAnswer(
        result.answer,
        (partial) => {
          if (gen !== requestGenRef.current) return
          setMessages((prev) =>
            prev.map((m) => (m.id === assistantId ? { ...m, text: partial } : m)),
          )
        },
        { signal: abort.signal },
      )
      if (gen !== requestGenRef.current) return

      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId
            ? {
                ...m,
                text: result.answer,
                citations: result.citations,
                visualContext: result.visualContext ?? null,
                jurisdiction: result.jurisdiction ?? null,
                legalAudit: result.legalAudit ?? null,
                safetyBoundary: result.safetyBoundary ?? null,
                intent: result.intent ?? null,
                evalId: result.evalId ?? null,
                mode: result.mode,
                streaming: false,
                pending: false,
                liveReveal: true,
                complete: true,
              }
            : m,
        ),
      )

      if (persistEnabled && activeConversationId) {
        const stored = await appendAskUloMessage({
          conversationId: activeConversationId,
          role: 'assistant',
          content: result.answer,
          citations: result.citations,
          toolsUsed: result.toolsUsed,
          model: result.model,
          landlordId: getActiveLandlordId(),
          metadata: {
            mode: result.mode,
            intent: result.intent ?? null,
            agentMode: result.agentMode ?? agentMode,
            evalId: result.evalId ?? null,
            visualContext: result.visualContext ?? null,
            jurisdiction: result.jurisdiction ?? null,
            legalAudit: result.legalAudit ?? null,
            safetyBoundary: result.safetyBoundary ?? null,
          },
        })
        if (gen !== requestGenRef.current) return
        if (stored) {
          setMessages((prev) =>
            prev.map((m) => (m.id === assistantId ? { ...m, id: stored.id } : m)),
          )
        }
        void refreshConversations()
      }
    } catch (err) {
      if (gen !== requestGenRef.current) return
      window.clearInterval(rotateTimer)
      setStatusLine(null)
      const message = err instanceof Error ? err.message : 'Ask Ulo failed'
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId
            ? {
                ...m,
                text: message,
                error: true,
                pending: false,
                streaming: false,
                complete: false,
              }
            : m,
        ),
      )
    } finally {
      if (gen === requestGenRef.current) {
        window.clearInterval(rotateTimer)
        setLoading(false)
        setStatusLine(null)
        queueMicrotask(() => inputRef.current?.focus())
      }
    }
  }

  const handleSendRef = useRef(handleSend)
  handleSendRef.current = handleSend

  // Defer consume so React Strict Mode remount (and docked panel mount) does not
  // clear the prompt before a stable panel can send it — otherwise the first
  // search-suggestion click opens Ask Ulo empty and only the second click sends.
  useEffect(() => {
    if (!pendingPrompt || loading || hydrating) return
    const q = pendingPrompt.trim()
    if (!q) {
      clearPendingPrompt()
      return
    }
    let cancelled = false
    const timer = window.setTimeout(() => {
      if (cancelled) return
      clearPendingPrompt()
      void handleSendRef.current(q)
    }, 0)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [pendingPrompt, loading, hydrating, clearPendingPrompt])

  return (
    <section
      aria-labelledby={titleId}
      className={[
        'relative flex min-h-0 flex-1 flex-col overflow-hidden',
        isRail ? 'pb-6 pt-2' : 'pb-10 pt-3',
      ].join(' ')}
      style={{
        backgroundColor: '#ffffff',
        backgroundImage:
          'conic-gradient(from 45deg at 50% 50%, #ffffff, #f0fdf4, #ffffff, #f0fdf4, #ffffff)',
      }}
    >
      <button
        type="button"
        onClick={onClose}
        className={[
          'absolute top-1.5 z-20 inline-flex size-8 cursor-pointer items-center justify-center rounded-[10px] text-[#6a7282] outline-none transition-colors hover:bg-[#e5e7eb]/70 hover:text-[#0a0a0a] focus-visible:ring-2 focus-visible:ring-[#101828] focus-visible:ring-offset-2',
          isRail ? 'right-3' : 'right-4 sm:right-6',
        ].join(' ')}
        aria-label="Close Ask Ulo"
      >
        <CloseIcon />
      </button>

      {!hasMessages && !hydrating ? (
        <div
          className={[
            'mx-auto flex w-full flex-col items-center px-4',
            isRail
              ? 'max-w-none pt-5'
              : 'max-w-[720px] pt-6 sm:px-8 sm:pt-8',
          ].join(' ')}
        >
          <img
            src={sandboxLogo}
            alt=""
            className={isRail ? 'size-8 object-contain' : 'size-9 object-contain'}
            aria-hidden
          />

          <h1
            id={titleId}
            className={[
              'mt-3 text-center font-semibold tracking-[-0.4px] text-[#0a0a0a]',
              isRail
                ? 'text-[20px] leading-6'
                : 'text-[24px] leading-7 sm:text-[28px]',
            ].join(' ')}
          >
            Ask Ulo
          </h1>
          <p
            className={[
              'mt-1.5 text-center text-[13px] leading-4 text-[#6a7282]',
              isRail ? 'max-w-[320px]' : 'max-w-[420px]',
            ].join(' ')}
          >
            Everything a landlord needs to know, in one conversation.
          </p>
      

          <div
            className="relative mt-4 w-full max-w-[480px] overflow-hidden [mask-image:linear-gradient(to_right,transparent,black_14%,black_86%,transparent)] [-webkit-mask-image:linear-gradient(to_right,transparent,black_14%,black_86%,transparent)]"
            aria-hidden
          >
            <div className="flex w-max animate-[ask-ulo-icon-marquee_28s_linear_infinite] gap-8 motion-reduce:animate-none">
              {[0, 1].map((copy) => (
                <div key={copy} className="flex shrink-0 items-center gap-8">
                  {LANDING_DOCUMENT_IMPORT_ICONS.map((Icon) => (
                    <span
                      key={`${copy}-${Icon.name}`}
                      className="inline-flex drop-shadow-[0_1px_1px_rgba(15,23,42,0.24)] drop-shadow-[0_1px_2px_rgba(15,23,42,0.18)]"
                    >
                      <Icon className="size-[25px] shrink-0" />
                    </span>
                  ))}
                </div>
              ))}
            </div>
          </div>

          <div className="mt-5 w-full">
            <Composer
              id={inputId}
              draft={draft}
              setDraft={setDraft}
              canSend={canSend}
              loading={loading}
              onSend={() => void handleSend()}
              inputRef={inputRef}
              agentMode={agentMode}
              onAgentModeChange={setAgentMode}
            />
          </div>

          <div
            className={[
              'mt-4 grid w-full gap-3',
              isRail ? 'grid-cols-1' : 'sm:grid-cols-2',
            ].join(' ')}
          >
            {SUGGESTIONS.map((suggestion) => (
              <button
                key={suggestion.id}
                type="button"
                onClick={() => applySuggestion(suggestion.prompt)}
                className="flex min-h-[52px] cursor-pointer items-center gap-2.5 rounded-[14px] border border-[#e5e7eb] bg-white px-4 py-3 text-left text-[13px] font-medium leading-5 text-[#0a0a0a] outline-none transition-colors hover:border-[#d1d5dc] hover:bg-[#fafafa] focus-visible:ring-2 focus-visible:ring-[#101828] focus-visible:ring-offset-2"
              >
                <SuggestionIcon kind={suggestion.icon} />
                <span>{suggestion.prompt}</span>
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className={`flex min-h-0 w-full flex-1 flex-col ${isRail ? 'pt-3' : 'pt-4'}`}>
          <div
            className={[
              'mx-auto mb-2.5 flex h-8 w-full items-center gap-2.5 px-4',
              isRail ? 'max-w-none pr-11' : 'max-w-[720px] sm:px-8',
            ].join(' ')}
          >
            <img
              src={sandboxLogo}
              alt=""
              className="block size-8 shrink-0 object-contain"
              aria-hidden
            />
            <h1
              id={titleId}
              className="m-0 translate-y-px text-[18px] font-semibold leading-8 tracking-[-0.2px] text-[#0a0a0a]"
            >
              Ask Ulo
            </h1>
            {hydrating ? (
              <span className="translate-y-px text-[12px] leading-8 text-[#9ca3af]">
                Restoring…
              </span>
            ) : null}
          </div>

          <div className="min-h-0 w-full flex-1 overflow-y-auto overscroll-y-contain [scrollbar-gutter:stable]">
            <div
              className={[
                'mx-auto w-full space-y-4 px-4 pb-4',
                isRail ? 'max-w-none' : 'max-w-[720px] sm:px-8',
              ].join(' ')}
            >
              {messages.map((msg, index) => {
                const regeneratePrompt =
                  msg.role === 'assistant'
                    ? (() => {
                        for (let i = index - 1; i >= 0; i -= 1) {
                          const prior = messages[i]
                          if (prior?.role === 'user' && prior.text.trim()) {
                            return prior.text.trim()
                          }
                        }
                        return lastPrompt?.trim() || null
                      })()
                    : null
                return (
                <div
                  key={msg.id}
                  className={`ask-ulo-msg-enter flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    className={
                      msg.role === 'user'
                        ? 'max-w-[85%] rounded-[16px] bg-[#B4DFD6] px-4 py-3 text-[14px] leading-5 text-[#0a0a0a]'
                        : `w-full max-w-[100%] px-1 py-1 text-[14px] leading-5 ${
                            msg.error
                              ? 'rounded-[16px] border border-[#fecaca] bg-[#fef2f2] px-4 py-3 text-[#991b1b]'
                              : 'text-[#0a0a0a]'
                          }`
                    }
                  >
                    {msg.role === 'assistant' ? (
                      <AssistantBody
                        msg={msg}
                        statusLine={msg.pending ? statusLine : null}
                        conversationId={conversationId}
                        lastUserQuestion={lastPrompt}
                        onCounselFlagged={(messageId, confirmationMarkdown) => {
                          setMessages((prev) => {
                            const next = prev.map((m) =>
                              m.id === messageId
                                ? { ...m, counselHandoffDone: true }
                                : m,
                            )
                            const confirmId = `local-handoff-${Date.now()}`
                            return [
                              ...next,
                              {
                                id: confirmId,
                                role: 'assistant' as const,
                                text: confirmationMarkdown,
                                complete: true,
                                intent: 'legal',
                              },
                            ]
                          })
                          if (persistEnabled && conversationId) {
                            void appendAskUloMessage({
                              conversationId,
                              role: 'assistant',
                              content: confirmationMarkdown,
                              landlordId: getActiveLandlordId(),
                              metadata: {
                                intent: 'legal',
                                counselHandoff: true,
                              },
                            }).then(() => {
                              void refreshConversations()
                            })
                            // Mark source message metadata when persisted id is real.
                            if (!messageId.startsWith('local-')) {
                              // Best-effort: conversation reload will not lose handoff confirmation message.
                            }
                          }
                        }}
                        onRegenerate={
                          msg.complete && regeneratePrompt
                            ? () => {
                                if (loading) return
                                void handleSend(regeneratePrompt, { regenerate: true })
                              }
                            : undefined
                        }
                        propertySelectDisabled={loading}
                        onSelectProperty={(building) => {
                          const prior = lastPrompt?.trim()
                          const followUp = prior
                            ? `${prior.replace(/\?+$/, '')} at ${building}?`
                            : building
                          void handleSend(followUp)
                        }}
                      />
                    ) : (
                      <div className="whitespace-pre-wrap">{msg.text}</div>
                    )}
                  </div>
                </div>
                )
              })}
              <div ref={messagesEndRef} />
            </div>
          </div>

          <div
            className={[
              'mx-auto w-full shrink-0 px-4 pt-2',
              isRail ? 'max-w-none' : 'max-w-[720px] sm:px-8',
            ].join(' ')}
          >
            <Composer
              id={inputId}
              draft={draft}
              setDraft={setDraft}
              canSend={canSend}
              loading={loading}
              onSend={() => void handleSend()}
              inputRef={inputRef}
              agentMode={agentMode}
              onAgentModeChange={setAgentMode}
            />
            <p className="mt-2 px-1 text-center text-[11px] leading-4 text-[#9ca3af]">
            I help you make informed decisions, I don't take legal or financial actions on your behalf.
            </p>
          </div>
        </div>
      )}
    </section>
  )
}
