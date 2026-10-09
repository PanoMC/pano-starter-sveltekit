// The packaged zip, unpacked and started the way Pano starts a custom app: `bun --smol run index.js` with PORT and HOST.
// Skipped until `bun run package` has written the zip. `bun test scripts`
import { afterAll, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { startPanoStub } from '../tests/helpers.js'
import { readZip } from './zip.mjs'

const zipFile = resolve(import.meta.dir, '..', '..', '.open-frontend-run', 'artifacts', 'pano-starter.zip')

describe.skipIf(!existsSync(zipFile))('the packaged custom app', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pano-starter-zip-'))
  const stub = startPanoStub()
  /** @type {import('bun').Subprocess[]} */
  const children = []

  afterAll(() => {
    for (const child of children) child.kill()
    stub.stop()
    rmSync(dir, { recursive: true, force: true })
  })

  const files = readZip(readFileSync(zipFile))

  /** Start `index.js` from the unpacked zip; returns the origin once it answers. @param {Record<string, string>} [env] */
  async function start(env = {}) {
    const probe = Bun.serve({ port: 0, fetch: () => new Response('') })
    const port = probe.port
    probe.stop(true)

    const child = Bun.spawn([process.execPath, '--smol', 'run', join(dir, 'index.js')], {
      // What Pano gives a custom app (doc 05 section 3.1), and nothing else; cwd is not the app folder, as under Pano.
      // (The stub accepts the key pfk_test and answers 401 to any other.)
      cwd: tmpdir(),
      env: {
        PATH: process.env.PATH ?? '',
        NODE_ENV: 'production',
        PORT: String(port),
        HOST: '127.0.0.1',
        API_URL: `${stub.url}/api`,
        PANO_API_URL: `${stub.url}/api`,
        PANO_FRONTEND_KEY: 'pfk_test',
        PANO_SITE_URL: `http://127.0.0.1:${port}`,
        PROTOCOL_HEADER: 'x-forwarded-proto',
        HOST_HEADER: 'x-forwarded-host',
        ...env
      },
      stdout: 'ignore',
      stderr: 'ignore'
    })
    children.push(child)

    for (let i = 0; i < 100; i++) {
      try {
        await fetch(`http://127.0.0.1:${port}/_app/version.json`)
        return `http://127.0.0.1:${port}`
      } catch {
        await Bun.sleep(100)
      }
    }
    throw new Error('the unpacked app did not start')
  }

  test('holds manifest.json and index.js at its root, and the build', () => {
    expect(files.has('manifest.json')).toBe(true)
    expect(files.has('index.js')).toBe(true)
    expect(files.has('build/index.js')).toBe(true)
    expect([...files.keys()].some((name) => name.startsWith('build/client/_app/'))).toBe(true)
    expect([...files.keys()].some((name) => name.endsWith('.map'))).toBe(false)
  })

  test('its manifest is the repository one', () => {
    expect(files.get('manifest.json')?.toString()).toBe(
      readFileSync(resolve(import.meta.dir, '..', 'manifest.json'), 'utf8')
    )
  })

  test('runs under `bun index.js` and serves pages from Pano', async () => {
    for (const [name, data] of files) {
      const target = join(dir, name)
      mkdirSync(dirname(target), { recursive: true })
      writeFileSync(target, data)
    }

    const origin = await start()
    const home = await fetch(`${origin}/`)

    expect(home.status).toBe(200)
    expect(await home.text()).toContain('Hello world')
  })

  test('takes the origin of form posts from PANO_SITE_URL, as Pano gives no X-Forwarded-Host', async () => {
    const site = 'http://pano.test:8088'
    const origin = await start({ PANO_SITE_URL: site })
    const post = (/** @type {string} */ from) =>
      fetch(`${origin}/login?/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded', origin: from },
        body: 'usernameOrEmail=a&password=b&next=/'
      })

    // SvelteKit refuses a form post whose Origin is not the site's with 403 before any action runs.
    expect((await post('http://evil.test')).status).toBe(403)
    expect((await post(site)).status).not.toBe(403)
  })

  test('a .env beside index.js replaces the internal key and nothing else', async () => {
    writeFileSync(join(dir, '.env'), 'PANO_FRONTEND_KEY="pfk_stored"\nAPI_URL=http://127.0.0.1:1/api\n')
    stub.requests.length = 0

    const origin = await start()
    await fetch(`${origin}/`)

    const toPano = stub.requests.filter((request) => request.path.startsWith('/api/v1/posts'))
    expect(toPano.length).toBeGreaterThan(0)
    expect(toPano[0].headers['x-pano-frontend-key']).toBe('pfk_stored')
    rmSync(join(dir, '.env'))
  })
})
