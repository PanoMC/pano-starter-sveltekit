// End-to-end run of the starter against a real Pano, in the three ways a site can run it:
//
//   bun run package && bun e2e/run.mjs
//
// Inside a test-instance slot (`pano-open-frontend-spec/tools/of-slot.sh bun e2e/run.mjs`; it refuses to run without one, exit 2)
// it starts an isolated instance from the current build (`pano-web-platform/build/libs` and `build/plugins`; STARTER_E2E_JARS=bundle takes
// the frozen bundle, which has no widgets and no OpenAPI) with market's e2e-instance.sh, then
//   1. with no front-end key: posts and the store render, login and register say how to get a key;
//   2. with a key: register, wrong and right password, an HttpOnly session cookie;
//   3. the store sidebar shows the market widgets through the /pano proxy;
//   4. the buy scenario (sign in, cart -> checkout -> market's fake gateway -> a paid order) in
//        (c) the starter on its own origin,
//        (b) the starter as an external upstream behind Pano, ORIGIN set to Pano's address,
//        (a) the zip uploaded and selected as a custom app, run by Pano itself.
// At the end two static pages that are not Pano embed four widgets (a throwaway HTTPS front, host names mapped in Chromium):
// one on an allow-listed sibling origin of Pano's domain, one on another domain behind a reverse-proxy path.
// Every process it starts is stopped by its PID. Exit 0 = everything passed. Logs and screenshots: .open-frontend-run/starter-e2e/.
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { readZip } from '../scripts/zip.mjs'
import { markEmailVerified } from './lib/db.mjs'
import { startGateway } from './lib/gateway.mjs'
import {
  adminLogin,
  bundleJars,
  installWidgetRuntime,
  prepareRunJar,
  restartInstance,
  startInstance,
  stopInstance
} from './lib/instance.mjs'
import { hostRules, startFront } from './lib/front.mjs'
import { buildEntry, instanceDir, ports, repo, requireSlot, workDir, zipFile } from './lib/paths.mjs'
import { sleep, startStarter, waitForFreePort, waitForHttp } from './lib/procs.mjs'
import {
  adminSession,
  createFrontendKey,
  createPost,
  findOrder,
  grantUserNode,
  PAYMENTS_NODE,
  openRegistration,
  prepareStore,
  refreshDescriptor,
  setAllowedOrigins,
  setFrontend,
  uploadCustomApp,
  useAddressAsSite,
  userIdOf
} from './lib/setup.mjs'

// ---------------------------------------------------------------------------------------------- the slot

// of-slot.sh holds the slot's lock around this whole run and stops the instance when it ends.
requireSlot()

// ---------------------------------------------------------------------------------------------- helpers

/** STARTER_E2E_REUSE=1: use an instance that is already running on the run's ports (and leave it running). */
const reuse = process.env.STARTER_E2E_REUSE === '1'
const tag = Date.now().toString(36).slice(-6)
/**
 * Pano's address for the starter's server (the API), and Pano's public address (where visitors are, `website-url`). They are
 * different on purpose: SvelteKit's `event.fetch` answers a request to the page's own origin itself, so a starter whose public
 * origin equals its API address would call itself (see the note in the report of unit ST-03).
 */
const panoInternal = `http://127.0.0.1:${ports.pano}`
const panoOrigin = `http://localhost:${ports.pano}`
const ownOrigin = `http://127.0.0.1:${ports.own}`
const upstreamOrigin = `http://127.0.0.1:${ports.upstream}`
const apiUrl = `${panoInternal}/api`
const user = {
  username: `st${tag}`,
  email: `st${tag}@example.com`,
  password: 'Starter-E2e-Passw0rd!'
}
const postTitle = `Hello from the starter ${tag}`

/** @type {{ name: string, ok: boolean, ms: number, note?: string }[]} */
const report = []

/** Run one named step; its failure stops the run (the steps depend on each other). @template T @param {string} name @param {() => Promise<T>|T} fn */
async function step(name, fn) {
  const started = Date.now()
  console.log(`\n== ${name}`)

  try {
    const value = await fn()
    report.push({ name, ok: true, ms: Date.now() - started })
    return value
  } catch (error) {
    report.push({
      name,
      ok: false,
      ms: Date.now() - started,
      note: String(/** @type {any} */ (error)?.message ?? error)
    })
    throw error
  }
}

/**
 * One browser scenario in its own process, under a 4 GB cap (no JS-build lock: the slot bounds Playwright runs to two). Asynchronous on purpose: the fake gateway
 * runs in this process and must keep answering while the browser pays.
 * @param {string} scenario @param {Record<string, unknown>} config
 */
