// Lets `bun test` load the SvelteKit modules outside Vite: the server env, $app and .svelte files (compiled for SSR). `#lib/*` is a
// subpath import of package.json, which Bun resolves itself.
import { plugin } from 'bun'
import { compile } from 'svelte/compiler'
import { readFileSync } from 'node:fs'

plugin({
  name: 'sveltekit-test-shims',
  setup(build) {
    // src/lib/server/env.js hands over SvelteKit's $app/env/private; here it is process.env itself, read at call time,
    // so a test changes a variable by setting it.
    build.onLoad({ filter: /\/src\/lib\/server\/env\.js$/ }, () => ({
      contents: 'export const env = process.env',
      loader: 'js'
    }))
    build.module('$app/forms', () => ({
      exports: { enhance: () => ({ destroy() {} }), applyAction: async () => {}, deserialize: JSON.parse },
      loader: 'object'
    }))

    build.onLoad({ filter: /\.svelte$/ }, ({ path }) => {
      const { js } = compile(readFileSync(path, 'utf8'), {
        filename: path,
        generate: 'server',
        css: 'injected'
      })
      return { contents: js.code, loader: 'js' }
    })
  }
})
