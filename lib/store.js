function supabaseConfig(env) {
  const base = env.SUPABASE_URL?.replace(/\/$/, '')
  const key = env.SUPABASE_SERVICE_ROLE_KEY
  if (!base || !key) throw new Error('Supabase server storage is not configured')
  return { base, key }
}

export function createStore({ env = process.env, fetchImpl = fetch } = {}) {
  async function request(table, query, { method = 'GET', body, prefer } = {}) {
    const { base, key } = supabaseConfig(env)
    const headers = { apikey: key, Authorization: `Bearer ${key}`, Accept: 'application/json' }
    if (body !== undefined) headers['Content-Type'] = 'application/json'
    if (prefer) headers.Prefer = prefer
    const response = await fetchImpl(`${base}/rest/v1/${table}${query ? `?${query}` : ''}`, {
      method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    if (!response.ok) throw new Error(`Storage request failed (${response.status})`)
    const text = await response.text()
    return text ? JSON.parse(text) : []
  }

  return {
    async getConnection(provider) {
      const rows = await request('genie_provider_connections', `provider=eq.${encodeURIComponent(provider)}&select=provider,token_ciphertext,metadata,expires_at,updated_at`)
      return rows[0] ?? null
    },
    async saveConnection(provider, tokenCiphertext, metadata = {}, expiresAt = null) {
      await request('genie_provider_connections', 'on_conflict=provider', {
        method: 'POST',
        prefer: 'resolution=merge-duplicates,return=minimal',
        body: { provider, token_ciphertext: tokenCiphertext, metadata, expires_at: expiresAt, updated_at: new Date().toISOString() },
      })
    },
    async getLatestHotmartEvent() {
      const rows = await request('hotmart_events', 'select=event_type,product_id,received_at&order=received_at.desc&limit=1')
      return rows[0] ?? null
    },
    async saveOAuthState(provider, nonceHash, expiresAt, context = {}) {
      await request('genie_oauth_states', '', {
        method: 'POST', prefer: 'return=minimal', body: { provider, state_hash: nonceHash, expires_at: expiresAt, context },
      })
    },
    async consumeOAuthState(provider, nonceHash, now = new Date().toISOString()) {
      const query = `provider=eq.${encodeURIComponent(provider)}&state_hash=eq.${encodeURIComponent(nonceHash)}&expires_at=gt.${encodeURIComponent(now)}&select=state_hash,context`
      const rows = await request('genie_oauth_states', query, { method: 'DELETE', prefer: 'return=representation' })
      return rows[0] ?? null
    },
  }
}
