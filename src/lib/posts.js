// Read the post endpoints' answers. Accepts today's shape too (`posts` + `totalPage`) next to `{ items, page }`.

/**
 * @param {any} data body of GET /api/v1/posts
 * @returns {{ items: import('#lib/pano/core/types.js').PostSummary[], page: { number: number, totalPages: number } }}
 */
export function readPosts(data, requestedPage = 1) {
  const items = data?.items ?? data?.posts ?? []
  const totalPages = data?.page?.totalPages ?? data?.totalPage ?? 1

  return { items, page: { number: data?.page?.number ?? requestedPage, totalPages: Math.max(1, totalPages) } }
}

/** @param {number|string|undefined|null} epoch milliseconds */
export function formatDate(epoch) {
  if (epoch === undefined || epoch === null) return ''
  const date = new Date(Number(epoch))
  return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10)
}

/** The writer of a post, or an empty string (Pano sends "-" for none). @param {any} post */
export function writerOf(post) {
  const name = post?.writer?.username
  return name && name !== '-' ? name : ''
}

/** The category title of a post, or an empty string (Pano sends "-" for none). @param {any} post */
export function categoryOf(post) {
  const title = post?.category?.title
  return title && title !== '-' ? title : ''
}

/**
 * Plain text of a truncated HTML excerpt.
 * @param {string|undefined|null} html
 */
export function excerpt(html) {
  return (html ?? '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&hellip;/g, '…')
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim()
}
