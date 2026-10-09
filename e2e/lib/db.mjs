// One database statement the panel API cannot do. The instance's database is the isolated one e2e-instance.sh created, never the dev one.
import { execFileSync } from 'node:child_process'
import { databasePassword } from './instance.mjs'
import { database as DATABASE } from './paths.mjs'

const PREFIX = 'pano_'

/**
 * Mark a user's email address as verified.
 *
 * Why this exists: with `requireEmailVerification = false` a new account is signed in at once but its `emailVerified` stays 0, and
 * `AuthProvider.authenticate` then refuses every later login with LOGIN_EMAIL_NOT_VERIFIED. Nothing in the API verifies an address
 * without the mailed token, and this instance sends no mail, so the run does what the mail link would have done.
 * @param {string} username
 */
export function markEmailVerified(username) {
  if (!/^[A-Za-z0-9_]{1,32}$/.test(username)) throw new Error(`refusing the user name ${username}`)

  const sql = `UPDATE \`${PREFIX}user\` SET \`emailVerified\` = 1 WHERE \`username\` = '${username}'; SELECT ROW_COUNT();`
  const container = process.env.MARKET_E2E_DB_CONTAINER || 'pano-web-platform-db-1'
  const env = { ...process.env, MYSQL_PWD: databasePassword() }

  try {
    execFileSync('docker', ['exec', '-e', 'MYSQL_PWD', container, 'mariadb', '-uroot', DATABASE, '-e', sql], {
      env,
      stdio: ['ignore', 'pipe', 'pipe']
    })
  } catch (error) {
    // No docker: a host client over TCP, like e2e-instance.sh does.
    const [host, port] = (process.env.PANO_IT_MARIADB || '127.0.0.1:3306').split(':')
    const client = ['mariadb', 'mysql'].find((name) =>
      execFileSync('sh', ['-c', `command -v ${name} || true`])
        .toString()
        .trim()
    )
    if (!client)
      throw new Error(`cannot reach the database: ${/** @type {Error} */ (error).message.split('\n')[0]}`)
    execFileSync(client, ['-h', host, '-P', port, '-uroot', DATABASE, '-e', sql], {
      env,
      stdio: ['ignore', 'pipe', 'pipe']
    })
  }
}
