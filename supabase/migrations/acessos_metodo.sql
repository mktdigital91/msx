-- Registra COMO cada login foi feito (código do celular, MAC pelo celular, digitado na TV, cadastro do painel).
alter table public.acessos add column if not exists metodo text;
alter table public.acessos add column if not exists mac text;
alter table public.usuarios_app add column if not exists ultimo_metodo text;

drop function if exists public.registrar_acesso(text, text, text, text, text);

create or replace function public.registrar_acesso(p_usuario text, p_aparelho text, p_evento text, p_ip text, p_ua text, p_metodo text default null, p_mac text default null)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  u public.usuarios_app; v_dns uuid; v_grupo uuid; v_owner uuid;
begin
  select * into u from public.usuarios_app where usuario = p_usuario;
  if u.usuario is null then
    select g.id, g.dns_ativa_id, g.owner_id into v_grupo, v_dns, v_owner
      from public.grupos g where g.dns_ativa_id is not null order by g.criado limit 1;
    insert into public.usuarios_app(usuario, owner_id, grupo_id, dns_id, aparelho, logins, ultima_acao, ultimo_metodo)
    values (p_usuario, v_owner, v_grupo, v_dns, p_aparelho, case when p_evento = 'login' then 1 else 0 end, p_evento, p_metodo);
  else
    v_owner := u.owner_id; v_dns := u.dns_id;
    if v_dns is null or not exists (select 1 from public.dns where id = v_dns and ativo) then
      select g.dns_ativa_id into v_dns from public.grupos g where g.id = coalesce(u.grupo_id,
        (select g2.id from public.grupos g2 where g2.dns_ativa_id is not null order by g2.criado limit 1));
    end if;
    update public.usuarios_app
       set ultimo_acesso = now(), aparelho = coalesce(p_aparelho, aparelho), ultima_acao = p_evento,
           ultimo_metodo = coalesce(p_metodo, ultimo_metodo),
           logins = logins + case when p_evento = 'login' then 1 else 0 end, dns_id = v_dns
     where usuario = p_usuario;
  end if;
  if p_evento = 'login'
     or not exists (select 1 from public.acessos where usuario = p_usuario and em > now() - interval '30 minutes') then
    insert into public.acessos(usuario, owner_id, aparelho, dns_id, evento, ip, user_agent, metodo, mac)
    values (p_usuario, v_owner, p_aparelho, v_dns, p_evento, p_ip, left(p_ua, 200), p_metodo, p_mac);
  end if;
  return v_dns;
end $function$;