async function browser(scenario, config) {
  const label = String(config.label ?? scenario)
  const file = join(workDir, `browser-${label.replace(/[^A-Za-z0-9_.-]+/g, '_')}-${scenario}.json`)
  writeFileSync(file, JSON.stringify({ ...config, workDir }))

  const child = spawn(
    'systemd-run',
    [
      '--user',
      '--scope',
      '-q',
      '-p',
      'MemoryMax=4G',
      process.execPath,
      join(repo, 'e2e', 'browser.mjs'),
      scenario,
      file
    ],
    { cwd: repo, stdio: 'inherit' }
  )
  const code = await new Promise((resolve) => child.on('exit', (status) => resolve(status)))

  if (code !== 0) throw new Error(`browser scenario "${scenario}" (${label}) failed with exit ${code}`)
}

/** The buy scenario in one mode, then the panel's view of the order. */
async function buyScenario(
  /** @type {import('./lib/api.mjs').Api} */ admin,
  /** @type {Record<string, any>} */ options
) {
  const resultFile = join(workDir, `buy-${options.label.replace(/[^A-Za-z0-9_.-]+/g, '_')}.json`)
  rmSync(resultFile, { force: true })
  const paymentsBefore = /** @type {NonNullable<typeof gateway>} */ (gateway).payments.size

  await browser('buy', {
    ...options,
    panoOrigin,
    resultFile,
    productName: store.name
  })

  const { orderId } = JSON.parse(readFileSync(resultFile, 'utf8'))
  let order = null

  for (let i = 0; i < 120 && order?.status !== 'COMPLETED'; i++) {
    order = await findOrder(admin, orderId)
    if (order?.status !== 'COMPLETED') await sleep(500)
  }

  if (order?.status !== 'COMPLETED')
    throw new Error(`the panel does not see order ${orderId} as COMPLETED (${order?.status ?? 'not found'})`)
  console.log(`  ok  the panel sees order ${orderId} as COMPLETED (${options.label})`)

  // Wherever the buyer was, market told the gateway to send them back to Pano's return route, which sends them to the order
  // page of the site address. (The run follows it by hand: in own-origin mode that page is Pano's own theme, not the starter.)
  const payment = [.../** @type {NonNullable<typeof gateway>} */ (gateway).payments.values()][paymentsBefore]
  if (!payment?.returnSuccess)
    throw new Error(`the gateway got no payment with a return address for ${orderId}`)

  const back = await fetch(payment.returnSuccess, { redirect: 'manual', signal: AbortSignal.timeout(30000) })
  const location = back.headers.get('location') ?? ''
  if (!location.startsWith(`${panoOrigin}/store/order/${orderId}`)) {
    throw new Error(
      `the return route answered ${back.status} ${location || '(no location)'}, not the order page under ${panoOrigin}`
    )
  }
  console.log(`  ok  market sends the buyer back to ${location.split('?')[0]} (${options.label})`)
}

/** The start of Pano's answer at `/`, to know who serves the site. @param {string} url */
async function pageText(url) {
  return (await fetch(url, { signal: AbortSignal.timeout(10000), redirect: 'manual' })).text()
}

/** Wait until `url` is served by the starter (its header brand). @param {string} url */
async function waitForStarter(url) {
  for (let i = 0; i < 60; i++) {
    try {
      if ((await pageText(url)).includes('Pano site')) return
    } catch {
      // not yet
    }
    await sleep(500)
  }

  throw new Error(`${url} is not served by the starter`)
}

// ---------------------------------------------------------------------------------------------- the run

/** @type {{ stop: () => Promise<void> }[]} */
const starters = []
/** @type {Awaited<ReturnType<typeof startGateway>> | null} */
let gateway = null
/** @type {import('./lib/api.mjs').Api | null} */
let admin = null
let instanceStarted = false
/** @type {Awaited<ReturnType<typeof startFront>> | null} */
let front = null
/** @type {{ name: string, slug: string }} */
let store = { name: '', slug: '' }
let failure = null

mkdirSync(workDir, { recursive: true })
for (const stale of ['report.json']) rmSync(join(workDir, stale), { force: true })

async function cleanup() {
  // The front-end goes back to the theme first, so Pano is not left holding a custom app or an upstream.
  if (admin) await setFrontend(admin, { mode: 'THEME' }).catch(() => {})

  for (const starter of starters.splice(0))
    await starter.stop().catch((error) => console.error(`stop: ${error.message}`))
  if (gateway) await gateway.close().catch(() => {})
  gateway = null
  front?.stop()
  front = null

  if (instanceStarted) {
    const code = stopInstance()
    if (code !== 0) console.error(`starter e2e: e2e-instance.sh stop exited ${code}`)
    instanceStarted = false
  }

  for (const port of [...(reuse ? [] : [ports.pano]), ports.gateway, ports.own, ports.upstream]) {
    await waitForFreePort(port, 30).catch((error) => console.error(`starter e2e: ${error.message}`))
  }
}

