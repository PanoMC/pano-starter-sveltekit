import { error } from '@sveltejs/kit'
import { getPosts } from '$lib/pano/core/index.js'
import { readPosts } from '$lib/posts.js'

/** @type {import('@sveltejs/kit').ServerLoad} */
export async function load({ locals, url }) {
  const page = Math.max(1, Number.parseInt(url.searchParams.get('page') ?? '1', 10) || 1)
  const categoryUrl = url.searchParams.get('category') || undefined

  const result = await getPosts(/** @type {any} */ (locals).pano, { query: { page, categoryUrl } })

  if (!result.ok) {
    // An empty page 1 is fine; a page past the end is a 404.
    if (result.status === 404) error(404, 'No such page')
    error(
      result.status === 0 ? 502 : result.status,
      result.status === 0 ? 'Pano did not answer.' : result.error.message || result.error.code
    )
  }

  return { ...readPosts(result.data, page), category: categoryUrl ?? null }
}
