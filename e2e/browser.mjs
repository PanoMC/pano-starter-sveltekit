// The visitor's side of the run, in headless Chromium. Started by run.mjs (under the JS-build lock, capped at 4 GB):
//
//   bun e2e/browser.mjs <scenario> <config.json>
//
// Scenarios: `public` (no key: posts and store render, sign-in says what to do), `auth` (register, wrong and right password,
// the HttpOnly cookie), `buy` (cart -> checkout -> fake gateway -> order). The config is the JSON file run.mjs wrote; the result
// of `buy` goes to `config.resultFile`; `foreign` opens a static page that is not Pano and checks its widgets. Exit 0 = every check passed.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from 'playwright'

const [scenario, configFile] = process.argv.slice(2)
if (!scenario || !configFile) {
  console.error('usage: bun e2e/browser.mjs <public|register|login|buy> <config.json>')
  process.exit(2)
}

/** @type {Record<string, any>} */
const config = JSON.parse(readFileSync(configFile, 'utf8'))
const SESSION_COOKIE = 'pano_session'
const KEY_MESSAGE = /Create a front-end key in Panel/

/** @param {unknown} condition @param {string} message */
function check(condition, message) {
  if (!condition) throw new Error(`check failed: ${message}`)
  console.log(`  ok  ${message}`)
}

/** Poll `fn` until it returns a truthy value. @template T @param {() => Promise<T>} fn @param {string} what @param {number} [ms] */
async function until(fn, what, ms = 20000) {
  const end = Date.now() + ms
  let last

  while (Date.now() < end) {
    last = await fn().catch(() => undefined)
    if (last) return last
    await new Promise((resolve) => setTimeout(resolve, 150))
  }

  throw new Error(`timed out after ${ms} ms: ${what}`)
}

// The foreign-page scenarios map their made-up host names to 127.0.0.1 (no DNS) and accept the front's self-signed certificate.
const browser = await chromium.launch({
  headless: true,
  args: config.hostRules ? [`--host-resolver-rules=${config.hostRules}`] : []
})
const context = await browser.newContext({
  viewport: { width: 1280, height: 800 },
  locale: 'en-US',
  ignoreHTTPSErrors: Boolean(config.hostRules)
})
/** @type {string[]} */
const problems = []

const siteOrigin = new URL(config.site).origin

/** Only pages of the site under test count: the fake gateway's page and Pano's own pages are not the starter's. @param {import('playwright').Page} page */
const ours = (page) => {
  try {
    return new URL(page.url()).origin === siteOrigin
  } catch {
    return false
  }
}

/** Responses of the site's /pano proxy that were not 2xx, and failed requests: shown when a scenario fails. */
const trace = []
context.on('page', (page) => {
  page.on('response', (response) => {
    if (response.status() >= 400 && ours(page)) trace.push(`${response.status()} ${response.url()}`)
  })
  page.on('requestfailed', (request) => {
    if (ours(page)) trace.push(`failed ${request.url()} ${request.failure()?.errorText ?? ''}`)
  })
  page.on('pageerror', (error) => {
    if (ours(page)) problems.push(`pageerror on ${page.url()}: ${error.message}`)
  })
  page.on('console', (message) => {
    if (message.type() !== 'error' || !ours(page)) return
    // A missing favicon is the browser asking, not the site failing.
    if (/\/favicon\.ico$/.test(message.location().url)) return
    problems.push(`console.error on ${page.url()}: ${message.text()}`.slice(0, 400))
  })
})

const page = await context.newPage()
page.setDefaultTimeout(20000)

/** The session cookie as the browser stores it. */
const sessionCookie = async () => (await context.cookies()).find((cookie) => cookie.name === SESSION_COOKIE)

/** @param {string} name */
const field = (name) => page.locator(`input[name="${name}"]`)

async function signedInAs(/** @type {string} */ username) {
  await page.locator('.who', { hasText: username }).waitFor()
}

/**
 * The store sidebar holds <pano-market-goal> and <pano-market-recent-buyers>; the loader came through this site's /pano proxy, so
 * each has an open shadow root with content once the widget has mounted.
 */
