import { createOAuthStartHandler } from '../../lib/oauth-start.js'
import { createStore } from '../../lib/store.js'

const slug = process.env.VERCEL_INTEGRATION_SLUG
export default createOAuthStartHandler({
  provider: 'vercel',
  baseUrl: slug ? `https://vercel.com/integrations/${encodeURIComponent(slug)}/new` : '',
  store: createStore(),
})
