// Entry of the custom app: Pano runs `bun --smol run index.js` with PORT, HOST, API_URL, PANO_API_URL, PANO_FRONTEND_KEY,
// PANO_SITE_URL, PROTOCOL_HEADER and HOST_HEADER in the environment, and this file starts the SvelteKit build next to it.
// `bun run package` puts this file, manifest.json and build/ at the root of the zip. The same build also runs by itself:
// `bun build/index.js` (external upstream or its own origin, with ORIGIN set).
//
// Pano hands a custom app its internal front-end key, and that key gives cookie sessions, not the session token the
// starter keeps in its own cookie, so sign-in needs a key from Panel -> Appearance -> Themes (gear button "Site display settings" -> Site connection keys). A file named `.env`
// next to this one may hold it (one `PANO_FRONTEND_KEY=pfk_...` line); it replaces the internal key and nothing else.
import { existsSync, readFileSync } from 'node:fs'

// Pano's proxy gives the app its own address as the Host header and sends no X-Forwarded-Host, so SvelteKit would take
// http://127.0.0.1:<port> for the site and refuse every form post of the browser as cross-site (HOST_HEADER has nothing to
// read). Pano does pass the public address in PANO_SITE_URL: it is the site's origin.
try {
  const site = new URL(process.env.PANO_SITE_URL ?? '')

  if (!process.env.ORIGIN && /^https?:$/.test(site.protocol)) process.env.ORIGIN = site.origin
} catch {
  // no usable PANO_SITE_URL: leave the origin to the request headers
}

const envFile = new URL('./.env', import.meta.url)

if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const match = /^\s*PANO_FRONTEND_KEY\s*=\s*(.*?)\s*$/.exec(line)
    const value = match?.[1]?.replace(/^(["'])(.*)\1$/, '$2')

    if (value) process.env.PANO_FRONTEND_KEY = value
  }
}

await import('./build/index.js')