async function storeSidebarWidgets() {
  if (config.widgets === false) return

  for (const tag of ['pano-market-goal', 'pano-market-recent-buyers']) {
    const rendered = await until(
      () =>
        page.evaluate(
          (name) => !!document.querySelector(name)?.shadowRoot?.querySelector('.pano-fb')?.children.length,
          tag
        ),
      `<${tag}> renders in the store sidebar`
    )
    check(rendered, `the store sidebar shows <${tag}>`)
  }
}

async function publicPages() {
  const { site, postTitle, productName, expectKey } = config

  await page.goto(`${site}/`)
  await page.getByRole('link', { name: postTitle }).first().waitFor()
  check(true, `the home page lists the post "${postTitle}"`)

  await page.goto(`${site}/store`)
  await page.getByText(productName).first().waitFor()
  check(true, `the store lists "${productName}" without a key`)

  await storeSidebarWidgets()

  await page.goto(`${site}/login`)
  await page.getByRole('heading', { name: 'Log in' }).waitFor()
  if (expectKey === false) {
    check(
      (await page.getByText(KEY_MESSAGE).count()) === 0,
      'login does not show the key message when a key is set'
    )
    return
  }
  await page.getByText(KEY_MESSAGE).first().waitFor()
  check(true, 'login shows the front-end key message')

  await field('usernameOrEmail').fill('nobody')
  await field('password').fill('Whatever-1234')
  await page.getByRole('button', { name: 'Log in' }).click()
  await page.getByText(KEY_MESSAGE).first().waitFor()
  check(!(await sessionCookie()), 'submitting login without a key sets no session cookie')

  await page.goto(`${site}/register`)
  await page.getByText(KEY_MESSAGE).first().waitFor()
  check(true, 'register shows the front-end key message')
}

async function register() {
  const { site, user } = config

  await page.goto(`${site}/register`)
  await page.getByRole('heading', { name: 'Register' }).waitFor()
  check(
    (await page.getByText(KEY_MESSAGE).count()) === 0,
    'register does not show the key message when a key is set'
  )

  await field('username').fill(user.username)
  await field('email').fill(user.email)
  await field('password').fill(user.password)
  await field('passwordRepeat').fill(user.password)
  await page.locator('input[name="agreement"]').check()
  await page.getByRole('button', { name: 'Register' }).click()
  await signedInAs(user.username)
  check(true, `registering signs ${user.username} in`)

  const cookie = await until(sessionCookie, 'the session cookie')
  check(cookie.httpOnly === true, 'the session cookie is HttpOnly')
  check(cookie.sameSite === 'Lax', 'the session cookie is SameSite=Lax')
  check(cookie.path === '/', 'the session cookie covers the whole site')
  check(
    !(await page.evaluate(() => document.cookie)).includes(SESSION_COOKIE),
    'document.cookie does not show it'
  )
  check(!(await page.content()).includes(cookie.value), 'the page source does not contain the session token')
  const stored = await page.evaluate(() => JSON.stringify([{ ...localStorage }, { ...sessionStorage }]))
  check(!stored.includes(cookie.value), 'local and session storage do not hold the session token')

  await page.getByRole('button', { name: 'Log out' }).click()
  await page.getByRole('link', { name: 'Log in' }).first().waitFor()
  check(!(await sessionCookie()), 'logging out removes the cookie')
}

async function signIn() {
  const { site, user } = config

  await page.goto(`${site}/login`)
  await field('usernameOrEmail').fill(user.username)
  await field('password').fill(`${user.password}-wrong`)
  await page.getByRole('button', { name: 'Log in' }).click()
  await page.getByText('Wrong username or password.').waitFor()
  check(!(await sessionCookie()), 'a wrong password sets no cookie and says so')

  await field('usernameOrEmail').fill(user.username)
  await field('password').fill(user.password)
  await page.getByRole('button', { name: 'Log in' }).click()
  await signedInAs(user.username)
  const again = await until(sessionCookie, 'the session cookie after login')
  check(again.httpOnly === true, 'the right password signs in with an HttpOnly cookie')
}

