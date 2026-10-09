// A small HTTP client of the instance with a cookie jar and the CSRF token: what the panel's own pages do. Used for the
// set-up only (settings, catalogue, keys, front-end mode, order checks); the visitor's side runs in a real browser.

export class Api {
  /** @param {string} baseUrl */
  constructor(baseUrl) {
    this.baseUrl = baseUrl.replace(/\/$/, '')
    /** @type {Map<string, string>} */
    this.cookies = new Map()
    /** @type {string|null} */
    this.csrfToken = null
  }

  /**
   * @param {string} method
   * @param {string} path `/api/v1/...`
   * @param {unknown} [body] an object (JSON), a FormData, or nothing
   * @param {Record<string, string>} [headers]
   * @returns {Promise<{ status: number, json: any, text: string, error: any }>}
   */
  async request(method, path, body, headers = {}) {
    /** @type {RequestInit & { headers: Record<string, string> }} */
    const init = { method, headers: { Accept: 'application/json', ...headers }, redirect: 'manual' }

    if (this.cookies.size) {
      init.headers.Cookie = [...this.cookies].map(([name, value]) => `${name}=${value}`).join('; ')
    }
    if (this.csrfToken) init.headers['X-CSRF-Token'] = this.csrfToken

    if (body instanceof FormData) {
      init.body = body
    } else if (body !== undefined && body !== null) {
      init.body = JSON.stringify(body)
      init.headers['Content-Type'] = 'application/json'
    }

    const res = await fetch(this.baseUrl + path, init)

    for (const raw of res.headers.getSetCookie?.() ?? []) {
      const pair = raw.split(';')[0]
      const at = pair.indexOf('=')
      const name = pair.slice(0, at).trim()
      const value = pair.slice(at + 1).trim()

      if (!name) continue
      if (value) this.cookies.set(name, value)
      else this.cookies.delete(name)
    }

    const text = await res.text()
    let json = null

    try {
      json = JSON.parse(text)
    } catch {
      // not JSON
    }

    return { status: res.status, json, text, error: json?.error ?? null }
  }

  /** @param {string} path @param {Record<string, string>} [headers] */
  get(path, headers) {
    return this.request('GET', path, undefined, headers)
  }

  /** @param {string} path @param {unknown} [body] @param {Record<string, string>} [headers] */
  post(path, body = {}, headers) {
    return this.request('POST', path, body, headers)
  }

  /** @param {string} path @param {unknown} [body] */
  put(path, body = {}) {
    return this.request('PUT', path, body)
  }

  /** @param {string} path */
  delete(path) {
    return this.request('DELETE', path)
  }

  /** A multipart form of text fields (the panel's settings and product forms). @param {string} method @param {string} path @param {Record<string, unknown>} fields */
  multipart(method, path, fields) {
    const form = new FormData()
    for (const [name, value] of Object.entries(fields)) form.append(name, String(value))
    return this.request(method, path, form)
  }

  /** Sign in as the panel admin. @param {string} usernameOrEmail @param {string} password */
  async loginPanel(usernameOrEmail, password) {
    const res = await this.post('/api/v1/auth/login', { usernameOrEmail, password, panel: true })

    if (res.json?.csrfToken) this.csrfToken = res.json.csrfToken
    return res
  }
}

/** Throw unless the answer is 2xx; the message names the step and shows Pano's error. @template {{ status: number, text: string }} T @param {T} res @param {string} what */
export function must(res, what) {
  if (res.status < 200 || res.status > 299) {
    throw new Error(`${what}: HTTP ${res.status} ${res.text.slice(0, 300)}`)
  }

  return res
}
