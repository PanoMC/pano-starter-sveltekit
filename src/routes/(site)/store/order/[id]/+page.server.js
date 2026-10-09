import { getOrder } from '$lib/pano/plugins/market/index.js'
import { failPage, hasMarket } from '$lib/store/load.server.js'

/** @type {import('@sveltejs/kit').ServerLoad} */
export async function load({ locals, params }) {
  if (!hasMarket(locals)) return { missing: true }

  // The page asks for the limited view only: the order's access token never goes through server logs or caches.
  // A signed-in owner is recognised by the session and gets the full view; a guest's browser asks again with the
  // token it holds (see Order.svelte).
  const result = await getOrder(/** @type {any} */ (locals).pano, { path: { publicId: params.id ?? '' } })
  if (!result.ok) failPage(result)

  return { missing: false, order: result.data.order }
}
