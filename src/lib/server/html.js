// Post bodies are HTML written in Pano's panel. Anyone with the post permission can write them, so they are cleaned
// here, on the server, before the page renders them with {@html}: formatting, links and images stay; scripts, event
// handlers, iframes, forms and javascript: links go. The lists match what the panel editor writes.
import sanitizeHtml from 'sanitize-html'

const STYLE_VALUE = [/^[#a-z0-9\s.,%()-]+$/i]

/** @type {Parameters<typeof sanitizeHtml>[1]} */
const OPTIONS = {
  allowedTags: [
    'a',
    'abbr',
    'b',
    'blockquote',
    'br',
    'caption',
    'code',
    'col',
    'colgroup',
    'del',
    'div',
    'em',
    'figcaption',
    'figure',
    'h1',
    'h2',
    'h3',
    'h4',
    'h5',
    'h6',
    'hr',
    'i',
    'img',
    'ins',
    'kbd',
    'li',
    'mark',
    'ol',
    'p',
    'pre',
    's',
    'small',
    'span',
    'strike',
    'strong',
    'sub',
    'sup',
    'table',
    'tbody',
    'td',
    'tfoot',
    'th',
    'thead',
    'tr',
    'u',
    'ul'
  ],
  allowedAttributes: {
    '*': ['class', 'style', 'title'],
    a: ['href', 'target', 'rel'],
    img: ['src', 'alt', 'width', 'height'],
    td: ['colspan', 'rowspan'],
    th: ['colspan', 'rowspan'],
    ol: ['start']
  },
  allowedStyles: {
    '*': {
      color: STYLE_VALUE,
      'background-color': STYLE_VALUE,
      'font-size': STYLE_VALUE,
      'font-weight': STYLE_VALUE,
      'font-style': STYLE_VALUE,
      'line-height': STYLE_VALUE,
      width: STYLE_VALUE,
      height: STYLE_VALUE,
      'font-family': [/^[a-z0-9\s,'"-]+$/i],
      'text-align': [/^(left|right|center|justify)$/],
      'text-decoration': [/^[a-z\s-]+$/i]
    }
  },
  allowedSchemes: ['http', 'https', 'mailto'],
  allowedSchemesByTag: { img: ['http', 'https', 'data'] },
  allowProtocolRelative: true,
  disallowedTagsMode: 'discard'
}

/**
 * Panel-written HTML without anything that could run script. Not a string yields "".
 * @param {unknown} html
 * @returns {string}
 */
export function sanitizePostHtml(html) {
  return typeof html === 'string' && html !== '' ? sanitizeHtml(html, OPTIONS) : ''
}
