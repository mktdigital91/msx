-- Gold Play: catálogo indexado (filmes, séries, canais) para páginas rápidas
create table if not exists public.catalogo_itens (
  chave text not null, k text not null, id text not null,
  nome text not null, img text, r numeric, x text, cat text, added bigint, n integer, ord_nome text, v bigint,
  primary key (chave, k, id)
);
create index if not exists catalogo_itens_rec on public.catalogo_itens (chave, k, added desc);
create index if not exists catalogo_itens_cat on public.catalogo_itens (chave, k, cat, added desc);
create index if not exists catalogo_itens_nota on public.catalogo_itens (chave, k, r desc);
create index if not exists catalogo_itens_az on public.catalogo_itens (chave, k, ord_nome);
create table if not exists public.catalogo_meta (chave text not null, k text not null, em timestamptz not null default now(), total integer, primary key (chave, k));
alter table public.catalogo_itens enable row level security;
alter table public.catalogo_meta enable row level security;
drop table if exists public.catalogo_cache;
