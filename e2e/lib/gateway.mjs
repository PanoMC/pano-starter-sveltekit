// The fake payment gateway of the run: the wire protocol market's fake provider speaks (create a payment, query it, a pay page).
// The pay page marks the payment paid, delivers the signed `payment.succeeded` webhook to Pano and sends the buyer back.
// A trimmed copy of market's e2e-browser/lib/gateway.mjs (no refunds, no recurring charges).
import crypto from 'node:crypto'
import http from 'node:http'

export const GATEWAY_SECRET = 'starter_e2e_secret_0123456789'

/** @param {number} port */
export async function startGateway(port) {
  /** @type {Map<string, any>} */
  const payments = new Map() // reference -> payment
  const runTag = Date.now().toString(36)
  let sequence = 0

  /** @param {any} payment */
  async function sendWebhook(payment) {
    const body = JSON.stringify({
      id: `evt_s${Date.now().toString(36)}${sequence++}`,
      type: 'payment.succeeded',
      data: {
        reference: payment.reference,
        paymentId: payment.id,
        amount: payment.amount,
        currency: payment.currency
      }
    })
    const t = Math.floor(Date.now() / 1000)
    const v1 = crypto.createHmac('sha256', GATEWAY_SECRET).update(`${t}.${body}`).digest('hex')
    // The payment's notify URL is the provider's NOTIFY route; the signed event goes to its WEBHOOK route.
    const hook = payment.notifyUrl.replace(/\/notify\/[^/?#]+$/, '/webhook')
    const answer = await fetch(hook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Fake-Signature': `t=${t},v1=${v1}` },
      body
    })

    if (!answer.ok)
      throw new Error(`the webhook of ${payment.reference} was answered ${answer.status} by ${hook}`)
  }

  /** @param {http.ServerResponse} res @param {number} status @param {unknown} value */
  const json = (res, status, value) => {
    res.writeHead(status, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(value))
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`)
    /** @type {Buffer[]} */
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    const raw = Buffer.concat(chunks).toString('utf8')

    try {
      if (req.method === 'GET' && url.pathname === '/v1/ping') return json(res, 200, { ok: true })

      if (req.method === 'POST' && url.pathname === '/v1/payments') {
        const body = JSON.parse(raw)
        const payment = { id: `pay_${runTag}${++sequence}`, status: 'pending', ...body }
        payments.set(body.reference, payment)
        return json(res, 201, {
          id: payment.id,
          payUrl: `http://127.0.0.1:${port}/pay/${encodeURIComponent(body.reference)}`
        })
      }

      const query = url.pathname.match(/^\/v1\/payments\/([^/]+)$/)

      if (req.method === 'GET' && query) {
        const payment = payments.get(decodeURIComponent(query[1]))
        if (!payment) return json(res, 404, { message: 'unknown' })
        return json(res, 200, {
          id: payment.id,
          status: payment.status,
          paidAmount: payment.status === 'paid' ? payment.amount : '0.00',
          currency: payment.currency
        })
      }

      const page = url.pathname.match(/^\/pay\/([^/]+)$/)

      if (req.method === 'GET' && page) {
        const payment = payments.get(decodeURIComponent(page[1]))
        if (!payment) return json(res, 404, { message: 'unknown' })

        payment.status = 'paid'
        await sendWebhook(payment)

        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
        return res.end(
          `<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=${payment.returnSuccess}"><title>Fake gateway</title>` +
            `<body><p>Fake gateway (TEST ONLY): paid, returning to the store.</p></body>`
        )
      }

      json(res, 404, { message: 'not found' })
    } catch (error) {
      json(res, 500, { message: String(/** @type {any} */ (error)?.message || error) })
    }
  })

  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', () => resolve(undefined))
  })

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    secret: GATEWAY_SECRET,
    payments,
    close: () => new Promise((resolve) => server.close(() => resolve(undefined)))
  }
}
