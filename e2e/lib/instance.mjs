// The isolated Pano instance, started and stopped by market's e2e-instance.sh from the frozen bundle (never the dev instance).
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, openSync, readFileSync, closeSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { bundle, instanceDir, runDir, instanceScript, market, ports, umbrella, workDir } from './paths.mjs'

const JAVA = '/usr/lib/jvm/java-21-openjdk/bin/java'

/** The MariaDB root password from docker-compose.yml, unless the environment has it. Never printed. */
export function databasePassword() {
  if (process.env.PANO_IT_MARIADB_PASSWORD) return process.env.PANO_IT_MARIADB_PASSWORD

  const compose = readFileSync(join(umbrella, 'pano-web-platform', 'docker-compose.yml'), 'utf8')
  const found = /^\s*MYSQL_ROOT_PASSWORD:\s*(.+?)\s*$/m.exec(compose)?.[1]?.replace(/^["']|["']$/g, '')

  if (!found)
    throw new Error(
      'MYSQL_ROOT_PASSWORD not found in docker-compose.yml and PANO_IT_MARIADB_PASSWORD is not set'
    )
  return found
}

let runJarPath = ''

/**
 * Builds the run jar (rule 16): the built Pano jar with its embedded panel and vanilla zips replaced by the fresh builds of the
 * checkouts, because the zips in the jar are the frozen ones and do not serve `/`. Cached by hash. Call once before bundleJars().
 * Does nothing with STARTER_E2E_JARS=bundle.
 */
export async function prepareRunJar() {
  if (process.env.STARTER_E2E_JARS === 'bundle') return ''
  const { buildRunJar } = await import(
    pathToFileURL(join(umbrella, 'pano-showcase', 'scripts', 'lib', 'runjar.mjs')).href
  )
  runJarPath = await buildRunJar({
    source: join(umbrella, 'pano-web-platform', 'build', 'libs', 'Pano-local-build.jar'),
    panelBuild: join(umbrella, 'panel-ui', 'build'),
    vanillaBuild: join(umbrella, 'themes', 'vanilla-theme', 'build'),
    outDir: join(runDir, 'work'),
    log: (line) => console.log(`  ${line}`)
  })
  return runJarPath
}

/**
 * The jars the instance runs. Default: the current build (`pano-web-platform/build/libs` and `build/plugins`), because the starter pulls its
 * client from the instance and the frozen bundle serves neither /api/v1/openapi.json nor the widget loader. STARTER_E2E_JARS=bundle takes
 * the frozen bundle (BOOT-01's boot-gate.sh) instead. STARTER_E2E_MARKET_JAR names another market jar (one whose UI build emitted the widgets). market's fake provider jar comes from market's build in both cases.
 * Throws a readable error when something is missing.
 */
export function bundleJars() {
  const platform = join(umbrella, 'pano-web-platform')
  const useBundle = process.env.STARTER_E2E_JARS === 'bundle'
  const jars = {
    pano: useBundle
      ? join(bundle, 'pano', 'Pano-local-build.jar')
      : runJarPath || join(platform, 'build', 'libs', 'Pano-local-build.jar'),
    market:
      process.env.STARTER_E2E_MARKET_JAR ||
      (useBundle
        ? join(bundle, 'plugins', 'pano-plugin-market-local-build.jar')
        : join(platform, 'build', 'plugins', 'pano-plugin-market-local-build.jar')),
    fake: join(market, 'build', 'fake', 'pano-plugin-market-fake-local-build.jar')
  }

  for (const [name, file] of Object.entries(jars)) {
    if (!existsSync(file))
      throw new Error(`${name} jar missing: ${file} (build it with Gradle, or set STARTER_E2E_JARS=bundle)`)
    // A jar written while the disk failed has its size but no data; refuse it instead of booting it.
    const test = spawnSync('unzip', ['-tq', file], { encoding: 'utf8' })
    if (test.status !== 0) throw new Error(`${name} jar is damaged (unzip -tq failed): ${file}`)
  }

  return jars
}

/** @param {string[]} args @param {string} logName */
function script(args, logName) {
  const jars = bundleJars()
  mkdirSync(workDir, { recursive: true })
  const log = openSync(join(workDir, logName), 'w')

  const result = spawnSync(instanceScript, args, {
    env: {
      ...process.env,
      PANO_IT_MARIADB_PASSWORD: databasePassword(),
      MARKET_E2E_PANO_JAR: jars.pano,
      MARKET_E2E_PLUGIN_JAR: jars.market,
      MARKET_E2E_FAKE_JAR: jars.fake,
      MARKET_E2E_JAVA: JAVA
    },
    stdio: ['ignore', log, log]
  })

  closeSync(log)
  return result.status ?? 1
}

/**
 * Pano reads the widget runtime from the classpath (`UIFiles/widget-runtime.zip`) or from the folder `widget-runtime/` beside its
 * themes folder. A jar built before the Gradle build embeds the zip has neither, so this unpacks theme-core's build of it into
 * the instance (the folder is read on every request: no restart). Does nothing when the jar carries the zip.
 */
export function installWidgetRuntime() {
  const jar = bundleJars().pano
  const listing = spawnSync('unzip', ['-l', jar], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  if (/UIFiles\/widget-runtime\.zip/.test(listing.stdout)) return 'jar'

  const zip = join(umbrella, 'theme-core', 'packages', 'widget-host', 'dist', 'widget-runtime.zip')
  if (!existsSync(zip))
    throw new Error(`no widget runtime: ${zip} is missing (bun run build in theme-core/packages/widget-host)`)
  if (spawnSync('unzip', ['-tq', zip]).status !== 0) throw new Error(`${zip} is damaged (unzip -tq failed)`)

  const target = join(instanceDir, 'widget-runtime')
  const result = spawnSync('unzip', ['-q', '-o', zip, '-d', target], { encoding: 'utf8' })
  if (result.status !== 0) throw new Error(`could not unpack ${zip}: ${result.stderr}`)
  return 'folder'
}

/** Start a fresh instance (database recreated) with the host UIs bundled in the Pano jar. Returns Pano's origin. */
export function startInstance() {
  // inside the slot the script takes the instance name, the ports and the database from the slot variables
  const code = script(['start'], 'instance-start.log')

  if (code !== 0)
    throw new Error(`e2e-instance.sh start exited ${code} (log ${join(workDir, 'instance-start.log')})`)
  return `http://127.0.0.1:${ports.pano}`
}

/**
 * Stop and start again with the data kept. Pano reads the front-end descriptor into its URL map only at boot (a refresh after saving
 * does not reach the map: platform defect, reported by ST-04), so a run that needs the map to answer restarts once after the refresh.
 */
export function restartInstance() {
  const code = script(['restart'], 'instance-restart.log')

  if (code !== 0)
    throw new Error(`e2e-instance.sh restart exited ${code} (log ${join(workDir, 'instance-restart.log')})`)
}

/** Stop the instance by its recorded PID. Returns the exit code of the script. */
export function stopInstance() {
  return script(['stop'], 'instance-stop.log')
}

/** The PID file's content, or null. */
export function instancePid() {
  try {
    return Number(readFileSync(join(instanceDir, 'pano.pid'), 'utf8').trim()) || null
  } catch {
    return null
  }
}

/** The admin account e2e-instance.sh created. */
export function adminLogin() {
  const text = readFileSync(join(instanceDir, 'admin.env'), 'utf8')
  const read = (/** @type {string} */ key) => new RegExp(`^${key}=(.*)$`, 'm').exec(text)?.[1] ?? ''

  return { user: read('SMOKE_ADMIN_USER') || 'smokeadmin', password: read('SMOKE_ADMIN_PASSWORD') }
}
