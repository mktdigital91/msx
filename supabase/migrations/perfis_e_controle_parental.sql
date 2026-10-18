-- Perfis do app por usuário (perfis_app: "perfis" já é a tabela de acessos do painel) (estilo Netflix) e controle parental da conta (senha padrão 0000)
create table if not exists public.perfis_app (
  usuario text not null,
  id text not null,
  nome text not null,
  cor integer not null default 0,
  infantil boolean not null default false,
  criado timestamptz not null default now(),
  primary key (usuario, id)
);
alter table public.perfis_app enable row level security;
create table if not exists public.conta_cfg (
  usuario text primary key,
  pin text not null default '0000',
  parental boolean not null default true,
  atualizado timestamptz not null default now()
);
alter table public.conta_cfg enable row level security;
