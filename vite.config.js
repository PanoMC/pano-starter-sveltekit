import adapter from '@sveltejs/adapter-node'
import { sveltekit } from '@sveltejs/kit/vite'
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte'
import { defineConfig } from 'vite'

export default defineConfig({
  // SvelteKit 3 takes its options here; there is no svelte.config.js
  plugins: [sveltekit({ adapter: adapter(), preprocess: vitePreprocess() })],
  // the package zip ships no node_modules, so the client is bundled into the server build
  ssr: { noExternal: ['@panomc/client'] }
})
