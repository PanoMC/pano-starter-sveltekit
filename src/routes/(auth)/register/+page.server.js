import { redirect } from '@sveltejs/kit'
import { register } from '#lib/pano/core/index.js'
import { KEY_MESSAGE } from '#lib/server/pano.js'
import { failureToForm, keyMissing, hasFrontendKey, startSession, text } from '#lib/server/auth-flow.js'

/** @type {import('@sveltejs/kit').ServerLoad} */
export async function load({ locals }) {
  if (/** @type {any} */ (locals).user) redirect(303, '/')

  return { keyMissing: !hasFrontendKey(), keyMessage: KEY_MESSAGE }
}

/** @type {import('@sveltejs/kit').Actions} */
export const actions = {
  default: async (event) => {
    const form = await event.request.formData()
    const username = text(form, 'username').trim()
    const email = text(form, 'email').trim()
    const password = text(form, 'password')
    const passwordRepeat = text(form, 'passwordRepeat')
    const agreement = form.get('agreement') === 'on' || form.get('agreement') === 'true'

    // Passwords are never put back into the page.
    const values = { username, email }

    // Registering without a key would work, but Pano would see every sign-up from this server's IP.
    if (!hasFrontendKey()) return keyMissing(values)

    /** @type {import('#lib/pano/core/types.js').RegisterRequest} */
    const body = { email, password, passwordRepeat, agreement }
    if (username) body.username = username

    const result = await register(/** @type {any} */ (event.locals).pano, { body })

    if (!result.ok) return failureToForm(result, values)

    if (result.data.sessionToken) return startSession(event, result.data, '/')

    if (result.data.emailVerificationRequired) {
      return { verify: true, email: result.data.email ?? email }
    }

    // Created, nothing more to do: the visitor signs in.
    return { created: true, email }
  }
}
