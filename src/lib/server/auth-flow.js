// Shared by the login and register actions: turn Pano's answers into form results.
import { fail, redirect } from '@sveltejs/kit'
import { KEY_MESSAGE, hasFrontendKey, safeNext, setSession } from '$lib/server/pano.js'

/** Messages for the codes a visitor can fix. Anything else shows Pano's own message, then the code. */
const MESSAGES = {
  LOGIN_IS_INVALID: 'Wrong username or password.',
  LOGIN_EMAIL_NOT_VERIFIED: 'Confirm your email address first. We sent you a link.',
  TWO_FACTOR_REQUIRED: 'Enter the code from your authenticator app.',
  TWO_FACTOR_INVALID_CODE: 'That code is not right. Try the next one.',
  CAPTCHA_REQUIRED: 'Solve the captcha to continue.',
  CAPTCHA_VERIFICATION_FAILED: 'The captcha was not accepted. Try again.',
  USERNAME_REQUIRED: 'Pick a username for your account.',
  REGISTER_EMAIL_REQUIRED: 'Add an email address to your account.',
  INVALID_TOKEN: 'This sign-in step expired. Start again.',
  NETWORK_ERROR: 'Pano did not answer. Try again in a moment.'
}

/** Extra form steps Pano can ask for, by error code. */
const STEPS = {
  TWO_FACTOR_REQUIRED: 'totp',
  TWO_FACTOR_INVALID_CODE: 'totp',
  CAPTCHA_REQUIRED: 'captcha',
  CAPTCHA_VERIFICATION_FAILED: 'captcha',
  USERNAME_REQUIRED: 'username',
  REGISTER_EMAIL_REQUIRED: 'email'
}

/** @param {FormData} form @param {string} name */
export function text(form, name) {
  const value = form.get(name)
  return typeof value === 'string' ? value : ''
}

/**
 * Login and register need a stored front-end key: without it the session token is not in the body and Pano
 * would see every visitor under this server's IP.
 * @param {Record<string, any>} values what to put back into the form
 */
export function keyMissing(values = {}) {
  return fail(503, { ...values, keyMissing: true, message: KEY_MESSAGE })
}

export { hasFrontendKey }

/**
 * @param {import('@panomc/client').ApiFailure} result
 * @param {Record<string, any>} values what to put back into the form (never the password)
 * @param {string} [stayOnStep] keep this step whatever Pano asks for (the pending step re-asks its own code)
 */
export function failureToForm(result, values = {}, stayOnStep) {
  const code = result.error.code

  if (code === 'INVALID_FRONTEND_KEY') return keyMissing(values)

  const step = stayOnStep ?? /** @type {Record<string, string>} */ (STEPS)[code]
  const message = /** @type {Record<string, string>} */ (MESSAGES)[code] || result.error.message || code

  return fail(result.status >= 400 ? result.status : 502, {
    ...values,
    ...(step ? { step } : {}),
    message,
    code,
    fields: result.error.fields ?? {},
    // A step Pano parks behind a token (social login, magic link) stays alive for a retry.
    ...(typeof result.error.details?.pendingToken === 'string'
      ? { step: 'pending', pendingToken: result.error.details.pendingToken }
      : {})
  })
}

/**
 * A 200 from login / register / complete-pending: store the token and leave, or report that Pano sent no token.
 * @param {import('@sveltejs/kit').RequestEvent} event
 * @param {{ sessionToken?: string, expiresAt?: number }} data
 * @param {string} next where to go afterwards
 * @returns {import('@sveltejs/kit').ActionFailure<any> | never}
 */
export function startSession(event, data, next) {
  if (typeof data.sessionToken !== 'string' || !data.sessionToken) {
    return fail(502, {
      message:
        'Pano signed you in but sent no session token. Use a front-end key created in the panel (Appearance → Themes → gear button), not the internal one.',
      code: 'SESSION_TOKEN_MISSING'
    })
  }

  setSession(event, { sessionToken: data.sessionToken, expiresAt: data.expiresAt })
  redirect(303, safeNext(next))
}