async function buy() {
  const { site, panoOrigin, productName, login, label, orderOnSite, resultFile } = config

  // The fake gateway is a test-mode payment method: market offers it only to a signed-in buyer who holds the payments node.
  await page.goto(`${site}/login`)
  await field('usernameOrEmail').fill(login.usernameOrEmail)
  await field('password').fill(login.password)
  await page.getByRole('button', { name: 'Log in' }).click()
  await signedInAs(login.username)
  check(true, `signed in as ${login.username} (${label})`)

  await page.goto(`${site}/store`)
  await page
    .getByRole('link', { name: new RegExp(productName) })
    .first()
    .click()
  await page.getByRole('button', { name: 'Add to cart' }).click()
  await page.getByText('Added.').waitFor()
  check(true, `${productName} is in the cart (${label})`)

  await page.getByRole('link', { name: 'Go to checkout' }).click()
  await page.getByRole('heading', { name: 'Checkout' }).waitFor()

  const pay = page.getByRole('button', { name: /^Pay / })
  await until(() => pay.isEnabled(), 'the Pay button to be enabled (quote and payment method)')
  check(true, `checkout quoted: "${(await pay.textContent())?.trim()}" (${label})`)

  // The checkout answers with the order and where to pay; its public id is how the run finds the order afterwards. The answer
  // is read in a route handler because the page leaves for the gateway as soon as it has it.
  /** @type {any} */
  let created = null
  await page.route(
    (url) => url.pathname.endsWith('/checkout'),
    async (route) => {
      if (route.request().method() !== 'POST') return route.continue()

      const response = await route.fetch()
      created = await response.json().catch(() => null)
      await route.fulfill({ response })
    }
  )
  await pay.click()
  await until(async () => created, 'the checkout answer')
  const orderId = created?.order?.publicId
  check(typeof orderId === 'string' && orderId.length > 0, `the checkout created order ${orderId} (${label})`)
  if (resultFile) writeFileSync(resultFile, JSON.stringify({ orderId }))

  // Then the buyer is at the fake gateway, which pays and sends them back. The page URL is polled, not awaited as a navigation:
  // when the buyer comes back to a page of Pano's own theme (own-origin mode) that page may take long to answer.
  if (!orderOnSite) {
    await until(
      async () => /\/pay\/|\/store\/order\//.test(page.url()),
      'the buyer to reach the fake gateway or come back from it',
      30000
    )
    check(true, `the buyer was sent to the fake gateway and on (${label})`)
    // The order page the buyer returns to is Pano's own; give the gateway time to finish and leave it to the run to check the order.
    await until(async () => !/\/pay\//.test(page.url()), 'the buyer to leave the gateway', 15000).catch(
      () => {}
    )
    return
  }

  await until(
    async () => new RegExp(`/store/order/${orderId}`).test(page.url()),
    'the buyer to return to the order page',
    60000
  )
  const landed = new URL(page.url())
  check(
    landed.origin === panoOrigin,
    `the gateway sent the buyer back to ${landed.origin}${landed.pathname} (${label})`
  )

  // The order page is the starter's own (Pano proxies it or runs it): it must show the paid state.
  await page.locator('[data-status="COMPLETED"]').waitFor({ timeout: 40000 })
  check(
    (await page.locator('.status').textContent())?.trim() === 'Paid',
    `the starter's order page says Paid (${label})`
  )
  check((await page.title()).startsWith('Order'), "it is the starter's order page")
}

/**
 * A static page that is not Pano, with four widgets: the goal widget renders, an icon glyph has width, and the four widgets made
 * one request for their data. `config.pageUrl`, `config.expectOrigin` (where the data request must go).
 */
