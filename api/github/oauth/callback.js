import { createGitHubOAuthCallbackHandler } from '../../../lib/github-flow.js'
import { createStore } from '../../../lib/store.js'

export default createGitHubOAuthCallbackHandler({ store: createStore() })
