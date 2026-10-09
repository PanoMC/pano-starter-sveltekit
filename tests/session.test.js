import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { handle } from '../src/hooks.server.js'
import { actions as loginActions, load as loginLoad } from '../src/routes/(auth)/login/+page.server.js'
import { actions as registerActions } from '../src/routes/(auth)/register/+page.server.js'
import { actions as logoutActions } from '../src/routes/(auth)/logout/+page.server.js'
import { load as postsLoad } from '../src/routes/(site)/+page.server.js'
import { load as postLoad } from '../src/routes/(site)/post/[url]/+page.server.js'
import {
  SESSION_COOKIE,
  clientIpOf,
  panoFor,
  plugins,
  resetPluginsCache,
  safeNext
} from '../src/lib/server/pano.js'
import { getPosts } from '../src/lib/pano/core/index.js'
import PostsPage from '../src/routes/(site)/+page.svelte'
import PostPage from '../src/routes/(site)/post/[url]/+page.svelte'
import LoginPage from '../src/routes/(auth)/login/+page.svelte'
import RegisterPage from '../src/routes/(auth)/register/+page.svelte'
import { makeEvent, renderPage, runHandle, startPanoStub, thrown } from './helpers.js'

const KEY_MESSAGE =
  'Create a front-end key in Panel → Appearance → Front-end and put it in .env as PANO_FRONTEND_KEY'

let stub

beforeAll(() => {
  stub = startPanoStub()
})
afterAll(() => stub.stop())

beforeEach(() => {
  stub.clear()
  resetPluginsCache()
  process.env.API_URL = `${stub.url}/api`
  delete process.env.PANO_API_URL
  delete process.env.PANO_FRONTEND_KEY
  delete process.env.PANO_SITE_URL
})

/** An event that went through hooks, like a real request. */
async function request(options) {
  const { event } = await runHandle(handle, makeEvent(options))
  return event
}

describe('no front-end key', () => {
  test('posts render and no key header is sent', async () => {
    const event = await request({ url: 'http://site.test/' })
    const data = await postsLoad(event)
    const html = await renderPage(PostsPage, { data })

    expect(html).toContain('Hello world')
    expect(html).toContain('Second post')
    expect(html).toContain('First &amp; best post…')
    expect(html).toContain('href="/post/hello-world"')

    expect(stub.requests.length).toBeGreaterThan(0)
    for (const r of stub.requests) {
      expect(r.headers['x-pano-frontend-key']).toBeUndefined()
      expect(r.headers['x-pano-client-ip']).toBeUndefined()
    }
  })

  test('a post renders with its neighbours', async () => {
    const event = await request({ url: 'http://site.test/post/hello-world', params: { url: 'hello-world' } })
    const data = await postLoad(event)
    const html = await renderPage(PostPage, { data })

    expect(data.previous).toBeNull()
    expect(html).toContain('<p>Full body</p>')
    expect(html).toContain('Second post →')
  })

  test('a missing post is a 404', async () => {
    const event = await request({ url: 'http://site.test/post/nope', params: { url: 'nope' } })
    const error = await thrown(() => postLoad(event))
    expect(error.status).toBe(404)
  })

  test('the login page shows the key message and the action refuses without calling Pano', async () => {
    const event = await request({ url: 'http://site.test/login' })
    const data = await loginLoad(event)
    expect(data.keyMissing).toBe(true)
    expect(await renderPage(LoginPage, { data, form: null })).toContain(KEY_MESSAGE)

    stub.clear()
    const form = makeEvent({ method: 'POST', form: { usernameOrEmail: 'steve', password: 'secret' } })
    form.locals = event.locals
    const result = await loginActions.login(form)

    expect(result.status).toBe(503)
    expect(result.data.keyMissing).toBe(true)
    expect(result.data.message).toBe(KEY_MESSAGE)
    expect(form.cookies.sets[SESSION_COOKIE]).toBeUndefined()
    expect(stub.requests.filter((r) => r.path.includes('/auth/login'))).toHaveLength(0)

    const html = await renderPage(LoginPage, { data, form: result.data })
    expect(html).toContain(KEY_MESSAGE)
    expect(html).not.toContain('secret')
  })

  test('register is refused the same way', async () => {
    const event = await request({})
    const form = makeEvent({
      form: { email: 'a@b.test', password: 'x', passwordRepeat: 'x', agreement: 'on' }
    })
    form.locals = event.locals

    const result = await registerActions.default(form)
    expect(result.data.keyMissing).toBe(true)
    expect(stub.requests.filter((r) => r.path.includes('/auth/register'))).toHaveLength(0)
  })
})

