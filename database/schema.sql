create table if not exists public.hotmart_events (
  event_hash text primary key,
  event_type text not null,
  transaction_id text,
  product_id text,
  received_at timestamptz not null default now()
);

alter table public.hotmart_events enable row level security;
revoke all on table public.hotmart_events from anon, authenticated;

create table if not exists public.genie_oauth_states (
  provider text not null check (provider in ('github-install', 'github-oauth', 'vercel')),
  state_hash text not null,
  expires_at timestamptz not null,
  context jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  primary key (provider, state_hash)
);

create table if not exists public.genie_provider_connections (
  provider text primary key check (provider in ('github', 'vercel')),
  token_ciphertext text not null,
  metadata jsonb not null default '{}'::jsonb,
  expires_at timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.genie_oauth_states enable row level security;
alter table public.genie_provider_connections enable row level security;
revoke all on table public.genie_oauth_states from anon, authenticated;
revoke all on table public.genie_provider_connections from anon, authenticated;
