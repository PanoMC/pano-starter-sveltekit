import { hasMarket } from '$lib/store/load.server.js'

/** @type {import('@sveltejs/kit').ServerLoad} */
export function load({ locals }) {
  return { market: hasMarket(locals) }
}
