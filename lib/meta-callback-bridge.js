const LOCAL_CALLBACK = 'http://127.0.0.1:3347/api/meta/callback'

export function createMetaCallbackBridgeHandler() {
  return function metaCallbackBridgeHandler(req, res) {
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET')
      return res.status(405).end('Method not allowed')
    }
    const query = req.query ?? {}
    const state = String(query.state ?? '')
    const code = String(query.code ?? '')
    const error = String(query.error ?? '')
    if (!/^[a-f0-9]{32}$/i.test(state) || (!code && !error) || code.length > 4096) {
      return res.status(400).end('Autorização inválida ou incompleta. Volte ao Genie e tente novamente.')
    }
    const target = new URL(LOCAL_CALLBACK)
    target.searchParams.set('state', state)
    if (code) target.searchParams.set('code', code)
    if (error) target.searchParams.set('error', error.slice(0, 200))
    const description = String(query.error_description ?? '')
    if (description) target.searchParams.set('error_description', description.slice(0, 500))
    res.setHeader('Cache-Control', 'no-store')
    res.setHeader('Referrer-Policy', 'no-referrer')
    res.setHeader('Location', target.toString())
    return res.status(303).end()
  }
}
