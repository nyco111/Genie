import { createOAuthStartHandler } from '../../lib/oauth-start.js'
import { createStore } from '../../lib/store.js'

const slug = process.env.GITHUB_APP_SLUG
export default createOAuthStartHandler({
  provider: 'github-install',
  baseUrl: slug ? `https://github.com/apps/${encodeURIComponent(slug)}/installations/new` : '',
  store: createStore(),
})
