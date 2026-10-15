import { redirect } from '@sveltejs/kit'
import { logout } from '#lib/pano/core/index.js'
import { SESSION_COOKIE, clearSession } from '#lib/server/pano.js'

/** Logging out is a POST; a visit by link goes home. */
export function load() {
  redirect(303, '/')
}

/** @type {import('@sveltejs/kit').Actions} */
export const actions = {
  default: async (event) => {
    if (event.cookies.get(SESSION_COOKIE)) {
      // Tell Pano first so the session ends there too; the cookie goes either way.
      await logout(/** @type {any} */ (event.locals).pano)
    }

    clearSession(event)
    redirect(303, '/')
  }
}
