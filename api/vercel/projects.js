import { createVercelProjectsHandler } from '../../lib/vercel.js'
import { createStore } from '../../lib/store.js'

export default createVercelProjectsHandler({ store: createStore() })
