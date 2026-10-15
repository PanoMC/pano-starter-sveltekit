import { getCredentials } from '#lib/pano/core/index.js'
import { loopbackRedirect } from '#lib/server/canonical.js'
import { SESSION_COOKIE, clearSession, panoFor, plugins } from '#lib/server/pano.js'

/**
 * Every request: build the Pano client from the cookie, load the signed-in user once, know the installed plugins.
 * @type {import('@sveltejs/kit/hooks').Handle}
 */
export async function handle({ event, resolve }) {
  // localhost and 127.0.0.1 are two origins: a page opened through the other one goes to ORIGIN, so forms work.
  const elsewhere = loopbackRedirect(event)

  if (elsewhere) return elsewhere

  const locals = /** @type {any} */ (event.locals)

  locals.pano = panoFor(event)
  locals.user = null
  locals.plugins = new Set()

  // Built assets need neither.
  if (event.url.pathname.startsWith('/_app/')) return resolve(event)

  if (event.cookies.get(SESSION_COOKIE)) {
    const result = await getCredentials(locals.pano)

    if (result.ok) {
      locals.user = result.data
    } else if (result.status === 401) {
      // The session ended (expired, logged out elsewhere, banned): forget the cookie.
      clearSession(event)
      locals.pano = panoFor(event)
    }
  }

  locals.plugins = await plugins(event)

  return resolve(event)
}
