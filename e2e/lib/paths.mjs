// Where things are, relative to this repo (the umbrella folder holds the sibling repos and `.open-frontend-run`).
import { spawnSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
export const umbrella = resolve(repo, '..')
export const runDir = join(umbrella, '.open-frontend-run')
export const bundle = join(runDir, 'bundle')
export const zipFile = join(runDir, 'artifacts', 'pano-starter.zip')
export const buildEntry = join(repo, 'build', 'index.js')
/** Logs, screenshots and the config handed to the browser scenarios. */
export const workDir = join(runDir, 'starter-e2e')
export const market = join(umbrella, 'pano-web-platform', 'plugins', 'pano-plugin-market')
/** STARTER_E2E_INSTANCE_SCRIPT: another copy of market's e2e-instance.sh (a development loop that needs to change its smoke step). */
export const instanceScript =
  process.env.STARTER_E2E_INSTANCE_SCRIPT || join(market, 'scripts', 'e2e-instance.sh')
export const slotHelper = join(umbrella, 'pano-open-frontend-spec', 'tools', 'of-slot.sh')

/**
 * The test slot (tools/README.md): `of-slot.sh <command>` exports PANO_OF_SLOT and the variables of its block. A run that only has
 * PANO_OF_SLOT (the development loop inside a held slot) reads the rest from `of-slot.sh env <slot>`.
 * @returns {Record<string, string>}
 */
function slotVariables() {
  const letter = process.env.PANO_OF_SLOT
  if (!letter) return {}
  if (process.env.PANO_OF_SLOT_BASE) return /** @type {Record<string, string>} */ (process.env)

  const result = spawnSync(slotHelper, ['env', letter], { encoding: 'utf8' })
  if (result.status !== 0) return {}
  return Object.fromEntries(
    result.stdout
      .split('\n')
      .filter((line) => line.includes('='))
      .map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)])
  )
}

const slotEnv = slotVariables()
const port = (/** @type {string} */ name) => Number(slotEnv[name] ?? 0)

/** The slot letter, '' when the process does not run inside one. */
export const slot = slotEnv.PANO_OF_SLOT ?? ''
/** The slot's database (pano_market_e2e_slot<x>). */
export const database = slotEnv.PANO_OF_SLOT_DB ?? ''
export const instanceDir = join(
  market,
  'build',
  'market-e2e',
  `instance-${slotEnv.PANO_OF_SLOT_NAME ?? 'none'}`
)

/** pano = Pano, gateway = fake payment gateway, own = starter on its own origin, upstream = starter behind Pano, sink = webhook sink, static = foreign-page host. */
export const ports = {
  pano: port('PANO_OF_SLOT_HTTP_PORT'),
  gateway: port('PANO_OF_SLOT_GATEWAY_PORT'),
  own: port('PANO_OF_SLOT_APP_PORT'),
  upstream: port('PANO_OF_SLOT_APP2_PORT'),
  sink: port('PANO_OF_SLOT_SINK_PORT'),
  static: port('PANO_OF_SLOT_STATIC_PORT')
}

/** Exit code 2 with the line to run when the process is not inside a slot. */
export function requireSlot() {
  if (slot && ports.pano) return
  console.error(`starter e2e: no test-instance slot; run it as  ${slotHelper} bun e2e/run.mjs`)
  process.exit(2)
}
