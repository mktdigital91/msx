-- Gold Play: usuários salvos por TV (entrar com um toque). A senha fica criptografada (AES-GCM) pelo servidor.
create table if not exists public.contas_salvas (
  aparelho text not null,
  usuario text not null,
  senha_enc text not null,
  ultimo_uso timestamptz not null default now(),
  primary key (aparelho, usuario)
);
alter table public.contas_salvas enable row level security; -- sem políticas: só o servidor (service role) acessa
