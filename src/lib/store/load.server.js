// Shared by the store routes' server loads.
import { error } from '@sveltejs/kit'

/** What the store routes say when Pano has no market plugin. */
export const NOT_INSTALLED = 'The market plugin is not installed on this Pano'

/** Does this Pano run the market plugin? `locals.plugins` is filled by hooks.server.js. @param {any} locals */
export function hasMarket(locals) {
  return Boolean(locals?.plugins?.has('market'))
}

/**
 * Turn a failed Pano answer into a SvelteKit error page.
 * @param {import('@panomc/client').ApiFailure} result
 * @returns {never}
 */
export function failPage(result) {
  if (result.status === 404 || result.error.code === 'PAGE_NOT_FOUND') error(404, 'Not found')
  if (result.status === 0) error(502, 'Pano did not answer.')
  error(
    result.status >= 400 && result.status < 600 ? result.status : 502,
    result.error.message || result.error.code
  )
}

/** A positive integer from a query value, else `fallback`. @param {string|null} value @param {number} fallback */
export function positiveInt(value, fallback) {
  const n = Number.parseInt(value ?? '', 10)
  return Number.isFinite(n) && n > 0 ? n : fallback
}
