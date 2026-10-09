import { sveltekit } from '@sveltejs/kit/vite'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [sveltekit()],
  // the package zip ships no node_modules, so the client is bundled into the server build
  ssr: { noExternal: ['@panomc/client'] }
})
