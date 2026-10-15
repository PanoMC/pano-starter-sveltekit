import { getCheckoutConfig } from '#lib/pano/plugins/market/index.js'
import { failPage, hasMarket } from '#lib/store/load.server.js'

/** @type {import('@sveltejs/kit').ServerLoad} */
export async function load({ locals, request }) {
  if (!hasMarket(locals)) return { missing: true }

  const locale = request.headers.get('accept-language')?.split(',')[0]?.trim() || undefined
  const result = await getCheckoutConfig(/** @type {any} */ (locals).pano, { query: { locale } })
  if (!result.ok) {
    if (result.error.code === 'STORE_DISABLED') return { missing: false, disabled: true }
    failPage(result)
  }

  return { missing: false, disabled: false, config: result.data }
}
