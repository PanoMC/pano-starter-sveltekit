import { error } from '@sveltejs/kit'
import { getPostDetail } from '#lib/pano/core/index.js'

/** @type {import('@sveltejs/kit').ServerLoad} */
export async function load({ locals, params }) {
  const result = await getPostDetail(/** @type {any} */ (locals).pano, { path: { url: params.url ?? '' } })

  if (!result.ok) {
    if (result.status === 404) error(404, 'Post not found')
    error(
      result.status === 0 ? 502 : result.status,
      result.status === 0 ? 'Pano did not answer.' : result.error.message || result.error.code
    )
  }

  const { post, previousPost, nextPost } = result.data

  return {
    post,
    previous: typeof previousPost === 'object' ? previousPost : null,
    next: typeof nextPost === 'object' ? nextPost : null
  }
}