async function foreignPage() {
  /** @type {string[]} */
  const dataRequests = []
  page.on('request', (request) => {
    const url = new URL(request.url())
    if (url.pathname.endsWith('/plugins/pano-plugin-market/widgets')) dataRequests.push(request.url())
  })

  await page.goto(config.pageUrl)

  const tags = [
    'pano-market-goal',
    'pano-market-recent-buyers',
    'pano-market-top-supporters',
    'pano-market-stats'
  ]
  for (const tag of tags) {
    await until(
      () =>
        page.evaluate(
          (name) => !!document.querySelector(name)?.shadowRoot?.querySelector('.pano-fb')?.children.length,
          tag
        ),
      `<${tag}> mounted`
    )
  }
  check(true, `all four widgets mounted on ${config.label}`)

  // The widget shows a loading state first; its data comes with the one /widgets request.
  const goal = await until(
    () =>
      page.evaluate(() => {
        const root = document.querySelector('pano-market-goal')?.shadowRoot
        const body = root?.querySelector('.pano-fb')
        const text = body?.textContent?.trim() ?? ''
        return text && !body?.querySelector('[class*="loading"], [class*="spinner"]')
          ? { text, html: body?.innerHTML.length ?? 0 }
          : null
      }),
    'the goal widget to show its content',
    20000
  )
  check(goal.html > 0 && goal.text.length > 0, `the goal widget has content on ${config.label}`)

  // An icon glyph is drawn from the icon font. The sheet's @font-face is declared on the page, not inside the shadow root;
  // a glyph that did not load has zero width.
  const glyph = await until(
    () =>
      page.evaluate(async () => {
        await document.fonts.ready
        for (const element of document.querySelectorAll(
          'pano-market-goal, pano-market-recent-buyers, pano-market-top-supporters, pano-market-stats'
        )) {
          const icons =
            element.shadowRoot?.querySelectorAll(
              'i[class*="fa-"], .fa-solid, .fa-regular, .fas, .far, [class*="icon"]'
            ) ?? []
          for (const icon of icons) {
            const width = icon.getBoundingClientRect().width
            const content = getComputedStyle(icon, '::before').content
            if (width > 0 && content && content !== 'none' && content !== 'normal') return { width, content }
          }
        }
        return null
      }),
    'an icon glyph with a width',
    15000
  )
  check(glyph.width > 0, `an icon glyph has width ${glyph.width}px on ${config.label}`)

  // Give a second request time to show up before counting.
  await new Promise((resolve) => setTimeout(resolve, 1500))
  check(
    dataRequests.length === 1,
    `four widgets made ${dataRequests.length} data request(s) on ${config.label} (expected 1)`
  )
  check(dataRequests[0].startsWith(config.expectOrigin), `the data request went to ${config.expectOrigin}`)
}

let failed = null

try {
  console.log(`browser scenario "${scenario}"`)
  if (scenario === 'public') await publicPages()
  else if (scenario === 'register') await register()
  else if (scenario === 'login') await signIn()
  else if (scenario === 'buy') await buy()
  else if (scenario === 'foreign') await foreignPage()
  else throw new Error(`unknown scenario ${scenario}`)

  // Nothing on any page may have thrown or logged an error on the way.
  if (problems.length)
    throw new Error(`the browser reported ${problems.length} problem(s):\n  ${problems.join('\n  ')}`)
} catch (error) {
  failed = error
  const dir = join(config.workDir ?? '.', 'shots')
  mkdirSync(dir, { recursive: true })
  const shot = join(dir, `${config.label ?? scenario}-${scenario}.png`.replace(/[^A-Za-z0-9_.-]+/g, '_'))
  await page.screenshot({ path: shot }).catch(() => {})
  console.error(`FAILED at ${page.url()}\n${/** @type {Error} */ (error).message}\nscreenshot: ${shot}`)
  const sidebar = await page
    .evaluate(() => {
      const goal = document.querySelector('pano-market-goal')
      return `aside=${!!document.querySelector('aside.sidebar')} goal=${!!goal} shadow=${!!goal?.shadowRoot} html=${goal?.shadowRoot?.innerHTML.slice(0, 300) ?? ''} PanoWidgets=${typeof globalThis.PanoWidgets}`
    })
    .catch(() => '')
  if (sidebar) console.error(sidebar)
  if (trace.length) console.error(`requests that failed:\n  ${trace.slice(0, 12).join('\n  ')}`)
  if (problems.length) console.error(`browser problems:\n  ${problems.slice(0, 8).join('\n  ')}`)
} finally {
  await browser.close()
}

process.exit(failed ? 1 : 0)
