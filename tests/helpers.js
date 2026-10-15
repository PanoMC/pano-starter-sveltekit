import { render } from 'svelte/server'
import { copyFileSync, mkdtempSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

/** A Bun.serve stand-in for Pano. Records every request it gets. */
export function startPanoStub() {
  /** @type {{ method: string, path: string, headers: Record<string, string>, body: any }[]} */
  const requests = []
  const state = { plugins: { 'pano-plugin-market': { namespace: 'market' } } }

  const posts = [
    {
      id: 1,
      title: 'Hello world',
      category: { id: -1, title: '-' },
      text: '<p>First &amp; <b>best</b> post&hellip;</p>',
      writer: { username: 'steve' },
      date: 1700000000000,
      thumbnailUrl: null,
      views: 3,
      url: 'hello-world'
    },
    {
      id: 2,
      title: 'Second post',
      category: { title: 'News', url: 'news' },
      text: '<p>More news</p>',
      writer: { username: '-' },
      date: 1700100000000,
      thumbnailUrl: null,
      views: 1,
      url: 'second'
    }
  ]

  const json = (status, body, headers = {}) => Response.json(body, { status, headers })
  const error = (status, code, extra = {}) => json(status, { error: { code, ...extra } })

  const server = Bun.serve({
    port: 0,
    hostname: '127.0.0.1',
    async fetch(request) {
      const url = new URL(request.url)
      const text = await request.text()
      let body = null
      try {
        body = text ? JSON.parse(text) : null
      } catch {
        body = text
      }

      const headers = Object.fromEntries(request.headers)
      requests.push({ method: request.method, path: url.pathname + url.search, headers, body })

      const key = headers['x-pano-frontend-key']
      if (key && key !== 'pfk_test') return error(401, 'INVALID_FRONTEND_KEY')

      const ip = headers['x-pano-client-ip']
      const path = url.pathname
      const bearer = headers.authorization?.replace(/^Bearer /, '')

      if (request.method === 'GET' && path === '/api/v1/posts') {
        return json(200, {
          items: posts,
          page: { number: Number(url.searchParams.get('page') ?? 1), size: 5, totalItems: 2, totalPages: 1 }
        })
      }

      if (request.method === 'GET' && path.startsWith('/api/v1/posts/')) {
        const post = posts.find((p) => p.url === decodeURIComponent(path.slice('/api/v1/posts/'.length)))
        if (!post) return error(404, 'POST_NOT_FOUND')
        return json(200, {
          post: { ...post, text: '<p>Full body</p>' },
          previousPost: '-',
          nextPost: { id: 2, title: 'Second post', url: 'second' }
        })
      }

      if (request.method === 'GET' && path === '/api/v1/plugin-packages')
        return json(200, { plugins: state.plugins })

      if (request.method === 'GET' && path === '/api/v1/auth/credentials') {
        if (!bearer?.startsWith('tok-')) return error(401, 'NOT_LOGGED_IN')
        return json(200, {
          username: 'steve',
          email: 's@x.test',
          panelAccess: false,
          permissions: [],
          admin: false
        })
      }

      if (request.method === 'POST' && path === '/api/v1/auth/login') {
        if (!key) return json(200, { csrfToken: 'cookie-session' })
        if (body.usernameOrEmail === 'twofa') {
          if (!body.totpCode) return error(403, 'TWO_FACTOR_REQUIRED')
          if (body.totpCode !== '123456') return error(403, 'TWO_FACTOR_INVALID_CODE')
        }
        if (body.usernameOrEmail === 'captcha' && body.captchaToken !== 'solved')
          return error(403, 'CAPTCHA_VERIFICATION_FAILED')
        if (body.usernameOrEmail === 'social') return json(200, { pendingToken: 'pending-1' })
        if (body.password !== 'secret') return error(400, 'LOGIN_IS_INVALID')
        return json(200, { sessionToken: `tok-${ip ?? 'noip'}`, expiresAt: Date.now() + 3600_000 })
      }

      if (request.method === 'POST' && path === '/api/v1/auth/complete-pending') {
        if (body.pendingToken !== 'pending-1') return error(403, 'INVALID_TOKEN')
        if (body.totpCode !== '123456') return error(403, 'TWO_FACTOR_REQUIRED')
        return json(200, { sessionToken: 'tok-pending', expiresAt: Date.now() + 3600_000 })
      }

      if (request.method === 'POST' && path === '/api/v1/auth/register') {
        if (body.password !== body.passwordRepeat)
          return error(400, 'INVALID_FIELDS', { fields: { passwordRepeat: 'NOT_MATCH' } })
        if (body.email === 'verify@x.test')
          return json(200, { emailVerificationRequired: true, email: body.email })
        return json(200, {
          login: true,
          sessionToken: `tok-${ip ?? 'noip'}`,
          expiresAt: Date.now() + 3600_000
        })
      }

      if (request.method === 'POST' && path === '/api/v1/auth/logout') return json(200, {})

      return error(404, 'NOT_FOUND')
    }
  })

  return {
    url: `http://127.0.0.1:${server.port}`,
    requests,
    state,
    clear: () => (requests.length = 0),
    stop: () => server.stop(true)
  }
}

/** A cookie jar with SvelteKit's `cookies` shape that remembers the options of every set. */
export function fakeCookies(initial = {}) {
  /** @type {Map<string, string>} */
  const jar = new Map(Object.entries(initial))
  /** @type {Record<string, { value: string, options: any }>} */
  const sets = {}
  /** @type {string[]} */
  const deleted = []

  return {
    get: (name) => jar.get(name),
    set: (name, value, options) => {
      jar.set(name, value)
      sets[name] = { value, options }
    },
    delete: (name) => {
      jar.delete(name)
      deleted.push(name)
    },
    sets,
    deleted
  }
}

/**
 * A SvelteKit request event good enough for hooks, loads and actions.
 * @param {{ url?: string, method?: string, headers?: Record<string,string>, form?: Record<string,string>, cookies?: Record<string,string>, peer?: string, params?: Record<string,string> }} [options]
 */
export function makeEvent(options = {}) {
  const url = new URL(options.url ?? 'http://site.test/')
  const headers = new Headers(options.headers ?? {})
  const init = { method: options.method ?? (options.form ? 'POST' : 'GET'), headers }

  if (options.form) init.body = new URLSearchParams(options.form)

  const cookies = fakeCookies(options.cookies)

  return {
    url,
    params: options.params ?? {},
    request: new Request(url, init),
    cookies,
    fetch: globalThis.fetch,
    locals: /** @type {any} */ ({}),
    getClientAddress: () => options.peer ?? '127.0.0.1',
    setHeaders: () => {},
    isDataRequest: false
  }
}

/** Run `handle` from hooks.server.js for an event and return the event (locals filled). */
export async function runHandle(handle, event) {
  const response = await handle({ event, resolve: async () => new Response('ok') })
  return { event, response }
}

/** Await a thrown SvelteKit redirect / error and return it. */
export async function thrown(fn) {
  try {
    await fn()
  } catch (error) {
    return error
  }
  throw new Error('expected a throw')
}

/** Render a page component to HTML. */
export async function renderPage(Component, props) {
  const { body } = render(Component, { props })
  return body
}

/**
 * The app entry (index.js) in a folder of its own, next to a link to this checkout's build/: started from here it never
 * reads a developer's `.env`. Returns the path of that index.js.
 */
export function stageEntry() {
  const repo = resolve(import.meta.dir, '..')
  const dir = mkdtempSync(join(tmpdir(), 'pano-starter-'))
  copyFileSync(join(repo, 'index.js'), join(dir, 'index.js'))
  symlinkSync(join(repo, 'build'), join(dir, 'build'))
  return join(dir, 'index.js')
}
