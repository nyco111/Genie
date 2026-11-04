import { createGitHubSetupHandler } from '../../lib/github-flow.js'
import { createStore } from '../../lib/store.js'

export default createGitHubSetupHandler({ store: createStore() })
