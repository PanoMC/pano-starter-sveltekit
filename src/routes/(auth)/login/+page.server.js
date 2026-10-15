import { redirect } from '@sveltejs/kit'
import { completePendingAuth, login } from '#lib/pano/core/index.js'
import { failureToForm, keyMissing, hasFrontendKey, startSession, text } from '#lib/server/auth-flow.js'
import { KEY_MESSAGE, safeNext } from '#lib/server/pano.js'

/** @type {import('@sveltejs/kit').ServerLoad} */
export async function load({ locals, url }) {
  const next = safeNext(url.searchParams.get('next'))
  if (/** @type {any} */ (locals).user) redirect(303, next)

  return { next, keyMissing: !hasFrontendKey(), keyMessage: KEY_MESSAGE }
}

/** The optional fields a step adds; empty ones are not sent. */
const OPTIONAL = ['totpCode', 'captchaToken', 'newUsername', 'registerEmail']

/** @type {import('@sveltejs/kit').Actions} */
export const actions = {
  /** Sign in. Password, 2FA, captcha and the username / email steps are all this one form. (SvelteKit does not mix a default action with named ones.) */
  login: async (event) => {
    const form = await event.request.formData()
    const usernameOrEmail = text(form, 'usernameOrEmail').trim()
    const password = text(form, 'password')
    const next = text(form, 'next')

    // The password is never put back into the page.
    const values = { usernameOrEmail, next }

    if (!hasFrontendKey()) return keyMissing(values)
    if (!usernameOrEmail || !password) {
      return failureToForm(
        {
          ok: false,
          status: 400,
          error: { code: 'INVALID_FIELDS', message: 'Enter your username and password.' }
        },
        values
      )
    }

    /** @type {import('#lib/pano/core/types.js').LoginRequest} */
    const body = { usernameOrEmail, password }
    for (const name of OPTIONAL) {
      const value = text(form, name).trim()
      if (value) /** @type {any} */ (body)[name] = value
    }

    const result = await login(/** @type {any} */ (event.locals).pano, { body })

    if (!result.ok) return failureToForm(result, values)

    if (/** @type {any} */ (result.data).pendingToken && !result.data.sessionToken) {
      return { step: 'pending', pendingToken: /** @type {any} */ (result.data).pendingToken, ...values }
    }

    return startSession(event, result.data, next)
  },

  /** Finish a sign-in Pano parked behind a pending token (for example a 2FA step after a social login). */
  pending: async (event) => {
    const form = await event.request.formData()
    const pendingToken = text(form, 'pendingToken')
    const totpCode = text(form, 'totpCode').trim()
    const next = text(form, 'next')
    const values = { next, step: 'pending', pendingToken }

    if (!hasFrontendKey()) return keyMissing(values)

    const result = await completePendingAuth(/** @type {any} */ (event.locals).pano, {
      body: { pendingToken, ...(totpCode ? { totpCode } : {}) }
    })

    if (!result.ok) {
      // A used or expired token ends the step; after a wrong code the token stays alive: stay on this step.
      if (result.error.code === 'INVALID_TOKEN') return failureToForm(result, { next })
      return failureToForm(result, values, 'pending')
    }

    return startSession(event, result.data, next)
  }
}
