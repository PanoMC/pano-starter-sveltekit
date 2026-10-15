import { getStoreProduct } from '#lib/pano/plugins/market/index.js'
import { failPage, hasMarket } from '#lib/store/load.server.js'

/** @type {import('@sveltejs/kit').ServerLoad} */
export async function load({ locals, params }) {
  if (!hasMarket(locals)) return { missing: true }

  const result = await getStoreProduct(/** @type {any} */ (locals).pano, {
    path: { slug: params.slug ?? '' }
  })
  if (!result.ok) failPage(result)

  return { missing: false, product: result.data.product }
}
