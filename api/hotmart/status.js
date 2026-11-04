import { createHotmartStatusHandler } from '../../lib/hotmart.js'
import { createStore } from '../../lib/store.js'

export default createHotmartStatusHandler({ store: createStore() })
