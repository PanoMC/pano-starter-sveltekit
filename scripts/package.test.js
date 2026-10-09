// The custom-app descriptor and the zip writer. `bun test scripts`
import { describe, expect, test } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { createZip, readZip } from './zip.mjs'

const root = resolve(import.meta.dir, '..')
const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'))
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))

/** The public paths of src/routes, with groups removed and [x] written {x}: "/store/{slug}". */
function routePaths(dir = join(root, 'src', 'routes'), prefix = '') {
  /** @type {string[]} */
  const found = []

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      const segment = /^\(.*\)$/.test(entry.name) ? '' : `/${entry.name.replace(/^\[(\w+)\]$/, '{$1}')}`
      found.push(...routePaths(join(dir, entry.name), prefix + segment))
    } else if (/^\+page(\.server)?\.js$|^\+page\.svelte$/.test(entry.name)) {
      found.push(prefix || '/')
    }
  }

  return found
}

describe('manifest.json', () => {
  test('is a custom app Pano accepts', () => {
    expect(manifest.type).toBe('custom-app')
    expect(manifest.id).toMatch(/^[a-z0-9][a-z0-9-]{0,62}$/)
    // Names of the built-in UIs and of the default theme are refused by Pano.
    expect(['panel-ui', 'setup-ui', 'vanilla-theme']).not.toContain(manifest.id)
    for (const field of ['title', 'version', 'author']) expect(typeof manifest[field]).toBe('string')
    expect(manifest.apiLevel).toBe(1)
    expect(manifest.premium).toBeUndefined()
  })

  test('has the version of package.json', () => {
    expect(manifest.version).toBe(pkg.version)
  })

  test('lists only pages this starter owns', () => {
    const routes = new Set(routePaths())

    expect(Object.keys(manifest.urls).length).toBeGreaterThan(0)
    for (const [target, path] of Object.entries(manifest.urls)) {
      expect(target).toMatch(/^[a-z][a-z-]*\.[a-z][a-z-]*$/)
      expect(typeof path).toBe('string')
      expect(routes.has(/** @type {string} */ (path).split('?')[0])).toBe(true)
    }

    // What the starter does not implement stays on Pano's fallback pages.
    for (const target of [
      'auth.activate',
      'auth.renew-password',
      'auth.activate-new-email',
      'premium-login.callback'
    ]) {
      expect(manifest.urls[target]).toBeUndefined()
    }
  })
})

describe('index.js', () => {
  const text = readFileSync(join(root, 'index.js'), 'utf8')

  test('starts the build next to it', () => {
    expect(text).toContain("import('./build/index.js')")
  })

  test('reads nothing but PANO_FRONTEND_KEY from a .env beside it', () => {
    expect(text).toContain('PANO_FRONTEND_KEY')
    expect(text).not.toMatch(/process\.env\[/)
  })
})

describe('zip writer', () => {
  test('round-trips text, binary and empty files', () => {
    const binary = Buffer.from(Array.from({ length: 5000 }, (_, i) => (i * 7919) % 256))
    const entries = [
      { name: 'manifest.json', data: Buffer.from('{"id":"x"}') },
      { name: 'build/empty', data: Buffer.alloc(0) },
      { name: 'build/zeros.bin', data: Buffer.alloc(100_000) },
      { name: 'build/random.bin', data: binary },
      { name: 'build/ünïcode.txt', data: Buffer.from('héllo') }
    ]
    const files = readZip(createZip(entries))

    expect([...files.keys()]).toEqual(entries.map((entry) => entry.name))
    for (const entry of entries) expect(files.get(entry.name)?.equals(entry.data)).toBe(true)
  })

  test('is deterministic', () => {
    const entries = [{ name: 'a', data: Buffer.from('same') }]

    expect(createZip(entries).equals(createZip(entries))).toBe(true)
  })

  test('refuses what is not a zip', () => {
    expect(() => readZip(Buffer.from('not a zip at all, just some text'))).toThrow()
  })
})
