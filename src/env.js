// The environment the server reads (SvelteKit 3 needs every variable declared). All are optional: an unset one is
// `undefined`, as process.env would give it.
import { defineEnvVars } from '@sveltejs/kit/env'

/** @param {string | undefined} value */
const optional = (value) => value

export const variables = defineEnvVars({
  API_URL: { description: "Pano's API address, e.g. http://localhost:8088/api", schema: optional },
  PANO_API_URL: {
    description: 'The same address under the name Pano sets for a custom app (wins over API_URL)',
    schema: optional
  },
  PANO_FRONTEND_KEY: {
    description: 'The front-end key from Panel → Appearance → Themes → Site connection keys',
    schema: optional
  },
  PANO_SITE_URL: {
    description: "The site's public address (Pano sets it for a custom app)",
    schema: optional
  },
  ORIGIN: {
    description: 'The public origin when the site sits behind a proxy (index.js applies it)',
    schema: optional
  }
})
