-- Gold Play: telemetria de reprodução (travadas, erros, reconexões, amostras por minuto)
create table if not exists public.play_eventos (
  id bigserial primary key,
  usuario text not null,
  owner_id uuid,
  dns_id uuid,
  host text,
  canal text,
  aparelho text,
  tipo text not null check (tipo in ('travada','erro','reconexao','inicio','amostra')),
  dur_ms integer,
  ctrl_ms integer,
  prov_ms integer,
  perdidos integer,
  total integer,
  causa text,
  detalhe text,
  em timestamptz not null default now()
);
create index if not exists play_eventos_em_idx on public.play_eventos (em desc);
create index if not exists play_eventos_owner_em_idx on public.play_eventos (owner_id, em desc);
alter table public.play_eventos enable row level security;
drop policy if exists play_eventos_dono on public.play_eventos;
create policy play_eventos_dono on public.play_eventos for select to authenticated using (owner_id = auth.uid());
-- controle de alerta de qualidade (evita repetir aviso)
alter table public.dns add column if not exists qualidade_alertada timestamptz;