describe('with a front-end key', () => {
  beforeEach(() => {
    process.env.PANO_FRONTEND_KEY = 'pfk_test'
  })

  async function signIn(options = {}, fields = { usernameOrEmail: 'steve', password: 'secret' }) {
    const event = await request(options)
    const form = makeEvent({ ...options, form: fields })
    form.locals = event.locals
    // A success redirects (thrown); a failure is returned.
    const redirect = await loginActions.login(form).catch((thrownValue) => thrownValue)
    return { form, redirect }
  }

  test('the cookie is HttpOnly and holds the token from the body', async () => {
    const { form, redirect } = await signIn({
      url: 'https://site.test/login',
      headers: { 'x-forwarded-for': '203.0.113.9' }
    })

    expect(redirect.status).toBe(303)
    expect(redirect.location).toBe('/')

    const cookie = form.cookies.sets[SESSION_COOKIE]
    expect(cookie.value).toBe('tok-203.0.113.9')
    expect(cookie.options.httpOnly).toBe(true)
    expect(cookie.options.secure).toBe(true)
    expect(cookie.options.sameSite).toBe('lax')
    expect(cookie.options.path).toBe('/')
    expect(cookie.options.expires.getTime()).toBeGreaterThan(Date.now())

    const login = stub.requests.find((r) => r.path === '/api/v1/auth/login')
    expect(login.headers['x-pano-frontend-key']).toBe('pfk_test')
    expect(login.headers.authorization).toBeUndefined()
    expect(login.body).toEqual({ usernameOrEmail: 'steve', password: 'secret' })
  })

  test('two visitors behind Pano keep two client IPs', async () => {
    const a = await signIn({ headers: { 'x-forwarded-for': '203.0.113.9' } })
    const b = await signIn({ headers: { 'x-forwarded-for': '198.51.100.7, 10.0.0.1' } })

    expect(a.form.cookies.sets[SESSION_COOKIE].value).toBe('tok-203.0.113.9')
    expect(b.form.cookies.sets[SESSION_COOKIE].value).toBe('tok-198.51.100.7')

    const ips = stub.requests
      .filter((r) => r.path === '/api/v1/auth/login')
      .map((r) => r.headers['x-pano-client-ip'])
    expect(ips).toEqual(['203.0.113.9', '198.51.100.7'])
  })

  test('a wrong password re-renders the form without the password', async () => {
    const { redirect } = await signIn({}, { usernameOrEmail: 'steve', password: 'hunter2' })
    expect(redirect.status).toBe(400)
    expect(redirect.data.message).toBe('Wrong username or password.')
    expect(redirect.data.usernameOrEmail).toBe('steve')
    expect(JSON.stringify(redirect.data)).not.toContain('hunter2')
  })

  test('an invalid key shows the key message', async () => {
    process.env.PANO_FRONTEND_KEY = 'pfk_wrong'
    const { redirect } = await signIn()
    expect(redirect.data.keyMissing).toBe(true)
    expect(redirect.data.message).toBe(KEY_MESSAGE)
  })

  test('two-factor re-renders the form with the code field and sends the code next time', async () => {
    const first = await signIn({}, { usernameOrEmail: 'twofa', password: 'secret' })
    expect(first.redirect.data.step).toBe('totp')

    const html = await renderPage(LoginPage, {
      data: { next: '/', keyMissing: false },
      form: first.redirect.data
    })
    expect(html).toContain('name="totpCode"')

    const second = await signIn({}, { usernameOrEmail: 'twofa', password: 'secret', totpCode: '123456' })
    expect(second.form.cookies.sets[SESSION_COOKIE]).toBeDefined()
    expect(stub.requests.at(-1).body.totpCode).toBe('123456')
  })

  test('captcha re-renders the form with the captcha field', async () => {
    const first = await signIn({}, { usernameOrEmail: 'captcha', password: 'secret' })
    expect(first.redirect.data.step).toBe('captcha')
    expect(await renderPage(LoginPage, { data: { next: '/' }, form: first.redirect.data })).toContain(
      'name="captchaToken"'
    )

    const second = await signIn(
      {},
      { usernameOrEmail: 'captcha', password: 'secret', captchaToken: 'solved' }
    )
    expect(second.form.cookies.sets[SESSION_COOKIE]).toBeDefined()
  })

  test('a pending session goes through the pending step', async () => {
    const event = await request()
    const form = makeEvent({ form: { usernameOrEmail: 'social', password: 'secret' } })
    form.locals = event.locals
    const parked = await loginActions.login(form)

    expect(parked.step).toBe('pending')
    expect(parked.pendingToken).toBe('pending-1')
    expect(form.cookies.sets[SESSION_COOKIE]).toBeUndefined()
    expect(await renderPage(LoginPage, { data: { next: '/' }, form: parked })).toContain('action="?/pending"')

    const wrong = makeEvent({ form: { pendingToken: 'pending-1', totpCode: '000000' } })
    wrong.locals = event.locals
    const retry = await loginActions.pending(wrong)
    expect(retry.data.step).toBe('pending')
    expect(retry.data.pendingToken).toBe('pending-1')

    const right = makeEvent({ form: { pendingToken: 'pending-1', totpCode: '123456' } })
    right.locals = event.locals
    const done = await thrown(() => loginActions.pending(right))
    expect(done.status).toBe(303)
    expect(right.cookies.sets[SESSION_COOKIE].value).toBe('tok-pending')
  })

  test('next must stay on this site', async () => {
    expect(safeNext('/profile')).toBe('/profile')
    expect(safeNext('//evil.test')).toBe('/')
    expect(safeNext('/\\evil.test')).toBe('/')
    expect(safeNext('https://evil.test')).toBe('/')
    expect(safeNext(null)).toBe('/')

    const { redirect } = await signIn(
      {},
      { usernameOrEmail: 'steve', password: 'secret', next: '//evil.test' }
    )
    expect(redirect.location).toBe('/')
  })

  test('register signs in with the token from the body', async () => {
    const event = await request({ headers: { 'x-forwarded-for': '203.0.113.50' } })
    const form = makeEvent({
      form: { username: 'alex', email: 'a@b.test', password: 'pw', passwordRepeat: 'pw', agreement: 'on' }
    })
    form.locals = event.locals
    const redirect = await thrown(() => registerActions.default(form))

    expect(redirect.status).toBe(303)
    expect(form.cookies.sets[SESSION_COOKIE].options.httpOnly).toBe(true)
    expect(stub.requests.find((r) => r.path === '/api/v1/auth/register').body).toEqual({
      username: 'alex',
      email: 'a@b.test',
      password: 'pw',
      passwordRepeat: 'pw',
      agreement: true
    })
  })

  test('register shows field errors and the verification notice', async () => {
    const event = await request()
    const bad = makeEvent({
      form: { email: 'a@b.test', password: 'pw', passwordRepeat: 'other', agreement: 'on' }
    })
    bad.locals = event.locals
    const failed = await registerActions.default(bad)
    expect(failed.data.fields).toEqual({ passwordRepeat: 'NOT_MATCH' })
    const html = await renderPage(RegisterPage, { data: { keyMissing: false }, form: failed.data })
    expect(html).toContain('NOT_MATCH')
    expect(html).not.toContain('value="other"')

    const verify = makeEvent({
      form: { email: 'verify@x.test', password: 'pw', passwordRepeat: 'pw', agreement: 'on' }
    })
    verify.locals = event.locals
    const result = await registerActions.default(verify)
    expect(result.verify).toBe(true)
    expect(await renderPage(RegisterPage, { data: { keyMissing: false }, form: result })).toContain(
      'verify@x.test'
    )
  })

  test('hooks load the user from the cookie; a 401 clears it', async () => {
    const ok = await request({ cookies: { [SESSION_COOKIE]: 'tok-1.2.3.4' } })
    expect(ok.locals.user.username).toBe('steve')
    expect(stub.requests.find((r) => r.path === '/api/v1/auth/credentials').headers.authorization).toBe(
      'Bearer tok-1.2.3.4'
    )

    const stale = await request({ cookies: { [SESSION_COOKIE]: 'expired' } })
    expect(stale.locals.user).toBeNull()
    expect(stale.cookies.deleted).toContain(SESSION_COOKIE)

    const none = await request()
    expect(none.locals.user).toBeNull()
    expect(none.cookies.deleted).toHaveLength(0)
  })

  test('logout tells Pano, then deletes the cookie', async () => {
    const event = await request({ cookies: { [SESSION_COOKIE]: 'tok-1.2.3.4' } })
    const form = makeEvent({ method: 'POST', cookies: { [SESSION_COOKIE]: 'tok-1.2.3.4' } })
    form.locals = event.locals

    const redirect = await thrown(() => logoutActions.default(form))
    expect(redirect.status).toBe(303)
    expect(form.cookies.deleted).toContain(SESSION_COOKIE)

    const call = stub.requests.find((r) => r.path === '/api/v1/auth/logout')
    expect(call.headers.authorization).toBe('Bearer tok-1.2.3.4')
  })

  test('the plugin list is read once a minute', async () => {
    const first = await request()
    const second = await request()

    expect([...first.locals.plugins]).toEqual(['market'])
    expect([...second.locals.plugins]).toEqual(['market'])
    expect(stub.requests.filter((r) => r.path === '/api/v1/plugin-packages')).toHaveLength(1)
    // public list: never with a visitor's session
    expect(
      stub.requests.find((r) => r.path === '/api/v1/plugin-packages').headers.authorization
    ).toBeUndefined()
  })

  test('a Pano that is down gives an empty plugin set and a 502 on pages', async () => {
    process.env.API_URL = 'http://127.0.0.1:1/api'
    const event = await request()
    expect(event.locals.plugins.size).toBe(0)
    const error = await thrown(() => postsLoad(event))
    expect(error.status).toBe(502)
  })
})

