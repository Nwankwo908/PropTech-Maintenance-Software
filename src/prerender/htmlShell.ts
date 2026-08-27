const ROOT_MARKER = '<div id="root"></div>'

export function applyDocumentHead(
  html: string,
  meta: { title: string; description: string; canonical: string },
): string {
  let next = html.replace(/<title>[\s\S]*?<\/title>/, `<title>${escapeAttr(meta.title)}</title>`)
  next = replaceMetaContent(next, 'name', 'description', meta.description)
  next = replaceMetaContent(next, 'property', 'og:title', meta.title)
  next = replaceMetaContent(next, 'property', 'og:description', meta.description)
  next = replaceMetaContent(next, 'property', 'og:url', meta.canonical)
  next = replaceMetaContent(next, 'name', 'twitter:title', meta.title)
  next = replaceMetaContent(next, 'name', 'twitter:description', meta.description)
  next = next.replace(
    /(<link\s+rel="canonical"\s+href=")[^"]*("\s*\/>)/,
    `$1${escapeAttr(meta.canonical)}$2`,
  )
  return next
}

export function applyRootMarkup(html: string, markup: string): string {
  if (!html.includes(ROOT_MARKER)) {
    throw new Error('index.html is missing an empty <div id="root"></div> marker')
  }
  return html.replace(ROOT_MARKER, `<div id="root">${markup}</div>`)
}

function replaceMetaContent(
  html: string,
  attr: 'name' | 'property',
  key: string,
  content: string,
): string {
  const loose = new RegExp(
    `(<meta[\\s\\S]*?${attr}="${escapeRegExp(key)}"[\\s\\S]*?content=")[^"]*(")`,
    'i',
  )
  if (!loose.test(html)) {
    throw new Error(`Missing meta ${attr}="${key}" in HTML shell`)
  }
  return html.replace(loose, `$1${escapeAttr(content)}$2`)
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