for (const signal of /** @type {const} */ (['SIGINT', 'SIGTERM'])) {
  process.on(signal, () => {
    cleanup().finally(() => process.exit(130))
  })
}

try {
  await step('preflight', async () => {
    if (!existsSync(zipFile)) throw new Error(`${zipFile} is missing: run \`bun run package\` first`)
    const files = readZip(readFileSync(zipFile))
    for (const name of ['manifest.json', 'index.js', 'build/index.js']) {
      if (!files.has(name)) throw new Error(`${zipFile} holds no ${name}`)
    }
    if (!existsSync(buildEntry)) throw new Error(`${buildEntry} is missing: run \`bun run build\` first`)
    await prepareRunJar()
    bundleJars()
    console.log(`  zip ${files.size} files; frozen bundle found; build found`)
  })

  await step('start the instance from the frozen bundle', async () => {
    if (reuse) {
      // Development loop: the instance is already up (started by hand inside the same slot, PANO_OF_SLOT set); it is left running.
      await waitForHttp(`${panoInternal}/api/v1/health`, 10)
    } else {
      instanceStarted = true
      startInstance()
    }
    const runtime = installWidgetRuntime()
    console.log(`  widget runtime from the ${runtime}`)
    gateway = await startGateway(ports.gateway)
    console.log(`  Pano at ${panoInternal} (public ${panoOrigin}), fake gateway at ${gateway.baseUrl}`)
  })

  await step('set up the instance (registration, a post, the store, fake payment methods)', async () => {
    admin = await adminSession(panoInternal)
    await useAddressAsSite(admin, panoOrigin)
    await openRegistration(admin)
    await createPost(admin, postTitle)
    store = await prepareStore(admin, /** @type {NonNullable<typeof gateway>} */ (gateway), tag)
    console.log(`  product "${store.name}"`)
  })

  const adminApi = /** @type {import('./lib/api.mjs').Api} */ (/** @type {unknown} */ (admin))
  const baseEnv = { API_URL: apiUrl, PANO_SITE_URL: ownOrigin, ORIGIN: ownOrigin }

  // ---- no key
  await step('no key: posts and store render, login and register show the key message', async () => {
    const starter = await startStarter({ name: 'nokey', port: ports.own, env: baseEnv })
    try {
      await browser('public', {
        label: 'no key',
        site: ownOrigin,
        postTitle,
        productName: store.name,
        expectKey: true
      })
    } finally {
      await starter.stop()
    }
  })

  // ---- with a key
  const key = await step('create a front-end key', async () => {
    const created = await createFrontendKey(adminApi, `starter e2e ${tag}`)
    console.log('  key created (not printed)')
    return created
  })

  const own = await step('start the starter on its own origin with the key', async () => {
    const starter = await startStarter({
      name: 'own',
      port: ports.own,
      env: { ...baseEnv, PANO_FRONTEND_KEY: key }
    })
    starters.push(starter)
    return starter
  })

  await step('with the key: public pages, register, wrong and right password, HttpOnly cookie', async () => {
    await browser('public', {
      label: 'with key',
      site: ownOrigin,
      postTitle,
      productName: store.name,
      expectKey: false
    })
    await browser('register', { label: 'with key', site: ownOrigin, user })
    // Registering with email verification off leaves the address unverified, and login refuses that; see lib/db.mjs.
    markEmailVerified(user.username)
    // The fake gateway is a test-mode method: only a signed-in buyer who holds the payments node is offered it.
    await grantUserNode(adminApi, await userIdOf(adminApi, user.username), PAYMENTS_NODE)
    await browser('login', { label: 'with key', site: ownOrigin, user })
  })

  const login = { usernameOrEmail: user.username, username: user.username, password: user.password }

  await step('(c) own origin: buy', async () => {
    await buyScenario(adminApi, { label: 'own origin', site: ownOrigin, orderOnSite: false, login })
  })

  await step('(b) external upstream: Pano proxies to the starter, ORIGIN set', async () => {
    await own.stop()
    starters.splice(starters.indexOf(own), 1)

    const upstream = await startStarter({
      name: 'upstream',
      port: ports.upstream,
      env: { API_URL: apiUrl, PANO_SITE_URL: panoOrigin, ORIGIN: panoOrigin, PANO_FRONTEND_KEY: key }
    })
    starters.push(upstream)

    await setFrontend(adminApi, { mode: 'EXTERNAL', upstreamUrl: upstreamOrigin, siteUrl: panoOrigin })
    await waitForStarter(`${panoOrigin}/`)
    console.log('  Pano serves the starter at /')
    const descriptor = await refreshDescriptor(adminApi)
    console.log(`  Pano read the front-end descriptor: ${JSON.stringify(descriptor)}`)
    // The URL map takes the descriptor's addresses (market.order ...) at boot only: restart once so /_pano/market.order lands on the site.
    if (!reuse) {
      restartInstance()
      await waitForHttp(`${panoInternal}/api/v1/health`, 120)
      await waitForStarter(`${panoOrigin}/`)
      const panelLogin = adminLogin()
      await adminApi.loginPanel(panelLogin.user, panelLogin.password)
    }

    await buyScenario(adminApi, { label: 'external upstream', site: panoOrigin, orderOnSite: true, login })

    await setFrontend(adminApi, { mode: 'THEME' })
    await upstream.stop()
    starters.splice(starters.indexOf(upstream), 1)
  })

  await step('(a) custom app: upload the zip, select it, Pano runs it', async () => {
    const uploaded = await uploadCustomApp(adminApi, zipFile)
    console.log(`  uploaded ${uploaded.json?.id ?? uploaded.json?.data?.id}`)

    await setFrontend(adminApi, { mode: 'CUSTOM_APP', customAppId: 'pano-starter' })
    await waitForStarter(`${panoOrigin}/`)
    const state = (await adminApi.get('/api/v1/panel/frontend')).json
    console.log(
      `  Pano serves the custom app at / (running: ${JSON.stringify(state?.running ?? state?.data?.running)})`
    )

    // Pano hands the app its internal key: public pages and the store work.
    await browser('public', {
      label: 'custom app',
      site: panoOrigin,
      postTitle,
      productName: store.name,
      expectKey: false
    })

    // That key gives cookie sessions, not the session token the starter keeps, so a visitor can only sign in once a stored key
    // is in `.env` next to index.js (the app is started again to read it).
    await setFrontend(adminApi, { mode: 'THEME' })
    writeFileSync(join(instanceDir, 'custom-apps', 'pano-starter', '.env'), `PANO_FRONTEND_KEY=${key}\n`)
    await setFrontend(adminApi, { mode: 'CUSTOM_APP', customAppId: 'pano-starter' })
    await waitForStarter(`${panoOrigin}/`)

    await buyScenario(adminApi, { label: 'custom app', site: panoOrigin, orderOnSite: true, login })
  })

  // ---- widgets on pages that are not Pano (design 06 section 8, W5). Last, because it moves Pano's website address.
  await step(
    'widgets on a static page of a sibling origin and on another domain behind a proxy path',
    async () => {
      front = await startFront({ port: ports.static, panoPort: ports.pano, workDir })
      console.log(
        `  TLS front on ${front.panoOrigin}, sibling ${front.siblingOrigin}, other domain ${front.otherOrigin}`
      )

      try {
        await useAddressAsSite(adminApi, front.panoOrigin)
        await setAllowedOrigins(adminApi, [front.siblingOrigin])

        await browser('foreign', {
          label: 'sibling origin',
          site: front.siblingOrigin,
          pageUrl: front.siblingPage,
          expectOrigin: front.panoOrigin,
          hostRules
        })
        await browser('foreign', {
          label: 'another domain behind /pano',
          site: front.otherOrigin,
          pageUrl: front.otherPage,
          expectOrigin: `${front.otherOrigin}/pano/`,
          hostRules
        })
      } finally {
        await setAllowedOrigins(adminApi, []).catch(() => {})
        await useAddressAsSite(adminApi, panoOrigin).catch(() => {})
      }
    }
  )
} catch (error) {
  failure = error
  console.error(`\nstarter e2e: FAILED: ${/** @type {Error} */ (error).message}`)
} finally {
  await cleanup().catch((error) => console.error(`starter e2e: cleanup: ${error.message}`))
}

writeFileSync(
  join(workDir, 'report.json'),
  JSON.stringify({ at: new Date().toISOString(), ok: !failure, steps: report }, null, 2)
)
console.log('\nstarter e2e summary')
for (const row of report)
  console.log(
    `  ${row.ok ? 'PASS' : 'FAIL'}  ${row.name} (${(row.ms / 1000).toFixed(1)} s)${row.note ? `\n        ${row.note.split('\n')[0]}` : ''}`
  )
console.log(failure ? 'starter e2e: FAILED' : 'starter e2e: OK')

process.exit(failure ? 1 : 0)
