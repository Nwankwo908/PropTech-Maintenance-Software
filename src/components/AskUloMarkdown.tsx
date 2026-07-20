import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { Components } from 'react-markdown'
import type { ReactNode } from 'react'

function flattenText(node: ReactNode): string {
  if (node == null || typeof node === 'boolean') return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(flattenText).join('')
  if (typeof node === 'object' && 'props' in node) {
    const props = (node as { props?: { children?: ReactNode } }).props
    return flattenText(props?.children)
  }
  return ''
}

const components: Components = {
  h1: ({ children }) => (
    <h2 className="mt-4 mb-1.5 text-[15px] font-semibold leading-5 tracking-[-0.15px] text-[#0a0a0a] first:mt-0">
      {children}
    </h2>
  ),
  h2: ({ children }) => (
    <h2 className="mt-4 mb-1.5 text-[15px] font-semibold leading-5 tracking-[-0.15px] text-[#0a0a0a] first:mt-0">
      {children}
    </h2>
  ),
  h3: ({ children }) => (
    <h3 className="mt-3 mb-1 text-[14px] font-semibold leading-5 text-[#0a0a0a] first:mt-0">
      {children}
    </h3>
  ),
  p: ({ children }) => {
    const flat = flattenText(children).trimStart()
    const isCallout =
      flat.startsWith('⚠️') || flat.startsWith('✅') || flat.startsWith('💡')

    if (isCallout) {
      return (
        <p className="mt-3 mb-1 rounded-[10px] border border-[#e5e7eb] bg-[#f9fafb] px-3 py-2 text-[13px] font-semibold leading-5 text-[#0a0a0a] first:mt-0">
          {children}
        </p>
      )
    }

    return (
      <p className="my-1.5 text-[14px] leading-5 tracking-[-0.15px] text-[#0a0a0a] first:mt-0 last:mb-0">
        {children}
      </p>
    )
  },
  ul: ({ children }) => (
    <ul className="my-1.5 list-disc space-y-1 pl-5 text-[14px] leading-5 text-[#0a0a0a]">
      {children}
    </ul>
  ),
  ol: ({ children }) => (
    <ol className="my-1.5 list-decimal space-y-1 pl-5 text-[14px] leading-5 text-[#0a0a0a]">
      {children}
    </ol>
  ),
  li: ({ children }) => <li className="pl-0.5">{children}</li>,
  strong: ({ children }) => (
    <strong className="font-semibold text-[#0a0a0a]">{children}</strong>
  ),
  a: ({ href, children }) => (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="font-medium text-[#0A4D38] underline-offset-2 hover:underline"
    >
      {children}
    </a>
  ),
  table: ({ children }) => (
    <div className="my-3 overflow-x-auto rounded-[10px] border border-[#e5e7eb]">
      <table className="w-full min-w-[280px] border-collapse text-left text-[13px] leading-4">
        {children}
      </table>
    </div>
  ),
  thead: ({ children }) => <thead className="bg-[#f9fafb]">{children}</thead>,
  th: ({ children }) => (
    <th className="border-b border-[#e5e7eb] px-3 py-2 font-semibold text-[#0a0a0a]">
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td className="border-b border-[#e5e7eb] px-3 py-2 text-[#364153] last:border-b-0">
      {children}
    </td>
  ),
  hr: () => <hr className="my-3 border-[#e5e7eb]" />,
  blockquote: ({ children }) => (
    <blockquote className="my-2 border-l-2 border-[#0A4D38]/40 pl-3 text-[13px] leading-5 text-[#364153]">
      {children}
    </blockquote>
  ),
  code: ({ children }) => (
    <code className="rounded bg-[#f3f4f6] px-1 py-0.5 text-[12px] text-[#101828]">
      {children}
    </code>
  ),
}

/** Renders Ask Ulo assistant markdown with scannable hierarchy. */
export function AskUloMarkdown({ content }: { content: string }) {
  return (
    <div className="ask-ulo-markdown min-w-0">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {content}
      </ReactMarkdown>
    </div>
  )
}
