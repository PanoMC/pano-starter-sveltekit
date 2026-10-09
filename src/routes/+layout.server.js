/** @type {import('@sveltejs/kit').ServerLoad} */
export function load({ locals }) {
  const { user } = /** @type {any} */ (locals)

  // Only what the pages show: never the token, never the permission list.
  return { user: user ? { username: user.username, panelAccess: Boolean(user.panelAccess) } : null }
}
