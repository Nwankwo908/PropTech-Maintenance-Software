/**
 * Small verified help corpus for Ask Ulo product-support answers.
 * Only ship facts that match current product behavior.
 */

export type AskUloHelpArticle = {
  id: string
  title: string
  keywords: RegExp
  body: string
}

export const ASK_ULO_HELP_CORPUS: AskUloHelpArticle[] = [
  {
    id: "ask_ulo_overview",
    title: "What Ask Ulo can do",
    keywords: /\b(what\s+(?:can|does)\s+(?:ask\s+)?ulo|ask\s+ulo\s+(?:do|for)|how\s+(?:do\s+i\s+)?use\s+ask\s+ulo)\b/i,
    body:
      "Ask Ulo is your in-dashboard assistant. Ask about your portfolio (open work orders, late rent, vendors, properties) or how to use Ulo. It answers from your account data and verified help — it does not send messages or change settings for you.",
  },
  {
    id: "residents_welcome",
    title: "Start resident onboarding",
    keywords: /\b(how\s+(?:do\s+i\s+)?(?:send|start)\s+(?:a\s+)?(?:welcome|onboarding)|resident\s+onboarding|welcome\s+text)\b/i,
    body:
      "Open **Residents**, select the resident, then use **Start onboarding** (or **Retry onboarding**) when they have a phone number. Welcome texts are not sent automatically when you finish setup unless you turned on that resident’s Onboarding switch.",
  },
  {
    id: "vendor_invite",
    title: "Invite a vendor to verify",
    keywords: /\b(how\s+(?:do\s+i\s+)?(?:invite|verify)\s+(?:a\s+)?vendor|vendor\s+(?:invite|verification|onboarding))\b/i,
    body:
      "Open the vendor’s profile and choose **Send verification invite**. They get a link to confirm business details. Invites are manual unless you enabled that vendor’s Onboarding switch during setup.",
  },
  {
    id: "find_ask_ulo",
    title: "Where to find Ask Ulo",
    keywords: /\b(where\s+(?:is|do\s+i\s+find)\s+ask\s+ulo|open\s+ask\s+ulo|ask\s+ulo\s+(?:panel|chat|button))\b/i,
    body:
      "Ask Ulo opens from the admin sidebar dock (Ask Ulo). It appears as a side rail or full panel while you stay in `/admin`.",
  },
]

export type HelpCorpusMatch = {
  article: AskUloHelpArticle
  answerMarkdown: string
}

export function matchVerifiedHelp(question: string): HelpCorpusMatch | null {
  const q = question.trim()
  if (!q) return null
  for (const article of ASK_ULO_HELP_CORPUS) {
    if (!article.keywords.test(q)) continue
    return {
      article,
      answerMarkdown: [
        `## ${article.title}`,
        "",
        article.body,
      ].join("\n"),
    }
  }
  return null
}
