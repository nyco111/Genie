import { createVercelCallbackHandler } from '../../lib/vercel.js'
import { createStore } from '../../lib/store.js'

export default createVercelCallbackHandler({ store: createStore() })
