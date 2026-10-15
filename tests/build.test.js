// The production build against the Pano stub: real HTTP, real SvelteKit routing, real Set-Cookie headers.
// Skipped until `bun run build` has produced build/index.js.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { stageEntry, startPanoStub } from './helpers.js'

// the entry applies ORIGIN (adapter-node 6 has no ORIGIN variable of its own); the build must exist
const built = existsSync(resolve(import.meta.dir, '../build/index.js'))

/** @param {Record<string,string>} fields @param {string} ip */
const loginRequest = (origin, fields, ip) => ({
  method: 'POST',
  redirect: 'manual',
  headers: {
    origin,
    accept: 'text/html',
    'content-type': 'application/x-www-form-urlencoded',
    'x-forwarded-for': ip
  },
  body: new URLSearchParams(fields)
})

const entry = built ? stageEntry() : ''

describe.skipIf(!built)('production build', () => {
  /** @type {ReturnType<typeof startPanoStub>} */
  let stub
  /** @type {import('bun').Subprocess[]} */
  const children = []

  /** Start the built server; returns its origin. */
  async function startSite(extraEnv) {
    const probe = Bun.serve({ port: 0, fetch: () => new Response('') })
    const port = probe.port
    probe.stop(true)

    const origin = `http://127.0.0.1:${port}`
    const child = Bun.spawn(['bun', entry], {
      env: {
        ...process.env,
        PORT: String(port),
        HOST: '127.0.0.1',
        ORIGIN: origin,
        API_URL: `${stub.url}/api`,
        ...extraEnv
      },
      stdout: 'ignore',
      stderr: 'ignore'
    })
    children.push(child)

    for (let i = 0; i < 100; i++) {
      try {
        await fetch(origin)
        return origin
      } catch {
        await Bun.sleep(100)
      }
    }
    throw new Error('the built site did not start')
  }

  beforeAll(() => {
    stub = startPanoStub()
  })

  afterAll(() => {
    for (const child of children) child.kill()
    stub.stop()
  })

  test('without a key the posts render and the login page shows the key message', async () => {
    const site = await startSite({ PANO_FRONTEND_KEY: '' })

    const home = await (await fetch(site)).text()
    expect(home).toContain('Hello world')

    const login = await (await fetch(`${site}/login`)).text()
    expect(login).toContain('Create a front-end key in Panel')
    expect(login).toContain('PANO_FRONTEND_KEY')

    const post = await fetch(`${site}/post/missing`)
    expect(post.status).toBe(404)

    const refused = await fetch(
      `${site}/login?/login`,
      loginRequest(site, { usernameOrEmail: 'steve', password: 'secret' }, '203.0.113.9')
    )
    expect(refused.status).toBe(503)
    expect(await refused.text()).toContain('Create a front-end key in Panel')
  })

  test('with a key the cookie is HttpOnly and holds the body token; two visitors keep two IPs', async () => {
    stub.clear()
    const site = await startSite({ PANO_FRONTEND_KEY: 'pfk_test' })

    const a = await fetch(
      `${site}/login?/login`,
      loginRequest(site, { usernameOrEmail: 'steve', password: 'secret' }, '203.0.113.9')
    )
    const b = await fetch(
      `${site}/login?/login`,
      loginRequest(site, { usernameOrEmail: 'steve', password: 'secret' }, '198.51.100.7')
    )

    expect(a.status).toBe(303)
    const cookieA = a.headers.get('set-cookie') ?? ''
    expect(cookieA).toStartWith('pano_session=tok-203.0.113.9;')
    expect(cookieA).toContain('HttpOnly')
    expect(cookieA).toContain('SameSite=Lax')
    expect(cookieA).toContain('Path=/')
    expect(b.headers.get('set-cookie')).toStartWith('pano_session=tok-198.51.100.7;')

    // The signed-in visitor is greeted by name; the token is not in the page.
    const page = await (await fetch(site, { headers: { cookie: cookieA.split(';')[0] } })).text()
    expect(page).toContain('steve')
    expect(page).not.toContain('tok-203.0.113.9')
  })
})
