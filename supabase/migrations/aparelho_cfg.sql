-- tema escolhido na própria TV (botão Temas)
create table if not exists public.aparelho_cfg (aparelho text primary key, tema text, atualizado timestamptz not null default now());
alter table public.aparelho_cfg enable row level security;
