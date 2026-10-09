// Processes of the run. Every one is started with a known PID and stopped by exactly that PID, never by a pattern.
import { spawn, spawnSync } from 'node:child_process'
import { closeSync, mkdirSync, openSync } from 'node:fs'
import { join } from 'node:path'
import { buildEntry, workDir } from './paths.mjs'

/** @param {number} ms */
export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** @param {number} pid */
export function alive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/** Wait until `url` answers with any HTTP status. @param {string} url @param {number} [seconds] */
export async function waitForHttp(url, seconds = 60) {
  const until = Date.now() + seconds * 1000

  while (Date.now() < until) {
    try {
      await fetch(url, { signal: AbortSignal.timeout(3000), redirect: 'manual' })
      return
    } catch {
      await sleep(250)
    }
  }

  throw new Error(`${url} did not answer within ${seconds} s`)
}

/** Wait until nothing listens on `port`. @param {number} port @param {number} [seconds] */
export async function waitForFreePort(port, seconds = 20) {
  const until = Date.now() + seconds * 1000

  while (Date.now() < until) {
    const probe = spawnSync('ss', ['-ltnH', `sport = :${port}`], { encoding: 'utf8' })
    if (!probe.stdout.trim()) return
    await sleep(250)
  }

  throw new Error(`port ${port} is still in use after ${seconds} s`)
}

/**
 * The built starter as its own process: `bun build/index.js`. It runs from the work folder, so a `.env` of a developer
 * checkout can never leak into it, and only the variables given here (plus PATH) are set.
 * @param {{ name: string, port: number, env: Record<string, string|undefined> }} options
 */
export async function startStarter({ name, port, env }) {
  mkdirSync(workDir, { recursive: true })
  const logPath = join(workDir, `starter-${name}.log`)
  const log = openSync(logPath, 'w')

  /** @type {Record<string, string>} */
  const clean = { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', NODE_ENV: 'production' }
  for (const [key, value] of Object.entries({ PORT: String(port), HOST: '127.0.0.1', ...env })) {
    if (value !== undefined && value !== '') clean[key] = value
  }

  const child = spawn(process.execPath, [buildEntry], {
    cwd: workDir,
    env: clean,
    stdio: ['ignore', log, log]
  })
  closeSync(log)

  const pid = child.pid
  if (!pid) throw new Error(`the starter "${name}" did not start`)

  try {
    await waitForHttp(`http://127.0.0.1:${port}/`, 60)
  } catch (error) {
    stopPid(pid)
    throw error
  }

  return {
    pid,
    logPath,
    /** SIGTERM, then wait for the port to go. */
    async stop() {
      stopPid(pid)
      await waitForExit(pid)
      await waitForFreePort(port)
    }
  }
}

/** @param {number} pid */
export function stopPid(pid) {
  if (alive(pid)) process.kill(pid, 'SIGTERM')
}

/** @param {number} pid @param {number} [seconds] */
export async function waitForExit(pid, seconds = 15) {
  const until = Date.now() + seconds * 1000

  while (Date.now() < until && alive(pid)) await sleep(100)

  if (alive(pid)) {
    process.kill(pid, 'SIGKILL')
    await sleep(200)
  }
}
