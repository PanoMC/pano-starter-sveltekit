import { getStore, getStoreProducts } from '#lib/pano/plugins/market/index.js'
import { failPage, hasMarket, positiveInt } from '#lib/store/load.server.js'
import { flattenCategories } from '#lib/store/format.js'

const SORTS = new Set(['priority', 'newest', 'price-asc', 'price-desc', 'bestselling'])

/** @type {import('@sveltejs/kit').ServerLoad} */
export async function load({ locals, url }) {
  if (!hasMarket(locals)) return { missing: true }

  const pano = /** @type {any} */ (locals).pano
  const page = positiveInt(url.searchParams.get('page'), 1)
  const category = url.searchParams.get('category') ? positiveInt(url.searchParams.get('category'), 0) : 0
  const search = (url.searchParams.get('search') ?? '').trim().slice(0, 100)
  const sortParam = url.searchParams.get('sort') ?? ''
  const sort = SORTS.has(sortParam) ? sortParam : ''
  const filtered = page > 1 || category > 0 || search !== '' || sort !== ''
  const filter = { page, category: category || null, search, sort }

  const store = await getStore(pano)

  if (!store.ok) {
    if (store.error.code === 'STORE_DISABLED') return { missing: false, disabled: true }
    failPage(store)
  }

  let list = store.data

  if (filtered) {
    const result = await getStoreProducts(pano, {
      query: {
        page,
        category: category ? String(category) : undefined,
        search: search || undefined,
        sort: sort || undefined
      }
    })
    if (!result.ok) failPage(result)
    list = { ...store.data, items: result.data.items, page: result.data.page }
  }

  return {
    missing: false,
    disabled: false,
    settings: store.data.settings,
    categories: flattenCategories(/** @type {any} */ (store.data.categories)),
    featured: filtered ? [] : (store.data.featured ?? []),
    items: list.items ?? [],
    page: list.page ?? { number: 1, size: 0, totalItems: 0, totalPages: 1 },
    filter
  }
}
