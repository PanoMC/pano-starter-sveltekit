import { describe, expect, test } from 'bun:test'
import { sanitizePostHtml } from '#lib/server/html.js'

describe('sanitizePostHtml', () => {
  test('keeps what the panel editor writes', () => {
    const out = sanitizePostHtml(
      '<h2>T</h2><p><strong>a</strong> <a href="https://panomc.com" target="_blank">b</a></p><img src="https://x.test/a.png" alt="a"><span style="color: red">c</span>'
    )
    expect(out).toContain('<h2>T</h2>')
    expect(out).toContain('<a href="https://panomc.com" target="_blank">b</a>')
    expect(out).toContain('<img src="https://x.test/a.png" alt="a" />')
    expect(out).toContain('style="color:red"')
  })

  test('removes scripts, event handlers, iframes and javascript: links', () => {
    const out = sanitizePostHtml(
      '<p>ok</p><script>alert(1)</script><img src="x" onerror="alert(1)"><a href="javascript:alert(1)">x</a><iframe src="https://e.test"></iframe>'
    )
    expect(out).toContain('<p>ok</p>')
    for (const bad of ['<script', 'onerror', 'javascript:', '<iframe']) expect(out).not.toContain(bad)
  })

  test('not a string yields an empty string', () => {
    expect(sanitizePostHtml(undefined)).toBe('')
    expect(sanitizePostHtml(null)).toBe('')
  })
})
