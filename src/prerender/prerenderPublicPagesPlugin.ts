import { existsSync } from 'node:fs'
import path from 'node:path'
import { createServer, type Plugin } from 'vite'

/**
 * Prerender /terms and /privacy after the client bundle writes dist/index.html.
 * Vite 8 / Rolldown can invoke closeBundle before that file exists; waiting keeps
 * the build from failing with ENOENT and masking the real bundle error.
 */
export function prerenderPublicPagesPlugin(): Plugin {
  let outDir = ''
  let root = ''
  let ran = false
  let capturedHtml = ''

  return {
    name: 'prerender-public-pages',
    apply: 'build',
    enforce: 'post',
    configResolved(config) {
      root = config.root
      outDir = path.resolve(config.root, config.build.outDir)
    },
    transformIndexHtml: {
      order: 'post',
      handler(html) {
        capturedHtml = html
        return html
      },
    },
    async closeBundle() {
      const environmentName = (this as { environment?: { name?: string } }).environment?.name
      if (environmentName && environmentName !== 'client') return
      if (ran || process.env.VITEST) return

      const indexPath = path.join(outDir, 'index.html')
      if (!existsSync(indexPath) && !capturedHtml) {
        // Bundle did not produce a shell (often a prior transform/bind error).
        // Do not throw here — surface the underlying build failure instead.
        return
      }

      if (!existsSync(indexPath) && capturedHtml) {
        // HTML transformed but not flushed yet; wait briefly for disk write.
        const deadline = Date.now() + 5000
        while (!existsSync(indexPath) && Date.now() < deadline) {
          await new Promise((resolve) => setTimeout(resolve, 50))
        }
      }

      if (!existsSync(indexPath)) {
        console.warn(
          '[prerender-public-pages] Skipping terms/privacy prerender; dist/index.html was not written.',
        )
        return
      }

      ran = true
      const server = await createServer({
        root,
        appType: 'custom',
        logLevel: 'error',
        server: { middlewareMode: true, hmr: false },
      })
      try {
        const mod = await server.ssrLoadModule('/src/prerender/renderPublicPages.tsx')
        mod.writePrerenderedPages(outDir)
      } finally {
        await server.close()
      }
    },
  }
}
