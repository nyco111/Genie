import { createGitHubRepositoriesHandler } from '../../lib/github.js'
import { createStore } from '../../lib/store.js'

export default createGitHubRepositoriesHandler({ store: createStore() })
