import { createHotmartHandler, insertHotmartEvent } from '../../lib/hotmart.js'

export default createHotmartHandler({
  secret: process.env.HOTMART_HOTTOK,
  insertEvent: record => insertHotmartEvent(record),
})
