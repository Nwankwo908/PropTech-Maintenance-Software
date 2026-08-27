import path from 'node:path'
import { createServer, type Plugin } from 'vite'

export function prerenderPublicPagesPlugin(): Plugin {
  let outDir = ''
  let root = ''
  let ran = false

  return {
    name: 'prerender-public-pages',
    apply: 'build',
    configResolved(config) {
      root = config.root
      outDir = path.resolve(config.root, config.build.outDir)
    },
    async closeBundle() {
      const environmentName = (this as { environment?: { name?: string } }).environment?.name
      if (environmentName && environmentName !== 'client') return
      if (ran || process.env.VITEST) return
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
