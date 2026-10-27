-- Gold Play: catálogo de filmes/séries/canais guardado (deixa "Todos os filmes" e "Todas as séries" rápidos)
create table if not exists public.catalogo_cache (
  chave text primary key,
  dados jsonb not null,
  em timestamptz not null default now()
);
alter table public.catalogo_cache enable row level security; -- sem políticas: só o servidor acessa
