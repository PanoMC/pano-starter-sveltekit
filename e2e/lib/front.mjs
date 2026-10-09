// The foreign-page fixture of the widget test (design 06 section 8, W5): one throwaway HTTPS front on one port that answers for
// three made-up host names. The browser maps the names to 127.0.0.1 with --host-resolver-rules (no DNS, no /etc/hosts) and accepts
// the self-signed certificate.
//
//   pano.<domain>     Pano itself (a plain reverse proxy to the instance): the Pano origin of the page that embeds a loader
//   shop.<domain>     a static page on a sibling origin of Pano's registrable domain, on the panel's origin allow-list
//   elsewhere-e2e.com a static page on another domain; Pano only reachable through the path /pano on that same origin
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'

export const DOMAIN = 'pano-e2e.com'
export const PANO_HOST = DOMAIN
export const SIBLING_HOST = `shop.${DOMAIN}`
export const OTHER_HOST = 'elsewhere-e2e.com'

/** The four widgets of the page, in the order the page lists them. */
export const WIDGET_TAGS = [
  'pano-market-goal',
  'pano-market-recent-buyers',
  'pano-market-top-supporters',
  'pano-market-stats'
]

/** Chromium's --host-resolver-rules for the three names. */
export const hostRules = [PANO_HOST, SIBLING_HOST, OTHER_HOST]
  .map((host) => `MAP ${host} 127.0.0.1`)
  .join(', ')

/** @param {string} loaderSrc */
function page(loaderSrc) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>A page that is not Pano</title>
    <script type="module" src="${loaderSrc}"></script>
  </head>
  <body>
    <h1>A static page with Pano widgets</h1>
    <section>
${WIDGET_TAGS.map((tag) => `      <${tag}></${tag}>`).join('\n')}
    </section>
  </body>
</html>
`
}

/** Hop-by-hop and framing headers that must not be copied through a proxy. */
const DROP = ['connection', 'keep-alive', 'transfer-encoding', 'content-length', 'content-encoding', 'host']

/**
 * @param {{ port: number, panoPort: number, workDir: string }} options
 * @returns {Promise<{ stop: () => void, panoOrigin: string, siblingPage: string, otherPage: string, siblingOrigin: string, otherOrigin: string }>}
 */
export async function startFront({ port, panoPort, workDir }) {
  mkdirSync(workDir, { recursive: true })
  const cert = join(workDir, 'front-cert.pem')
  const key = join(workDir, 'front-key.pem')
  rmSync(cert, { force: true })
  rmSync(key, { force: true })
  execFileSync(
    'openssl',
    [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-days',
      '1',
      '-subj',
      `/CN=${PANO_HOST}`,
      '-addext',
      `subjectAltName=DNS:${PANO_HOST},DNS:${SIBLING_HOST},DNS:${OTHER_HOST}`,
      '-keyout',
      key,
      '-out',
      cert
    ],
    { stdio: 'ignore' }
  )

  const panoOrigin = `https://${PANO_HOST}:${port}`
  const siblingOrigin = `https://${SIBLING_HOST}:${port}`
  const otherOrigin = `https://${OTHER_HOST}:${port}`
  const upstream = `http://127.0.0.1:${panoPort}`

  /** @param {Request} request @param {string} path the path and query to ask Pano for */
  async function forward(request, path) {
    const headers = new Headers(request.headers)
    for (const name of DROP) headers.delete(name)
    const hasBody = !['GET', 'HEAD'].includes(request.method)
    const answer = await fetch(`${upstream}${path}`, {
      method: request.method,
      headers,
      body: hasBody ? await request.arrayBuffer() : undefined,
      redirect: 'manual'
    })
    const out = new Headers(answer.headers)
    for (const name of DROP) out.delete(name)
    return new Response(answer.body, { status: answer.status, headers: out })
  }

  const server = Bun.serve({
    port,
    hostname: '127.0.0.1',
    tls: { cert: readFileSync(cert, 'utf8'), key: readFileSync(key, 'utf8') },
    async fetch(request) {
      const url = new URL(request.url)
      const host = (request.headers.get('host') ?? url.host).split(':')[0].toLowerCase()
      const html = (/** @type {string} */ body) =>
        new Response(body, { headers: { 'content-type': 'text/html; charset=utf-8' } })

      if (host === PANO_HOST) return forward(request, url.pathname + url.search)

      if (host === SIBLING_HOST) {
        if (url.pathname === '/') return html(page(`${panoOrigin}/api/v1/widgets/loader.js`))
        return new Response('not found', { status: 404 })
      }

      if (host === OTHER_HOST) {
        if (url.pathname === '/') return html(page('/pano/api/v1/widgets/loader.js'))
        if (url.pathname.startsWith('/pano/'))
          return forward(request, url.pathname.slice('/pano'.length) + url.search)
        return new Response('not found', { status: 404 })
      }

      return new Response('unknown host', { status: 421 })
    }
  })

  return {
    stop: () => server.stop(true),
    panoOrigin,
    siblingOrigin,
    otherOrigin,
    siblingPage: `${siblingOrigin}/`,
    otherPage: `${otherOrigin}/`
  }
}
