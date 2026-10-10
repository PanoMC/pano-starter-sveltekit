// `bun run package`: zip the build and the two root files into a Pano custom app.
//
//   bun scripts/package.mjs [--out <file>]
//
// Writes `<umbrella>/.open-frontend-run/artifacts/pano-starter.zip` by default (the folder next to this repo that holds
// local build output), with `manifest.json` and `index.js` at the root and the adapter-node build under `build/`.
// Upload it in Panel -> Appearance -> Themes -> gear button ("Site display settings") -> "My uploaded site" -> "Upload Site (.zip)" and select it.
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createZip, readZip } from './zip.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** Build output nobody needs at run time. */
const SKIP = /\.map$/

/** @param {string} dir @returns {string[]} files below `dir`, sorted, "/"-separated and relative to the repo root */
function walk(dir) {
  /** @type {string[]} */
  const found = []

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) found.push(...walk(path))
    else if (entry.isFile() && !SKIP.test(entry.name)) found.push(relative(root, path).split(sep).join('/'))
  }

  return found.sort()
}

/** @param {string} message */
function fail(message) {
  console.error(`package: ${message}`)
  process.exit(1)
}

const outFlag = process.argv.indexOf('--out')
const out =
  outFlag > 0 && process.argv[outFlag + 1]
    ? resolve(process.argv[outFlag + 1])
    : resolve(root, '..', '.open-frontend-run', 'artifacts', 'pano-starter.zip')

const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'))
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))

if (manifest.type !== 'custom-app') fail('manifest.json must have "type": "custom-app".')
for (const field of ['id', 'title', 'version', 'author']) {
  if (typeof manifest[field] !== 'string' || !manifest[field]) fail(`manifest.json needs a "${field}".`)
}
if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(manifest.id))
  fail('manifest.json "id": lowercase letters, digits and dashes only.')
if (manifest.version !== pkg.version) {
  fail(`manifest.json version ${manifest.version} differs from package.json version ${pkg.version}.`)
}

try {
  if (!statSync(join(root, 'build', 'index.js')).isFile()) throw new Error()
} catch {
  fail('build/index.js is missing. Run `bun run build` first (or use `bun run package`, which builds).')
}

const files = ['manifest.json', 'index.js', ...walk(join(root, 'build'))]
const zip = createZip(files.map((name) => ({ name, data: readFileSync(join(root, name)) })))

// Read it back: the two files Pano needs are at the root and every byte survived.
const back = readZip(zip)
for (const name of ['manifest.json', 'index.js', 'build/index.js']) {
  if (!back.has(name)) fail(`internal error: ${name} is not in the zip.`)
}

mkdirSync(dirname(out), { recursive: true })
writeFileSync(out, zip)

console.log(
  `package: ${manifest.id} ${manifest.version} -> ${out} (${files.length} files, ${(zip.length / 1024).toFixed(0)} KiB)`
)
