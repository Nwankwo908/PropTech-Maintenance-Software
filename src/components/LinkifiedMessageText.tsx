import { splitMessageTextWithUrls } from '@/lib/linkifyMessageText'

type LinkifiedMessageTextProps = {
  text: string
}

/** Render SMS/email body text with http(s) URLs as links. */
export function LinkifiedMessageText({ text }: LinkifiedMessageTextProps) {
  const parts = splitMessageTextWithUrls(text)
  if (parts.length === 0) return null
  return (
    <>
      {parts.map((part, index) =>
        part.type === 'url' ? (
          <a
            key={`url-${index}`}
            href={part.href}
            target="_blank"
            rel="noopener noreferrer"
            className="break-all font-medium text-[#1447e6] underline underline-offset-2"
          >
            {part.text}
          </a>
        ) : (
          <span key={`text-${index}`}>{part.text}</span>
        ),
      )}
    </>
  )
}
