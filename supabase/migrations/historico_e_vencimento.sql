-- Continuar assistindo / últimos canais (gravado pelo player) e vencimento do plano do usuário
alter table public.usuarios_app add column if not exists vence timestamptz;
create table if not exists public.historico (
  usuario text not null,
  tipo text not null check (tipo in ('live','filme','ep')),
  item_id text not null,
  nome text not null default '',
  icone text not null default '',
  extra jsonb not null default '{}'::jsonb,
  pos integer not null default 0,
  dur integer not null default 0,
  atualizado timestamptz not null default now(),
  primary key (usuario, tipo, item_id)
);
create index if not exists historico_usuario_recente on public.historico (usuario, atualizado desc);
alter table public.historico enable row level security;
