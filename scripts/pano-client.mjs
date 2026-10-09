// `bun run pano:pull` and `bun run check` (the pano-client part): the generated client in src/lib/pano against a running Pano.
//
//   bun scripts/pano-client.mjs pull [--url <pano>] [--plugin <id>]...
//   bun scripts/pano-client.mjs check [--url <pano>]
//
// Where Pano is: --url, else PANO_URL, else the origin of API_URL (process env, then .env; a trailing /api or /api/v1 is
// dropped), else http://localhost:8088. `check` with no Pano answering prints a note and exits 0, so `bun run check` works on a
// machine with no Pano; PANO_CHECK_STRICT=1 makes that a failure.
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ClientGenError, check, pull } from '@panomc/client-gen'

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** @param {string} name */
function fromDotEnv(name) {
  const file = join(repo, '.env')
  if (!existsSync(file)) return ''
  const match = new RegExp(`^${name}=(.*)$`, 'm').exec(readFileSync(file, 'utf8'))
  return match ? match[1].trim().replace(/^["']|["']$/g, '') : ''
}

/** @param {string} value */
export function originOf(value) {
  return value.replace(/\/+$/, '').replace(/\/api(\/v1)?$/, '')
}

/** @param {string[]} args */
export function panoUrl(args) {
  const flag = args.indexOf('--url')
  if (flag >= 0 && args[flag + 1]) return originOf(args[flag + 1])
  const given =
    process.env.PANO_URL ||
    process.env.PANO_API_URL ||
    process.env.API_URL ||
    fromDotEnv('PANO_API_URL') ||
    fromDotEnv('API_URL')
  return originOf(given || 'http://localhost:8088')
}

/**
 * The controllers a plugin serves are minified build output and import the plugin's own build types; svelte-check would report
 * hundreds of errors in them. Their first line says so. (`check` compares Pano's served bytes with the recorded hash, never this file.)
 */
function markControllersUnchecked() {
  const plugins = join(repo, 'src', 'lib', 'pano', 'plugins')
  if (!existsSync(plugins)) return

  for (const entry of readdirSync(plugins, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue

    for (const name of ['controllers.mjs', 'controllers.types.js']) {
      const file = join(plugins, entry.name, 'controllers', name)
      if (!existsSync(file)) continue
      const text = readFileSync(file, 'utf8')
      if (!text.startsWith('// @ts-nocheck')) {
        writeFileSync(
          file,
          `// @ts-nocheck (copied as the plugin serves it; its imports belong to the plugin's build)\n${text}`
        )
      }
    }
  }
}

/**
 * The generator writes the paths of an OpenAPI document as they stand under `paths`, relative to `servers[0].url` (`/auth/login`),
 * and @panomc/client sends a path as it is (`/api/v1/auth/login`). Put the server prefix in front of every path of every
 * generated `operations.js`; a generator that already does it leaves nothing to change.
 */
function prefixOperationPaths() {
  const root = join(repo, 'src', 'lib', 'pano')
  const folders = [join(root, 'core')]
  const plugins = join(root, 'plugins')
  if (existsSync(plugins)) {
    for (const entry of readdirSync(plugins, { withFileTypes: true }))
      if (entry.isDirectory()) folders.push(join(plugins, entry.name))
  }

  for (const folder of folders) {
    const operations = join(folder, 'operations.js')
    const document = join(folder, 'openapi.json')
    if (!existsSync(operations) || !existsSync(document)) continue

    const prefix = String(JSON.parse(readFileSync(document, 'utf8')).servers?.[0]?.url ?? '').replace(
      /\/+$/,
      ''
    )
    if (!prefix) continue

    const text = readFileSync(operations, 'utf8')
    const next = text.replace(/path: '([^']*)'/g, (all, path) =>
      path.startsWith(`${prefix}/`) ? all : `path: '${prefix}${path}'`
    )
    if (next !== text) writeFileSync(operations, next)
  }
}

const [command, ...rest] = process.argv.slice(2)

if (command !== 'pull' && command !== 'check') {
  console.error('usage: bun scripts/pano-client.mjs pull|check [--url <pano>] [--plugin <pluginId>]...')
  process.exit(2)
}

const url = panoUrl(rest)
/** @type {string[]} */
const plugins = []
for (let i = 0; i < rest.length; i++) if (rest[i] === '--plugin' && rest[i + 1]) plugins.push(rest[++i])

try {
  if (command === 'pull') {
    await pull({ url, out: 'src/lib/pano', plugins, cwd: repo, log: (line) => console.log(line) })
    markControllersUnchecked()
    prefixOperationPaths()
  } else {
    try {
      await fetch(`${url}/api/v1/health`, { signal: AbortSignal.timeout(5000) })
    } catch {
      const note = `pano-client check: Pano did not answer at ${url}; the generated client was not compared (set PANO_URL or run inside a Pano slot)`
      if (process.env.PANO_CHECK_STRICT === '1') throw new ClientGenError(note)
      console.log(note)
      process.exit(0)
    }

    const report = await check({ url, dir: 'src/lib/pano', cwd: repo })
    report.notes.forEach((note) => console.log(note))
    if (!report.ok) {
      report.problems.forEach((problem) => console.error(problem))
      throw new ClientGenError('The generated client is out of date. Run bun run pano:pull.')
    }
    console.log('ok: the generated client matches this Pano')
  }
} catch (error) {
  if (!(error instanceof ClientGenError)) throw error
  console.error(error.message)
  process.exitCode = 1
}
