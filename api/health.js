export default function handler(_req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  const storageConfigured = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY)
  const githubConfigured = Boolean(process.env.GITHUB_APP_SLUG && process.env.GITHUB_APP_ID && process.env.GITHUB_APP_CLIENT_ID && process.env.GITHUB_APP_CLIENT_SECRET && process.env.GITHUB_APP_PRIVATE_KEY && process.env.GENIE_BASE_URL && process.env.OAUTH_STATE_SECRET && process.env.GENIE_TOKEN_ENCRYPTION_KEY && process.env.GENIE_API_KEY?.length >= 32 && storageConfigured)
  const vercelConfigured = Boolean(process.env.VERCEL_INTEGRATION_SLUG && process.env.VERCEL_CLIENT_ID && process.env.VERCEL_CLIENT_SECRET && process.env.GENIE_BASE_URL && process.env.OAUTH_STATE_SECRET && process.env.GENIE_TOKEN_ENCRYPTION_KEY && process.env.GENIE_API_KEY?.length >= 32 && storageConfigured)
  const hotmartConfigured = Boolean(process.env.HOTMART_HOTTOK && process.env.HOTMART_CLIENT_ID && process.env.HOTMART_CLIENT_SECRET && process.env.HOTMART_BASIC_TOKEN && process.env.GENIE_API_KEY?.length >= 32 && storageConfigured)
  res.status(200).json({
    service: 'genie-backend',
    status: 'ok',
    integrations: {
      github: { configured: githubConfigured, validated: false },
      vercel: { configured: vercelConfigured, validated: false },
      hotmart: { configured: hotmartConfigured, validated: false },
    },
    storage: { configured: storageConfigured },
  })
}