describe('clientIpOf', () => {
  const event = (peer, forwarded) => ({
    request: new Request('http://site.test/', { headers: forwarded ? { 'x-forwarded-for': forwarded } : {} }),
    getClientAddress: () => peer
  })

  test('believes the first hop only behind a loopback or private peer', () => {
    expect(clientIpOf(event('127.0.0.1', '203.0.113.9, 10.0.0.2'))).toBe('203.0.113.9')
    expect(clientIpOf(event('::1', '203.0.113.9'))).toBe('203.0.113.9')
    expect(clientIpOf(event('::ffff:10.1.2.3', '2001:db8::5'))).toBe('2001:db8::5')
    expect(clientIpOf(event('192.168.1.5', '203.0.113.9'))).toBe('203.0.113.9')
    expect(clientIpOf(event('172.20.0.2', '203.0.113.9'))).toBe('203.0.113.9')
  })

  test('a direct visitor cannot choose their IP', () => {
    expect(clientIpOf(event('198.51.100.1', '1.2.3.4'))).toBe('198.51.100.1')
    expect(clientIpOf(event('172.32.0.1', '1.2.3.4'))).toBe('172.32.0.1')
  })

  test('garbage or a missing header falls back to the peer', () => {
    expect(clientIpOf(event('127.0.0.1', 'not-an-ip'))).toBe('127.0.0.1')
    expect(clientIpOf(event('127.0.0.1'))).toBe('127.0.0.1')
    expect(
      clientIpOf({
        request: new Request('http://x/'),
        getClientAddress: () => {
          throw new Error('no address')
        }
      })
    ).toBeUndefined()
  })
})

describe('server calls use the global fetch', () => {
  test('panoFor and plugins ignore event.fetch (it would recurse on the same origin)', async () => {
    const real = globalThis.fetch
    const seen = []
    globalThis.fetch = async (input) => {
      seen.push(String(input instanceof Request ? input.url : input))
      return Response.json({
        plugins: { 'pano-plugin-market': { namespace: 'market' } },
        items: [],
        page: {}
      })
    }
    try {
      const event = makeEvent({ url: 'http://site.test/' })
      event.fetch = () => {
        throw new Error('event.fetch must not be used')
      }
      resetPluginsCache()
      expect((await plugins(event)).has('market')).toBe(true)
      await getPosts(panoFor(event))
      expect(seen.length).toBeGreaterThan(0)
    } finally {
      globalThis.fetch = real
      resetPluginsCache()
    }
  })
})
