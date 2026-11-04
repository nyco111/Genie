import { handlePreflight, requireApiKey, setCors } from './http.js'

const HOTMART_AUTH_URL = 'https://api-sec-vlc.hotmart.com/security/oauth/token'
const HOTMART_API = 'https://developers.hotmart.com/payments/api/v1/sales'

function credentialsReady(env) {
  return Boolean(env.HOTMART_CLIENT_ID && env.HOTMART_CLIENT_SECRET && env.HOTMART_BASIC_TOKEN)
}

export function normalizeSalesHistory(data) {
  return (Array.isArray(data?.items) ? data.items : []).map(item => {
    const purchase = item.purchase ?? {}
    const product = item.product ?? {}
    const price = purchase.price ?? {}
    return {
      transaction: typeof purchase.transaction === 'string' ? purchase.transaction : null,
      status: typeof purchase.status === 'string' ? purchase.status : null,
      orderDate: Number.isFinite(purchase.order_date) ? purchase.order_date : null,
      productId: product.id == null ? null : String(product.id),
      productName: typeof product.name === 'string' ? product.name : null,
      source: typeof purchase.tracking?.source_sck === 'string' ? purchase.tracking.source_sck : null,
      amount: Number.isFinite(price.value) ? price.value : null,
      currency: typeof price.currency_code === 'string' ? price.currency_code : null,
    }
  })
}

export function normalizeSalesSummary(data) {
  return (Array.isArray(data?.items) ? data.items : []).map(item => {
    const totalValue = item.total_value
    const amount = typeof totalValue === 'number' ? totalValue : totalValue?.value
    const currency = item.currency_code ?? totalValue?.currency_code
    return {
      totalItems: Number.isFinite(item.total_items) ? item.total_items : null,
      totalValue: { value: Number.isFinite(amount) ? amount : null, currencyCode: typeof currency === 'string' ? currency : null },
    }
  })
}

export function createHotmartSalesHandler({ env = process.env, fetchImpl = fetch } = {}) {
  return async function hotmartSalesHandler(req, res) {
    if (handlePreflight(req, res, 'GET, OPTIONS')) return
    if (req.method !== 'GET') {
      setCors(res, 'GET, OPTIONS')
      res.setHeader('Allow', 'GET, OPTIONS')
      return res.status(405).json({ error: 'Method not allowed' })
    }
    setCors(res, 'GET, OPTIONS')
    if (!requireApiKey(req, res, env)) return
    if (!credentialsReady(env)) return res.status(503).json({ error: 'Hotmart API credentials are not configured' })

    const { start_date: startDate, end_date: endDate, product_id: productId } = req.query ?? {}
    if (!/^\d{13}$/.test(String(startDate ?? '')) || !/^\d{13}$/.test(String(endDate ?? '')) || Number(startDate) > Number(endDate)) {
      return res.status(400).json({ error: 'Provide start_date and end_date as ordered Unix milliseconds' })
    }
    if (productId != null && !/^\d{7}$/.test(String(productId))) return res.status(400).json({ error: 'Invalid product_id' })
    const pageToken = req.query?.page_token
    if (pageToken != null && (typeof pageToken !== 'string' || !/^[A-Za-z0-9+/_=-]{1,512}$/.test(pageToken))) return res.status(400).json({ error: 'Invalid page_token' })

    try {
      const tokenUrl = new URL(HOTMART_AUTH_URL)
      tokenUrl.searchParams.set('grant_type', 'client_credentials')
      tokenUrl.searchParams.set('client_id', env.HOTMART_CLIENT_ID)
      tokenUrl.searchParams.set('client_secret', env.HOTMART_CLIENT_SECRET)
      const tokenResponse = await fetchImpl(tokenUrl, {
        method: 'POST',
        headers: { Authorization: `Basic ${env.HOTMART_BASIC_TOKEN}`, 'Content-Type': 'application/json' },
      })
      if (!tokenResponse.ok) return res.status(502).json({ error: 'Hotmart authentication failed' })
      const token = await tokenResponse.json()
      if (typeof token.access_token !== 'string' || !token.access_token) return res.status(502).json({ error: 'Hotmart returned no access token' })

      const query = new URLSearchParams({ start_date: String(startDate), end_date: String(endDate), max_results: '100' })
      if (productId != null) query.set('product_id', String(productId))
      const summaryQuery = new URLSearchParams(query)
      const historyQuery = new URLSearchParams(query)
      if (pageToken != null) historyQuery.set('page_token', pageToken)
      const headers = { Authorization: `Bearer ${token.access_token}`, 'Content-Type': 'application/json' }
      const [summaryResponse, historyResponse] = await Promise.all([
        fetchImpl(`${HOTMART_API}/summary?${summaryQuery}`, { headers }),
        fetchImpl(`${HOTMART_API}/history?${historyQuery}`, { headers }),
      ])
      if (!summaryResponse.ok || !historyResponse.ok) return res.status(502).json({ error: 'Hotmart sales query failed' })
      const [summary, history] = await Promise.all([summaryResponse.json(), historyResponse.json()])
      return res.status(200).json({
        connected: true,
        summary: normalizeSalesSummary(summary),
        sales: normalizeSalesHistory(history),
        nextPageToken: history.page_info?.next_page_token ?? null,
      })
    } catch {
      return res.status(502).json({ error: 'Hotmart could not be reached' })
    }
  }
}
