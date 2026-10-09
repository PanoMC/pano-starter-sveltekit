// Lets `bun test` load the SvelteKit modules outside Vite: $lib, $env, $app and .svelte files (compiled for SSR).
import { plugin } from 'bun'
import { compile } from 'svelte/compiler'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const lib = resolve(import.meta.dir, '../src/lib')

plugin({
  name: 'sveltekit-test-shims',
  setup(build) {
    // The real $env/dynamic/private reads process.env at call time; so does this.
    build.module('$env/dynamic/private', () => ({ exports: { env: process.env }, loader: 'object' }))
    build.module('$app/forms', () => ({
      exports: { enhance: () => ({ destroy() {} }), applyAction: async () => {}, deserialize: JSON.parse },
      loader: 'object'
    }))

    build.onResolve({ filter: /^\$lib(\/|$)/ }, (args) => ({
      path: resolve(lib, args.path.slice('$lib/'.length))
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
