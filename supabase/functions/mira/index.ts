// Gold Play (MVP de uso próprio): ponte entre o Media Station X (TV) e o provedor Xtream.
// A TV não consegue ler o provedor direto; esta função lê e devolve telas prontas para o MSX.
// O endereço (DNS) do provedor fica AQUI, no Supabase, e não no GitHub público.
// Usuário/senha vêm da TV, viram um token criptografado (30 dias) e não são guardados.
import { AsyncLocalStorage } from "node:async_hooks";
import { Image as Img, GIF, Frame } from "https://deno.land/x/imagescript@1.3.0/mod.ts";

const PROVEDOR = { host: "horizonmult.site", protocolo: "http" };
const POR_PAGINA = 36; // menos capas por página: abre e pagina mais rápido
const VALIDADE_MS = 30 * 24 * 3600 * 1000;
const INPUT = "http://msx.benzac.de/interaction/input.html";

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, x-client-info, apikey, content-type",
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
};

const IMG = "https://mktdigital91.github.io/msx/msx/img/";
let LOGO = IMG + "logo-goldplay.png";
let FUNDO_CFG = ""; // imagem de fundo escolhida no painel (vazio = fundos padrão)
// ---------- temas do app (painel > Personalizar app) ----------
// "classico": o visual colorido original; "onix": preto com dourado
let TEMA = "classico";
let TEMA_PAINEL = "classico"; // o escolhido no painel; cada TV pode trocar pelo botão Temas
let _cfgCores: any = {};
// aplica um tema (imagens + cores) para a resposta atual
function usarTema(tm: string) {
  TEMA = tm === "onix" ? "onix" : tm === "moderno" ? "moderno" : "classico";
  // Ônix e Moderno têm cores próprias; no Clássico valem as cores escolhidas no painel
  Object.assign(COR, TEMA === "onix" ? COR_ONIX : TEMA === "moderno" ? COR_MODERNO : COR_CLASSICO);
  Object.assign(VID, TEMA === "onix" ? VID_ONIX : TEMA === "moderno" ? VID_MODERNO : VID_CLASSICO);
  const c = _cfgCores;
  if (TEMA === "classico" && c) {
    COR.tv = rgba(c.cor_tv, 0.40) ?? COR.tv;
    COR.vod = rgba(c.cor_filmes, 0.38) ?? COR.vod;
    COR.series = rgba(c.cor_series, 0.32) ?? COR.series;
    COR.vidro = rgba(c.cor_vidro, 0.55) ?? COR.vidro;
    if (/^#[0-9a-f]{6}$/i.test(c.cor_destaque ?? "")) COR.destaque = c.cor_destaque;
  }
}
// tema escolhido na própria TV (aparelho) — guardado no banco, lido com cache curto
const _temaAp = new Map<string, { t: number; v: string }>();
async function temaDoAparelho(d: string | null): Promise<string> {
  if (!d) return "";
  const c = _temaAp.get(d); if (c && Date.now() - c.t < 60_000) return c.v;
  let v = "";
  try {
    const r = await fetch(`${SB()}/rest/v1/aparelho_cfg?aparelho=eq.${encodeURIComponent(d)}&select=tema&limit=1`, { headers: sbh(), signal: AbortSignal.timeout(3000) });
    const j = await r.json(); v = Array.isArray(j) && j[0]?.tema ? String(j[0].tema) : "";
  } catch { /* usa o do painel */ }
  _temaAp.set(d, { t: Date.now(), v }); return v;
}
async function salvarTemaAparelho(d: string, tema: string) {
  await fetch(`${SB()}/rest/v1/aparelho_cfg?on_conflict=aparelho`, { method: "POST", headers: { ...sbh(), prefer: "resolution=merge-duplicates" }, body: JSON.stringify({ aparelho: d, tema: tema || null, atualizado: new Date().toISOString() }), signal: AbortSignal.timeout(4000) });
  _temaAp.set(d, { t: Date.now(), v: tema });
}
const _apToken = new Map<string, string | null>();
const TEMAS: Record<string, { pasta: string; arquivos: Set<string> }> = {
  onix: { pasta: "temas/onix/", arquivos: new Set(["bg-tv.jpg", "bg-filmes.jpg", "bg-series.jpg", "card-tv.png", "card-filmes.png", "card-series.png", "btn-sair.png", "btn-atualizar.png", "btn-pesquisar.png", "login-qr.png", "login-codigo.png", "login-campo.png", "login-entrar.png", "login-novo.png", "btn-temas.png", "btn-config.png", "btn-lupa.png"]) },
};
// endereço de uma imagem do app no tema ativo (cai na versão clássica se o tema não tiver a peça)
const im = (nome: string) => { const t = TEMAS[TEMA]; return IMG + (t && t.arquivos.has(nome) ? t.pasta : "") + nome; };
let CONTATO = ""; // contato para renovar o plano (painel > Personalizar app)
let AVISO_DIAS = 5; // quantos dias antes do vencimento o aviso aparece
const COR_CLASSICO = { tv: "rgba(124,92,255,0.40)", vod: "rgba(244,63,142,0.38)", series: "rgba(34,211,238,0.32)", vidro: "rgba(14,16,36,0.55)", destaque: "#7C5CFF" };
const COR_ONIX = { tv: "rgba(214,178,94,0.22)", vod: "rgba(205,132,72,0.22)", series: "rgba(196,186,160,0.20)", vidro: "rgba(16,15,19,0.74)", destaque: "#D6B25E" };
const COR_MODERNO = { tv: "rgba(37,99,235,0.28)", vod: "rgba(59,130,246,0.26)", series: "rgba(14,165,233,0.26)", vidro: "rgba(8,14,34,0.80)", destaque: "#3B82F6" };
const COR = { ...COR_CLASSICO };

const BASE_PROV = `${PROVEDOR.protocolo}://${PROVEDOR.host}`; // reserva, se o painel/banco não responder

// ---------- relay: provedores que bloqueiam o servidor mas aceitam a TV ----------
// A TV (plugin) busca no provedor e devolve o texto; o servidor monta as telas como sempre.
type Rel = { cap: boolean; rel: Map<string, string | null>; need: Set<string>; relay: boolean };
const ALS = new AsyncLocalStorage<Rel>();
const RC = () => ALS.getStore();
class RelayNeed extends Error { constructor() { super("relay"); } }
const urlPlayer = (b: string, u: string, p: string, extra = "") => `${b}/player_api.php?username=${encodeURIComponent(u)}&password=${encodeURIComponent(p)}${extra}`;
async function dnsAtivas(): Promise<{ id: string; b: string }[]> {
  try {
    const r = await fetch(`${SB()}/rest/v1/dns?ativo=eq.true&select=id,host,protocolo,porta&order=prioridade`, { headers: sbh(), signal: AbortSignal.timeout(4000) });
    const l = await r.json();
    return Array.isArray(l) ? l.map((d) => ({ id: d.id as string, b: `${d.protocolo}://${d.host}${d.porta ? ":" + d.porta : ""}` })) : [];
  } catch { return []; }
}

// ---------- painel: DNS por usuário, acessos, bloqueio e personalização (tudo vem do banco) ----------
const SB = () => Deno.env.get("SUPABASE_URL") ?? "";
const SBK = () => Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const sbh = () => ({ apikey: SBK(), authorization: `Bearer ${SBK()}`, "content-type": "application/json" });
const TTL = 30_000;
const _base = new Map<string, { t: number; b: string }>();
async function baseDoDns(id: string | null): Promise<string | null> {
  if (!id) return null;
  const c = _base.get(id);
  if (c && Date.now() - c.t < TTL) return c.b;
  try {
    const r = await fetch(`${SB()}/rest/v1/dns?id=eq.${id}&select=host,protocolo,porta&limit=1`, { headers: sbh(), signal: AbortSignal.timeout(4000) });
    const j = await r.json();
    if (!Array.isArray(j) || !j[0]) return null;
    const b = `${j[0].protocolo}://${j[0].host}${j[0].porta ? ":" + j[0].porta : ""}`;
    _base.set(id, { t: Date.now(), b });
    return b;
  } catch { return null; }
}
const _usr = new Map<string, { t: number; b: string; bloq: boolean }>();
// DNS e bloqueio de um usuário. Quem ainda não existe usa a DNS principal do primeiro servidor.
async function infoUsuario(u: string): Promise<{ b: string; bloq: boolean }> {
  const c = _usr.get(u);
  if (c && Date.now() - c.t < TTL) return c;
  let b: string | null = null, bloq = false;
  try {
    const r = await fetch(`${SB()}/rest/v1/usuarios_app?usuario=eq.${encodeURIComponent(u)}&select=dns_id,bloqueado&limit=1`, { headers: sbh(), signal: AbortSignal.timeout(4000) });
    const j = await r.json();
    if (Array.isArray(j) && j[0]) { bloq = !!j[0].bloqueado; b = await baseDoDns(j[0].dns_id); }
    if (!b) {
      const g = await fetch(`${SB()}/rest/v1/grupos?dns_ativa_id=not.is.null&select=dns_ativa_id&order=criado&limit=1`, { headers: sbh(), signal: AbortSignal.timeout(4000) });
      const gj = await g.json();
      if (Array.isArray(gj) && gj[0]) b = await baseDoDns(gj[0].dns_ativa_id);
    }
  } catch { /* usa a reserva */ }
  const o = { t: Date.now(), b: b ?? BASE_PROV, bloq };
  _usr.set(u, o);
  return o;
}
let _ctx = { ip: "", ua: "" };
async function registrarAcesso(u: string, aparelho: string | null, evento: "login" | "sessao", metodo: string | null = null, mac: string | null = null) {
  const base = { p_usuario: u, p_aparelho: aparelho, p_evento: evento, p_ip: _ctx.ip || null, p_ua: _ctx.ua || null };
  const chamar = (corpo: Record<string, unknown>) => fetch(`${SB()}/rest/v1/rpc/registrar_acesso`, { method: "POST", headers: sbh(), body: JSON.stringify(corpo), signal: AbortSignal.timeout(4000) });
  try {
    let r = await chamar({ ...base, p_metodo: metodo, p_mac: mac });
    if (!r.ok) r = await chamar(base); // banco ainda sem as colunas de método: registra como antes
    _usr.delete(u);
  } catch { /* o painel não pode derrubar o app */ }
}
// ---------- TVs: MAC gerado para o aparelho e cadastro feito no painel ----------
type Tv = { mac: string; usuario: string | null; senha_enc: string | null; dns_id: string | null; bloqueado: boolean; atualizado: string };
async function tvDoAparelho(d: string | null): Promise<Tv | null> {
  if (!d) return null;
  try {
    const r = await fetch(`${SB()}/rest/v1/rpc/tv_do_aparelho`, { method: "POST", headers: sbh(), body: JSON.stringify({ p_aparelho: d }), signal: AbortSignal.timeout(5000) });
    const j = await r.json();
    return Array.isArray(j) && j[0] ? (j[0] as Tv) : null;
  } catch { return null; }
}
let _kt: CryptoKey | null = null;
async function senhaDaTv(enc: string): Promise<string | null> {
  try {
    if (!_kt) _kt = await crypto.subtle.importKey("raw", await crypto.subtle.digest("SHA-256", new TextEncoder().encode("tv-senha:" + SBK())), "AES-GCM", false, ["decrypt"]);
    const raw = Uint8Array.from(atob(enc.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
    return new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: raw.slice(0, 12) }, _kt, raw.slice(12)));
  } catch { return null; }
}
async function fixarDnsDoUsuario(u: string, dnsId: string | null) {
  if (!dnsId) return;
  try {
    await fetch(`${SB()}/rest/v1/usuarios_app?usuario=eq.${encodeURIComponent(u)}`, { method: "PATCH", headers: sbh(), body: JSON.stringify({ dns_id: dnsId }), signal: AbortSignal.timeout(4000) });
    _usr.delete(u);
  } catch { /* segue com a DNS atual */ }
}
const rgba = (hex: string, a: number) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex ?? ""); if (!m) return null;
  const n = parseInt(m[1], 16); return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
};
let _cfgT = 0;
async function carregarConfig() {
  if (Date.now() - _cfgT < 60_000) return;
  _cfgT = Date.now();
  try {
    const r = await fetch(`${SB()}/rest/v1/config_app?owner_id=is.null&select=logo_url,fundo_url,cor_tv,cor_filmes,cor_series,cor_vidro,cor_destaque,extra,tema_app&limit=1`, { headers: sbh(), signal: AbortSignal.timeout(4000) });
    const j = await r.json(); const c = Array.isArray(j) ? j[0] : null; if (!c) return;
    if (c.logo_url && /^https:\/\//.test(c.logo_url)) LOGO = c.logo_url;
    FUNDO_CFG = c.fundo_url && /^https:\/\//.test(c.fundo_url) ? c.fundo_url : "";
    TEMA_PAINEL = c.tema_app === "onix" ? "onix" : c.tema_app === "moderno" ? "moderno" : "classico";
    _cfgCores = c;
    usarTema(TEMA_PAINEL);
    CONTATO = String(c.extra?.contato ?? "").replace(/[{}]/g, "").trim().slice(0, 60);
    const dias = Number(c.extra?.aviso_dias); AVISO_DIAS = Number.isFinite(dias) && dias >= 0 && dias <= 60 ? Math.round(dias) : 5;
  } catch { /* mantém o que já estava */ }
}

// ---------- token (AES-GCM), chave derivada de um segredo que o próprio Supabase injeta ----------
const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64 = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

let _chave: CryptoKey | null = null;
async function chave() {
  if (_chave) return _chave;
  const seg = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SUPABASE_URL") ?? "";
  if (!seg) throw new Error("sem segredo de servidor");
  const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("mira-token:" + seg));
  _chave = await crypto.subtle.importKey("raw", h, "AES-GCM", false, ["encrypt", "decrypt"]);
  return _chave;
}
// r = sessão que precisa do relay pela TV; pv = login ainda não conferido (a TV confere na primeira tela)
async function criarToken(u: string, p: string, v?: number, pv = false, pf = "", manterRelay = false) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const r = manterRelay || (RC()?.rel.size ?? 0) > 0 ? 1 : 0;
  const dados = new TextEncoder().encode(JSON.stringify({ u, p, v, e: Date.now() + VALIDADE_MS, ...(r ? { r } : {}), ...(pv ? { pv: 1 } : {}), ...(pf ? { pf } : {}) }));
  const c = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await chave(), dados));
  const t = new Uint8Array(iv.length + c.length);
  t.set(iv); t.set(c, iv.length);
  return b64(t);
}
type Cred = { u: string; p: string; b?: string; bloq?: boolean; v?: number; r?: boolean; pv?: boolean; pf?: string };
// dono dos favoritos/histórico: o perfil principal usa o próprio usuário; os outros, "usuário#perfil"
const quem = (c: { u: string; pf?: string }) => (c.pf && c.pf !== "p0" ? `${c.u}#${c.pf}` : c.u);
async function lerToken(t: string | null): Promise<Cred | null> {
  if (!t) return null;
  try {
    const raw = unb64(t);
    const d = await crypto.subtle.decrypt({ name: "AES-GCM", iv: raw.slice(0, 12) }, await chave(), raw.slice(12));
    const o = JSON.parse(new TextDecoder().decode(d));
    if (!(o.e > Date.now())) return null;
    const x = await infoUsuario(o.u);
    const cx = RC(); if (cx && o.r) cx.relay = true;
    return { u: o.u, p: o.p, v: o.v, b: x.b, bloq: x.bloq, r: !!o.r, pv: !!o.pv, pf: typeof o.pf === "string" ? o.pf : "" };
  } catch {
    return null;
  }
}

// ---------- provedor ----------
const _apiCache = new Map<string, { em: number; v: unknown }>();
const CACHEAVEL = /action=get_(live|vod|series)_(streams|categories)|action=get_series(&|$)/;
async function api(cred: Cred, extra = "") {
  const url = urlPlayer(cred.b ?? BASE_PROV, cred.u, cred.p, extra);
  // listas e categorias ficam guardadas 10 min: trocar de página ou voltar não busca de novo
  const guardado = CACHEAVEL.test(extra) ? _apiCache.get(url) : undefined;
  if (guardado && Date.now() - guardado.em < 10 * 60_000) return guardado.v;
  const v = await apiBuscar(cred, url);
  if (CACHEAVEL.test(extra) && v) { if (_apiCache.size > 80) _apiCache.clear(); _apiCache.set(url, { em: Date.now(), v }); }
  return v;
}
async function apiBuscar(cred: Cred, url: string) {
  const c = RC();
  if (c?.rel.has(url)) { // a TV já buscou este endereço
    const tx = c.rel.get(url);
    if (tx === null || tx === undefined) throw new Error("provedor indisponível");
    try { return JSON.parse(tx); } catch { return null; }
  }
  if (c?.cap && cred.r) { c.need.add(url); throw new RelayNeed(); } // sessão que só funciona pela TV
  let txt: string;
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(20000), headers: { "user-agent": "Mozilla/5.0" } });
    if (!r.ok) throw new Error("provedor respondeu " + r.status);
    txt = await r.text();
  } catch (e) { c?.need.add(url); throw e; } // o servidor não alcança: a TV pode tentar
  try { return JSON.parse(txt); } catch { return null; } // provedor devolve vazio/HTML com login inválido
}
// Confere usuário e senha. Tenta a DNS do usuário (ou a principal); se falhar, testa as outras DNS ativas
// e devolve a que aceitou (dnsId), para o login ficar fixado nela.
async function autenticar(u: string, p: string, baseInicial: string): Promise<{ ok: boolean; info?: any; b: string; dnsId?: string; erroProv?: boolean }> {
  const valido = (i: any) => !!i?.user_info && Number(i.user_info.auth) === 1;
  let erroProv = false;
  try {
    const i = await api({ u, p, b: baseInicial });
    if (valido(i)) return { ok: true, info: i, b: baseInicial };
  } catch { erroProv = true; }
  try {
    const r = await fetch(`${SB()}/rest/v1/dns?ativo=eq.true&select=id,host,protocolo,porta&order=prioridade`, { headers: sbh(), signal: AbortSignal.timeout(4000) });
    const lista = await r.json();
    if (Array.isArray(lista)) {
      const outras = lista
        .map((d) => ({ id: d.id as string, b: `${d.protocolo}://${d.host}${d.porta ? ":" + d.porta : ""}` }))
        .filter((d) => d.b !== baseInicial);
      const tent = await Promise.all(outras.map(async (d) => {
        try {
          const i = await Promise.race([api({ u, p, b: d.b }), new Promise<null>((res) => setTimeout(() => res(null), 8000))]);
          return valido(i) ? { info: i, b: d.b, dnsId: d.id } : null;
        } catch { return null; }
      }));
      const achou = tent.find((t) => t);
      if (achou) return { ok: true, info: achou.info, b: achou.b, dnsId: achou.dnsId };
    }
  } catch { /* sem alternativas */ }
  return { ok: false, b: baseInicial, erroProv };
}
// Login aceito sem conferência (o servidor não alcança o provedor): a TV confere em todas as DNS ativas,
// o servidor escolhe a que aceitou, fixa para o usuário e troca o token. Devolve null se nenhuma aceitou.
async function resolverPv(cred: Cred, d: string | null, t: string): Promise<{ cred: Cred; t: string } | null> {
  const c = RC();
  if (!cred.pv || !c?.cap) return { cred, t };
  const lista = await dnsAtivas();
  const bases = [...new Set([cred.b ?? BASE_PROV, ...lista.map((x) => x.b)])];
  const faltam = bases.map((b) => urlPlayer(b, cred.u, cred.p)).filter((x) => !c.rel.has(x));
  if (faltam.length) { faltam.forEach((x) => c.need.add(x)); throw new RelayNeed(); }
  for (const b of bases) {
    const tx = c.rel.get(urlPlayer(b, cred.u, cred.p));
    let j: any = null; try { j = tx ? JSON.parse(tx) : null; } catch { /* não é JSON */ }
    if (j?.user_info && Number(j.user_info.auth) === 1) {
      const id = lista.find((x) => x.b === b)?.id ?? null;
      await fixarDnsDoUsuario(cred.u, id);
      c.relay = true;
      const novo = await criarToken(cred.u, cred.p);
      const dev = d ?? (await aparelhoDoToken(t));
      if (dev) await salvarSessao(dev, novo);
      return { cred: { ...cred, b, r: true, pv: false }, t: novo };
    }
  }
  const dev = d ?? (await aparelhoDoToken(t));
  if (dev) await apagarSessao(dev);
  return null;
}
const urlFluxo = (tipo: string, c: Cred, id: string | number, ext?: string) =>
  `${c.b ?? BASE_PROV}/${tipo}/${encodeURIComponent(c.u)}/${encodeURIComponent(c.p)}/${id}${ext ? "." + ext : ""}`;

// ---------- telas do MSX ----------
// ---------- sessão guardada por aparelho (tabela "sessoes", só o servidor acessa) ----------
const REST = () => `${Deno.env.get("SUPABASE_URL")}/rest/v1/sessoes`;
const cab = () => {
  const k = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  return { apikey: k, authorization: `Bearer ${k}`, "content-type": "application/json" };
};
const idOk = (d: string | null) => (d && /^[\w.:-]{6,80}$/.test(d) ? d : null);
async function lerSessao(d: string | null) {
  if (!d) return null;
  try {
    const r = await fetch(`${REST()}?aparelho=eq.${encodeURIComponent(d)}&select=token`, { headers: cab(), signal: AbortSignal.timeout(8000) });
    const j = await r.json();
    return Array.isArray(j) && j[0] ? (j[0].token as string) : null;
  } catch { return null; }
}
async function salvarSessao(d: string | null, token: string) {
  if (!d) return;
  try {
    await fetch(`${REST()}?on_conflict=aparelho`, {
      method: "POST",
      headers: { ...cab(), prefer: "resolution=merge-duplicates" },
      body: JSON.stringify({ aparelho: d, token, atualizado: new Date().toISOString() }),
      signal: AbortSignal.timeout(8000),
    });
  } catch { /* sem sessão guardada: só pede login de novo */ }
}
async function apagarSessao(d: string | null) {
  if (!d) return;
  try { await fetch(`${REST()}?aparelho=eq.${encodeURIComponent(d)}`, { method: "DELETE", headers: cab(), signal: AbortSignal.timeout(8000) }); } catch { /* ignora */ }
}

// ---------- contas salvas por TV (entrar com um toque) ----------
const REST_CTA = () => `${Deno.env.get("SUPABASE_URL")}/rest/v1/contas_salvas`;
async function cifrar(s: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const c = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await chave(), new TextEncoder().encode(s)));
  const t = new Uint8Array(iv.length + c.length); t.set(iv); t.set(c, iv.length);
  return b64(t);
}
async function decifrar(s: string): Promise<string | null> {
  try {
    const raw = unb64(s);
    return new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: raw.slice(0, 12) }, await chave(), raw.slice(12)));
  } catch { return null; }
}
async function lembrarConta(d: string | null, u: string, p: string) {
  if (!d || !u || !p) return;
  try {
    await fetch(`${REST_CTA()}?on_conflict=aparelho,usuario`, {
      method: "POST", headers: { ...cab(), prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify({ aparelho: d, usuario: u, senha_enc: await cifrar(p), ultimo_uso: new Date().toISOString() }), signal: AbortSignal.timeout(6000),
    });
  } catch { /* sem contas salvas: só não oferece o atalho */ }
}
async function contasDe(d: string | null): Promise<string[]> {
  if (!d) return [];
  try {
    const r = await fetch(`${REST_CTA()}?aparelho=eq.${encodeURIComponent(d)}&select=usuario&order=ultimo_uso.desc&limit=12`, { headers: cab(), signal: AbortSignal.timeout(4000) });
    const j = await r.json();
    return Array.isArray(j) ? j.map((x: { usuario: string }) => x.usuario) : [];
  } catch { return []; }
}
async function senhaSalva(d: string | null, u: string): Promise<string | null> {
  if (!d || !u) return null;
  try {
    const r = await fetch(`${REST_CTA()}?aparelho=eq.${encodeURIComponent(d)}&usuario=eq.${encodeURIComponent(u)}&select=senha_enc&limit=1`, { headers: cab(), signal: AbortSignal.timeout(4000) });
    const j = await r.json();
    return Array.isArray(j) && j[0] ? await decifrar(j[0].senha_enc) : null;
  } catch { return null; }
}
async function esquecerConta(d: string | null, u: string) {
  if (!d || !u) return;
  try { await fetch(`${REST_CTA()}?aparelho=eq.${encodeURIComponent(d)}&usuario=eq.${encodeURIComponent(u)}`, { method: "DELETE", headers: cab(), signal: AbortSignal.timeout(6000) }); } catch { /* ignora */ }
}

// ---------- pareamento pelo celular (código de 6 letras/números, vale 24 h) ----------
const REST_COD = () => `${Deno.env.get("SUPABASE_URL")}/rest/v1/pareamentos`;
const VALIDADE_COD_MS = 24 * 3600 * 1000;
const ALFABETO = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function novoCodigo() {
  const b = crypto.getRandomValues(new Uint8Array(6));
  return Array.from(b, (x) => ALFABETO[x % ALFABETO.length]).join("");
}
async function codigoDoAparelho(d: string | null): Promise<string | null> {
  if (!d) return null;
  try {
    const r = await fetch(`${REST_COD()}?aparelho=eq.${encodeURIComponent(d)}&select=codigo,criado&order=criado.desc&limit=1`, { headers: cab(), signal: AbortSignal.timeout(8000) });
    const j = await r.json();
    if (Array.isArray(j) && j[0] && Date.now() - new Date(j[0].criado).getTime() < VALIDADE_COD_MS - 60000) return j[0].codigo as string;
    await fetch(`${REST_COD()}?aparelho=eq.${encodeURIComponent(d)}`, { method: "DELETE", headers: cab(), signal: AbortSignal.timeout(8000) });
    const codigo = novoCodigo();
    const ins = await fetch(REST_COD(), { method: "POST", headers: cab(), body: JSON.stringify({ codigo, aparelho: d }), signal: AbortSignal.timeout(8000) });
    return ins.ok ? codigo : null;
  } catch { return null; }
}
async function aparelhoDoCodigo(codigo: string): Promise<string | null> {
  try {
    const r = await fetch(`${REST_COD()}?codigo=eq.${encodeURIComponent(codigo)}&select=aparelho,criado&limit=1`, { headers: cab(), signal: AbortSignal.timeout(8000) });
    const j = await r.json();
    if (!Array.isArray(j) || !j[0]) return null;
    if (Date.now() - new Date(j[0].criado).getTime() > VALIDADE_COD_MS) return null;
    return j[0].aparelho as string;
  } catch { return null; }
}
async function apagarCodigo(codigo: string) {
  try { await fetch(`${REST_COD()}?codigo=eq.${encodeURIComponent(codigo)}`, { method: "DELETE", headers: cab(), signal: AbortSignal.timeout(8000) }); } catch { /* ignora */ }
}
// ---------- favoritos (por usuário do provedor) ----------
const REST_FAV = () => `${Deno.env.get("SUPABASE_URL")}/rest/v1/favoritos`;
type Fav = { stream_id: string; name: string; stream_icon?: string };
async function favoritosDe(u: string): Promise<Fav[]> {
  try {
    const r = await fetch(`${REST_FAV()}?usuario=eq.${encodeURIComponent(u)}&select=stream_id,nome,icone&order=criado.desc&limit=400`, { headers: cab(), signal: AbortSignal.timeout(6000) });
    const j = await r.json();
    return Array.isArray(j) ? j.map((x: any) => ({ stream_id: String(x.stream_id), name: String(x.nome), stream_icon: x.icone || undefined })).filter((x) => !x.stream_id.includes(":")) : [];
  } catch { return []; }
}
// filmes ("v") e séries ("s") favoritos, guardados como "v:id" / "s:id"
async function favoritosVod(u: string, p: "v" | "s"): Promise<Fav[]> {
  try {
    const r = await fetch(`${REST_FAV()}?usuario=eq.${encodeURIComponent(u)}&stream_id=like.${p}:*&select=stream_id,nome,icone&order=criado.desc&limit=400`, { headers: cab(), signal: AbortSignal.timeout(6000) });
    const j = await r.json();
    return Array.isArray(j) ? j.map((x: any) => ({ stream_id: String(x.stream_id).slice(2), name: String(x.nome), stream_icon: x.icone || undefined })) : [];
  } catch { return []; }
}
// liga/desliga o favorito; devolve true se agora é favorito
async function alternarFavorito(u: string, id: string, nome: string, icone: string): Promise<boolean> {
  try {
    const ja = (await favoritosDe(u)).some((f) => f.stream_id === id);
    if (ja) {
      await fetch(`${REST_FAV()}?usuario=eq.${encodeURIComponent(u)}&stream_id=eq.${encodeURIComponent(id)}`, { method: "DELETE", headers: cab(), signal: AbortSignal.timeout(6000) });
      return false;
    }
    await fetch(`${REST_FAV()}?on_conflict=usuario,stream_id`, { method: "POST", headers: { ...cab(), prefer: "resolution=merge-duplicates" }, body: JSON.stringify({ usuario: u, stream_id: id, nome: nome.slice(0, 120), icone: icone.slice(0, 400) }), signal: AbortSignal.timeout(6000) });
    return true;
  } catch { return false; }
}
// ---------- vencimento do plano (vem do provedor no login; a tela inicial avisa quando está perto) ----------
async function salvarVence(u: string, info: any) {
  const exp = Number(info?.user_info?.exp_date);
  if (!u || !Number.isFinite(exp) || exp <= 0) return;
  try {
    await fetch(`${SB()}/rest/v1/usuarios_app?usuario=eq.${encodeURIComponent(u)}`, { method: "PATCH", headers: sbh(), body: JSON.stringify({ vence: new Date(exp * 1000).toISOString() }), signal: AbortSignal.timeout(4000) });
  } catch { /* sem aviso de vencimento */ }
}
async function venceDe(u: string): Promise<number | null> {
  try {
    const r = await fetch(`${SB()}/rest/v1/usuarios_app?usuario=eq.${encodeURIComponent(u)}&select=vence&limit=1`, { headers: sbh(), signal: AbortSignal.timeout(4000) });
    const j = await r.json();
    const v = Array.isArray(j) && j[0]?.vence ? Date.parse(j[0].vence) : NaN;
    return Number.isFinite(v) ? v : null;
  } catch { return null; }
}

// ---------- histórico: o player avisa o que tocou (Continuar assistindo / Últimos canais) ----------
const REST_HIST = () => `${SB()}/rest/v1/historico`;
type Hist = { tipo: string; item_id: string; nome: string; icone: string; extra: any; pos: number; dur: number; atualizado: string };
async function historicoDe(u: string, tipos: string[], limite = 30): Promise<Hist[]> {
  try {
    const r = await fetch(`${REST_HIST()}?usuario=eq.${encodeURIComponent(u)}&tipo=in.(${tipos.join(",")})&select=tipo,item_id,nome,icone,extra,pos,dur,atualizado&order=atualizado.desc&limit=${limite}`, { headers: cab(), signal: AbortSignal.timeout(6000) });
    const j = await r.json();
    return Array.isArray(j) ? j : [];
  } catch { return []; }
}
// começou (30 s ou mais) e ainda não chegou perto do fim
const emAndamento = (h: Hist) => h.pos >= 30 && (!h.dur || h.pos < h.dur * 0.95);
async function gravarVisto(u: string, tipo: string, id: string, nome: string, icone: string, extra: unknown, pos: number, dur: number) {
  try {
    await fetch(`${REST_HIST()}?on_conflict=usuario,tipo,item_id`, {
      method: "POST", headers: { ...cab(), prefer: "resolution=merge-duplicates" },
      body: JSON.stringify({ usuario: u, tipo, item_id: id, nome, icone, extra, pos, dur, atualizado: new Date().toISOString() }),
      signal: AbortSignal.timeout(6000),
    });
  } catch { /* histórico é opcional */ }
}
const fmtTempo = (seg: number) => { const h = Math.floor(seg / 3600), m = Math.floor((seg % 3600) / 60); return h ? `${h}h${String(m).padStart(2, "0")}` : `${m} min`; };
// texto livre vindo do provedor (sinopse, elenco): o MSX interpreta {…}
const txtMsx = (v: unknown) => String(v ?? "").replace(/[{}]/g, "").replace(/\s+/g, " ").trim();

// o painel só conhece o token; o aparelho (para o botão Sair) é achado pela sessão guardada
async function aparelhoDoToken(t: string): Promise<string | null> {
  try {
    const r = await fetch(`${REST()}?token=eq.${encodeURIComponent(t)}&select=aparelho&limit=1`, { headers: cab(), signal: AbortSignal.timeout(6000) });
    const j = await r.json();
    return Array.isArray(j) && j[0] ? (j[0].aparelho as string) : null;
  } catch { return null; }
}
const PLUGIN = "https://mktdigital91.github.io/msx/msx/mira.html";
const PAGINA_CELULAR = "https://mktdigital91.github.io/msx/entrar/";

const normMac = (v: unknown) => { const h = String(v ?? "").toUpperCase().replace(/[^0-9A-F]/g, ""); return h.length === 10 ? h.replace(/(..)(?=.)/g, "$1:") : ""; };
async function tvPorMac(mac: string): Promise<{ aparelho: string; bloqueado: boolean } | null> {
  try {
    const r = await fetch(`${SB()}/rest/v1/tvs?mac=eq.${encodeURIComponent(mac)}&select=aparelho,bloqueado&limit=1`, { headers: sbh(), signal: AbortSignal.timeout(5000) });
    const j = await r.json();
    return Array.isArray(j) && j[0] ? { aparelho: j[0].aparelho as string, bloqueado: !!j[0].bloqueado } : null;
  } catch { return null; }
}

// Chamado pela página do celular: confere o código, valida usuário e senha e liga a sessão à TV.
async function parear(corpo: { c?: string; m?: string; u?: string; p?: string }) {
  const u = String(corpo.u ?? "").trim();
  const p = String(corpo.p ?? "");
  const porMac = corpo.m !== undefined && corpo.m !== null && String(corpo.m) !== "";
  let aparelho: string | null = null, codigo = "", mac = "";
  if (porMac) {
    mac = normMac(corpo.m);
    if (!mac) return { ok: false, erro: "mac" };
  } else {
    codigo = String(corpo.c ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (codigo.length !== 6) return { ok: false, erro: "codigo" };
  }
  if (!u || !p) return { ok: false, erro: "campos" };
  if (porMac) {
    const tv = await tvPorMac(mac);
    if (!tv) return { ok: false, erro: "mac" };
    if (tv.bloqueado) return { ok: false, erro: "bloqueado" };
    aparelho = tv.aparelho;
  } else {
    aparelho = await aparelhoDoCodigo(codigo);
    if (!aparelho) return { ok: false, erro: "codigo" };
  }
  let info;
  const x = await infoUsuario(u);
  if (x.bloq) return { ok: false, erro: "bloqueado" };
  const au = await autenticar(u, p, x.b);
  // algum servidor não respondeu ao nosso servidor: aceita agora e a TV confere na primeira tela
  const provisorio = !au.ok && (RC()?.need.size ?? 0) > 0;
  if (!au.ok && !provisorio) return { ok: false, erro: au.erroProv ? "provedor" : "credenciais" };
  info = au.info;
  await registrarAcesso(u, aparelho, "login", porMac ? "mac" : "codigo", porMac ? mac : null);
  await salvarVence(u, info);
  if (au.dnsId) await fixarDnsDoUsuario(u, au.dnsId);
  await salvarSessao(aparelho, await criarToken(u, p, undefined, provisorio));
  if (!provisorio) await lembrarConta(aparelho, u, p);
  if (!porMac) await apagarCodigo(codigo);
  return { ok: true, usuario: u };
}

// ---------- cartões desenhados pelo servidor (imagem SVG com gradiente, ícone e nome) ----------
const ICONES: Record<string, string> = {
  play: "M8 5v14l11-7z",
  star: "M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z",
  heart: "M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z",
  bolt: "M7 2v11h3v9l7-12h-4l4-8z",
  mood: "M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm3.5-9c.83 0 1.5-.67 1.5-1.5S16.33 8 15.5 8 14 8.67 14 9.5s.67 1.5 1.5 1.5zm-7 0c.83 0 1.5-.67 1.5-1.5S9.33 8 8.5 8 7 8.67 7 9.5 7.67 11 8.5 11zm3.5 6.5c2.33 0 4.31-1.46 5.11-3.5H6.89c.8 2.04 2.78 3.5 5.11 3.5z",
  eye: "M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z",
  search: "M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z",
  explore: "M12 10.9c-.61 0-1.1.49-1.1 1.1s.49 1.1 1.1 1.1c.61 0 1.1-.49 1.1-1.1s-.49-1.1-1.1-1.1zM12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm2.19 12.19L6 18l3.81-8.19L18 6l-3.81 8.19z",
  family: "M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z",
  live: "M21 6h-7.59l3.29-3.29L16 2l-4 4-4-4-.71.71L10.59 6H3c-1.1 0-2 .89-2 2v12c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2V8c0-1.11-.9-2-2-2zm0 14H3V8h18v12zM9 10v8l7-4z",
  movie: "M18 4l2 4h-3l-2-4h-2l2 4h-3l-2-4H8l2 4H7L5 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V4h-4z",
  series: "M4 6H2v14c0 1.1.9 2 2 2h14v-2H4V6zm16-4H8c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-8 12.5v-9l6 4.5-6 4.5z",
  apps: "M4 8h4V4H4v4zm6 12h4v-4h-4v4zm-6 0h4v-4H4v4zm0-6h4v-4H4v4zm6 0h4v-4h-4v4zm6-10v4h4V4h-4zm-6 4h4V4h-4v4zm6 6h4v-4h-4v4zm0 6h4v-4h-4v4z",
  next: "M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z",
  prev: "M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z",
  settings: "M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z",
  refresh: "M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z",
  logout: "M17 7l-1.41 1.41L18.17 11H8v2h10.17l-2.58 2.58L17 17l5-5zM4 5h8V3H4c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h8v-2H4V5z",
};
// cartões desenhados (capas sem imagem): no Ônix, tons escuros com dourado
const PALETAS_ONIX: Record<string, string[][]> = {
  live: [["#2A2418", "#0E0D10"], ["#1F1B14", "#0B0B0D"]], vod: [["#2E2016", "#0E0C0D"], ["#251A14", "#0B0A0C"]],
  nav: [["#3A2E18", "#14110C"]], series: [["#26241E", "#0D0D0F"], ["#1F1E1A", "#0B0B0C"]],
};
const PALETAS: Record<string, string[][]> = {
  live: [["#7C5CFF", "#3B82F6"], ["#6D4AFF", "#22D3EE"], ["#8B5CF6", "#EC4899"], ["#4F46E5", "#06B6D4"]],
  vod: [["#F43F8E", "#F59E0B"], ["#EF4444", "#F97316"], ["#EC4899", "#8B5CF6"], ["#E11D48", "#FB923C"]],
  nav: [["#F59E0B", "#F43F5E"]],
  series: [["#22D3EE", "#10B981"], ["#06B6D4", "#6366F1"], ["#14B8A6", "#3B82F6"], ["#0EA5E9", "#34D399"]],
};
const semAcento = (t: string) => t.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
function limparNome(t: string) {
  return String(t ?? "").replace(/[^\p{L}\p{N}\s&'+\-.\/:,!?()]/gu, " ").replace(/\s+/g, " ").trim();
}
function iconeDoNome(nome: string, padrao: string) {
  const n = semAcento(nome);
  const tab: [RegExp, string][] = [
    [/acao|action|luta|guerra/, "bolt"], [/comedia|humor|stand/, "mood"], [/drama|romance|novela/, "heart"],
    [/terror|horror|suspense|thriller|misterio/, "eye"], [/crime|policial|investig|document/, "search"],
    [/aventura|viagem|faroeste|western/, "explore"], [/familia|infantil|animacao|kids|desenho|crianc|anime/, "family"],
    [/ficcao|fantasia|sci|lancamento|top |4k|uhd|cinema|oscar|destaque/, "star"], [/esporte|futebol|sport|ufc|nba|tnt|espn|premiere/, "live"],
  ];
  for (const [re, ic] of tab) if (re.test(n)) return ic;
  return padrao;
}
const xml = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
function quebrar(t: string, max = 15, linhas = 3) {
  const out: string[] = [];
  let atual = "";
  for (const w of t.split(" ")) {
    if ((atual + " " + w).trim().length <= max) atual = (atual + " " + w).trim();
    else { if (atual) out.push(atual); atual = w.length > max ? w.slice(0, max - 1) + "…" : w; }
  }
  if (atual) out.push(atual);
  if (out.length > linhas) { out.length = linhas; out[linhas - 1] = out[linhas - 1].replace(/.?$/, "…"); }
  return out;
}
function cartaoSvg(k: string, titulo: string, sub: string, icone: string, retrato = false) {
  const nome = limparNome(titulo).slice(0, 70) || "Sem nome";
  let h = 0; for (const ch of nome) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const tab = TEMA === "onix" ? PALETAS_ONIX : PALETAS;
  const pal = tab[k] ?? tab.live;
  const [c1, c2] = pal[h % pal.length];
  const ic = ICONES[icone] ?? ICONES.play;
  const W = retrato ? 480 : 640, H = retrato ? 720 : 480;
  const ls = quebrar(nome, retrato ? 11 : 15, retrato ? 4 : 3);
  const fs = retrato ? 46 : ls.length >= 3 ? 44 : 52, lh = fs + 8;
  const base = sub ? H - 76 : H - 42;
  const y0 = base - (ls.length - 1) * lh;
  const textos = ls.map((l, n) => `<text x="40" y="${y0 + n * lh}" font-size="${fs}" font-weight="800" fill="#fff" font-family="Arial, Helvetica, sans-serif">${xml(l)}</text>`).join("");
  const subt = sub ? `<text x="42" y="${base + 40}" font-size="28" font-weight="600" fill="#fff" fill-opacity=".82" font-family="Arial, Helvetica, sans-serif">${xml(limparNome(sub).slice(0, 34))}</text>` : "";
  const gx = retrato ? 110 : 340, gy = retrato ? 190 : 150;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" overflow="hidden"><defs><clipPath id="c"><rect width="${W}" height="${H}"/></clipPath><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient></defs><g clip-path="url(#c)"><rect width="${W}" height="${H}" fill="url(#g)"/><circle cx="${W - 70}" cy="50" r="190" fill="#fff" fill-opacity=".12"/><circle cx="30" cy="${H}" r="170" fill="#000" fill-opacity=".15"/><g transform="translate(${gx} ${gy}) scale(11)" fill="#fff" fill-opacity=".17"><path d="${ic}"/></g><rect x="40" y="40" width="88" height="88" rx="26" fill="#fff" fill-opacity=".22"/><g transform="translate(60 60) scale(2)" fill="#fff"><path d="${ic}"/></g>${textos}${subt}</g></svg>`;
}
// URL da imagem de um cartão
const cartao = (k: string, t: string, s = "", i = "play", retrato = false) => `${Deno.env.get("SUPABASE_URL")}/functions/v1/mira?${new URLSearchParams({ a: "img", k, t: limparNome(t).slice(0, 70), s, i, ...(retrato ? { f: "p" } : {}), ...(TEMA !== "classico" ? { th: TEMA } : {}) }).toString()}`;

// botões de vidro retos: só cor do MSX (sem imagem), mais leve e sem cantos aparecendo atrás
const VID_CLASSICO = { n: "rgba(10,12,28,0.62)", ouro: "rgba(245,180,0,0.32)", voltar: "rgba(6,7,14,0.88)" };
const VID_ONIX = { n: "rgba(18,17,21,0.72)", ouro: "rgba(214,178,94,0.30)", voltar: "rgba(8,8,10,0.92)" };
const VID_MODERNO = { n: "rgba(10,17,40,0.80)", ouro: "rgba(59,130,246,0.35)", voltar: "rgba(4,8,22,0.92)" };
const VID = { ...VID_CLASSICO };

const SELF = () => `${Deno.env.get("SUPABASE_URL")}/functions/v1/mira`;
const q = (o: Record<string, string | number>) =>
  Object.entries(o).map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join("&");
// sessão em relay: os botões passam pelo plugin da TV (que busca no provedor); as demais abrem direto
const go = (o: Record<string, string | number>) => RC()?.cap && RC()?.relay
  ? `content:request:interaction:${q({ ...o, rl: 1 })}@${PLUGIN}`
  : `content:${SELF()}?${q(o)}`;
// o mesmo para painéis do player (panel:): em relay passam pelo plugin da TV
const pn = (o: Record<string, string | number>) => RC()?.cap && RC()?.relay
  ? `panel:request:interaction:${q({ ...o, rl: 1 })}@${PLUGIN}`
  : `panel:${SELF()}?${q(o)}`;
// endereço do vídeo passando pelo servidor: a TV (e qualquer mensagem de erro) não vê o DNS nem usuário/senha do provedor
const fluxo = (tipo: string, t: string, id: string | number, ext: string) => `${SELF()}/v/${tipo}/${t}/${encodeURIComponent(String(id))}.${ext.replace(/[^a-z0-9]/gi, "")}`;
// toca pelo player próprio (msx/player.html): erro em português e sem mostrar nenhum link; canais tentam .ts e depois .m3u8
const PLAYER = "https://mktdigital91.github.io/msx/msx/player.html";
// o player recebe o endereço direto do provedor (codificado, nunca exibido): sem passar pelo servidor, abre mais rápido
// reg: o player avisa o servidor o que está tocando (Continuar assistindo / Últimos canais)
type Reg = { t: string; tp: "live" | "filme" | "ep"; nome: string; icone?: string; extra?: Record<string, unknown> };
const tocar = (tipo: string, cred: { u: string; p: string }, id: string | number, ext: string, oque: string, reg?: Reg) => {
  const fontes = [urlFluxo(tipo, cred, id, ext), ...(tipo === "live" ? [urlFluxo(tipo, cred, id, "m3u8")] : [])].join("\n");
  const h = reg ? `${SELF()}?${q({ a: "visto", t: reg.t, tp: reg.tp, s: String(id), n: reg.nome.slice(0, 120), i: (reg.icone ?? "").slice(0, 400), x: JSON.stringify({ ext, ...(reg.extra ?? {}) }) })}` : "";
  return `video:plugin:${PLAYER}?${q({ f: b64(new TextEncoder().encode(fontes)), m: oque, usr: cred.u, c: (reg?.nome ?? `${tipo}:${id}`).slice(0, 60), tl: SELF(), ...(h ? { h: b64(new TextEncoder().encode(h)) } : {}) })}`;
};

// "Continuar de onde parou" (filmes e episódios): o próprio MSX guarda a posição na TV, por usuário
const retomar = (tipo: string, id: string | number, dono: string) => {
  const pf = dono.includes("#") ? dono.split("#")[1] + ":" : ""; // cada perfil tem a sua posição
  return { "resume:key": `gp:${pf}${tipo}:${id}`, "resume:context": `gp:${dono}` };
};

function inputAction(servico: string, titulo: string, dica: string) {
  // {INPUT} fica sem codificar: o plugin do MSX o substitui pelo que foi digitado
  return `content:request:interaction:${servico}|default|pt|${titulo}|||${dica}|@${INPUT}`;
}

const FUNDO: Record<string, string> = { live: "bg-tv.jpg", vod: "bg-filmes.jpg", series: "bg-series.jpg" };
// O MSX ignora o "background" da raiz nessas telas; então o fundo vira um item de tela cheia atrás dos blocos.
const camadaFundo = (img: string) => ({ type: "space", layout: "0,0,12,6", offset: "-1,-1,2,2", image: TEMA === "moderno" ? mt({ k: "bg" }) : FUNDO_CFG || im(img), imageFiller: "cover", enable: false });
// Monta uma lista como páginas (grade 12x6) para poder ter o fundo em cada página.
const ROLAGEM_VERTICAL = true; // listas rolam para baixo (false = páginas laterais, como antes)
function lista(headline: string, items: unknown[], layout = "0,0,4,1", extra: Record<string, unknown> = {}, extensao?: string, kind = "") {
  const [, , w, h] = layout.split(",").map(Number);
  if (ROLAGEM_VERTICAL) {
    return {
      type: "list", headline, extension: extensao, transparent: 2, ready: { action: "quiet" },
      background: TEMA === "moderno" ? mt({ k: "bg" }) : FUNDO_CFG || im(FUNDO[kind] ?? "bg-tv.jpg"),
      // o "background" da raiz não aparece; a camada "underlay" fica atrás de cada página da lista
      underlay: { items: [camadaFundo(FUNDO[kind] ?? "bg-tv.jpg")] },
      template: { type: "default", color: COR.vidro, ...extra, layout: `0,0,${w},${h}` },
      items,
    };
  }
  const cols = Math.max(1, Math.floor(12 / w)), rows = Math.max(1, Math.floor(6 / h)), porPg = cols * rows;
  const fundo = camadaFundo(FUNDO[kind] ?? "bg-tv.jpg");
  const pages: unknown[] = [];
  for (let i = 0; i < items.length || (i === 0 && !pages.length); i += porPg) {
    const fatia = (items as any[]).slice(i, i + porPg).map((it, j) => ({
      type: "default", color: COR.vidro, ...extra, ...it,
      layout: `${(j % cols) * w},${Math.floor(j / cols) * h},${w},${h}`,
    }));
    pages.push({ items: [fundo, ...fatia] });
    if (!items.length) break;
  }
  return { type: "pages", headline, extension: extensao, transparent: 2, ready: { action: "quiet" }, background: FUNDO_CFG || im(FUNDO[kind] ?? "bg-tv.jpg"), pages };
}
function aviso(titulo: string, msg: string, voltar?: unknown[]) {
  return lista(titulo, [{ title: msg, action: "[]" }, ...(voltar ?? [])], "0,0,12,1");
}
// Tela única de login: à esquerda o QR code / código para entrar pelo celular, à direita usuário e senha na TV.
function telaLogin(codigo: string | null, d: string | null, msg?: string, u = "", p = "", auto = false, mac = "", contas: string[] = []) {
  // usuários já usados nesta TV: um toque e entra (até 4 atalhos; com mais, o último abre a lista completa)
  const atalhos = (d ? (contas.length <= 4 ? contas : contas.slice(0, 3)) : []).map((n, i) => ({
    type: "default", layout: `${i * 3},4,3,1`, offset: "0.1,0.1,-0.2,-0.2", color: COR.vidro, titleHeader: "USUÁRIO SALVO", title: n, titleFooter: "Toque para entrar",
    truncation: "title", action: go({ a: "conta", u: n, d: d! }),
  }));
  if (d && contas.length > 4) atalhos.push({ type: "default", layout: "9,4,3,1", offset: "0.1,0.1,-0.2,-0.2", color: COR.vidro, titleHeader: "MAIS", title: `Ver todos (${contas.length})`, titleFooter: "Lista de usuários", truncation: "title", action: go({ a: "contas", d: d! }) } as any);
  const link = codigo ? `${PAGINA_CELULAR}?c=${codigo}` : PAGINA_CELULAR;
  const qr = `https://api.qrserver.com/v1/create-qr-code/?size=500x500&margin=2&data=${encodeURIComponent(link)}`;
  const base = (o: Record<string, string>) => (d ? { ...o, d } : o);
  const eu = u ? { u } : {};
  const ep = p ? { p } : {};
  const pronto = !!(u && p);
  return {
    type: "pages", transparent: 2, ready: { action: "quiet" }, background: FUNDO_CFG || im("bg-tv.jpg"),
    pages: [{ items: [
      camadaFundo("bg-tv.jpg"),
      { type: "space", layout: "4,0,4,1", offset: "0,-0.3,0,-0.15", image: LOGO, imageFiller: "fit" },
      { type: "space", layout: "0,0,12,1", offset: "0,0.6,0,-0.3", alignment: "center", centration: "text", text: msg ?? "Escaneie o QR code com o celular ou digite seu usuário e senha aqui na TV." },
      { id: "atualizar", type: "default", layout: "10,0,2,1", image: im("btn-atualizar.png"), imageFiller: "fit", color: "transparent", action: go(base({ a: "inicio", x: Date.now() })) },
      // ---- lado esquerdo: pelo celular ----
      { type: "space", layout: "0,1,3,3", offset: "0,0.4,0,-0.15", image: im("login-qr.png"), imageFiller: "cover" },
      { id: "qr", type: "default", layout: "0,1,3,3", offset: "0.15,0.57,-0.3,-0.45", color: "transparent", image: qr, imageFiller: "fit", action: "[]" },
      { type: "space", layout: "3,1,3,2", offset: "0,0.4,0,-0.15", image: im("login-codigo.png"), imageFiller: "cover" },
      { type: "default", layout: "3,1,3,2", offset: "0,0.25,0,-0.3", color: "transparent", titleHeader: "Código celular:", title: codigo ? codigo.split("").join(" ") : "indisponível", titleFooter: "Válido por: 24h", action: "[]" },
      { type: "space", layout: "3,3,3,1", offset: "-0.1,0.38,0.2,0.15", image: im("login-novo.png"), imageFiller: "fit" },
      { type: "default", layout: "3,3,3,1", offset: "-0.1,0.27,0.2,0.15", color: "transparent", alignment: "center", title: "Novo código", titleFooter: "Gerar outro QR code", action: go(d ? { a: "inicio", d, r: Date.now() } : { a: "inicio" }) },
      ...atalhos,
      { type: "space", layout: "0,5,6,1", text: `{col:msx-white-soft}Número do MAC: {col:msx-white}${mac || "indisponível"}` },
      // ---- divisória ----
      { type: "space", layout: "6,2,1,2", offset: "0,0.4,0,0", title: "ou", alignment: "center", centration: "title" },
      // ---- lado direito: usuário e senha na TV ----
      { type: "space", layout: "7,1,5,1", offset: "0,0.4,0,-0.1", image: im("login-campo.png"), imageFiller: "cover" },
      {
        id: "usuario", type: "default", layout: "7,1,5,1", offset: "0,0.4,0,-0.1", color: "transparent",
        titleHeader: "USUÁRIO", titleFooter: u || "Toque para digitar", focus: !u && !p,
        action: inputAction(`${SELF()}?${q(base({ a: "in", f: "u", ...ep }))}&v={INPUT}`, "Usuário", "Digite o usuário e confirme"),
      },
      { type: "space", layout: "7,2,5,1", offset: "0,0.4,0,-0.1", image: im("login-campo.png"), imageFiller: "cover" },
      {
        id: "senha", type: "default", layout: "7,2,5,1", offset: "0,0.4,0,-0.1", color: "transparent",
        titleHeader: "SENHA", titleFooter: p ? "••••••••" : "Toque para digitar",
        focus: !!u && !p, execute: auto && !!u && !p,
        action: inputAction(`${SELF()}?${q(base({ a: "in", f: "p", ...eu }))}&v={INPUT}`, "Senha", "Digite a senha e confirme"),
      },
      { type: "space", layout: "7,3,5,1", offset: "0.9,0.3,-1.8,0.1", image: im("login-entrar.png"), imageFiller: "fit" },
      {
        id: "entrar", type: "default", layout: "7,3,5,1", offset: "0.9,0.3,-1.8,0.1", color: "transparent", alignment: "center", centration: "title",
        title: "Entrar",
        focus: pronto, execute: auto && pronto,
        action: pronto ? go(base({ a: "login", u, p })) : "warn:Preencha o usuário e a senha",
      },
    ] }],
  };
}
async function telaCelular(codigo: string | null, d: string | null, msg?: string, tv?: Tv | null) {
  const mac = (tv ?? (await tvDoAparelho(d)))?.mac ?? "";
  return telaLogin(codigo, d, msg, "", "", false, mac, await contasDe(d));
}
async function telaEntrar(msg?: string, d?: string | null, u = "", p = "", auto = false) {
  const mac = (await tvDoAparelho(d ?? null))?.mac ?? "";
  return telaLogin(await codigoDoAparelho(d ?? null), d ?? null, msg, u, p, auto, mac, await contasDe(d ?? null));
}

async function paginar(
  titulo: string,
  todos: any[],
  pg: number,
  montar: (x: any) => unknown,
  proxima: (n: number) => string,
  layout: string,
  kind: string,
  ext?: string,
  voltar = { title: "‹   CATEGORIAS", titleFooter: "Voltar às categorias" },
  topo: unknown[] = [],
) {
  const ini = pg * POR_PAGINA;
  const itens = todos.slice(ini, ini + POR_PAGINA).map(montar) as any[];
  if (itens.length) itens[0] = { ...itens[0], focus: true }; // foco no 1º item, não no botão de categorias
  const total = Math.ceil(todos.length / POR_PAGINA);
  if (ini + POR_PAGINA < todos.length) {
    const prox = proxima(pg + 1).replace(/^content:/, "replace:content:pag:");
    itens.push({ title: "Carregando mais…", titleFooter: `${pg + 2} de ${total}`, color: VID.n, action: prox, selection: { action: prox } });
  }
  if (pg > 0) itens.unshift({ title: "Página anterior", titleFooter: `${pg} de ${total}`, color: VID.n, action: proxima(pg - 1) });
  if (!todos.length) itens.push({ title: "Nada encontrado", action: "[]" });
  // botão fixo no topo para voltar às categorias (volta para a tela anterior, sem recarregar)
  itens.unshift({ ...voltar, color: VID.voltar, action: "back" }, ...topo);
  return { ...(lista(titulo, itens, layout, {}, ext ?? `${todos.length} itens`, kind) as any), flag: "pag" };
}
const nota = (v: unknown) => { const n = Number(v); return n > 0 ? n.toFixed(1) : undefined; };

// ---------- EPG (programação) com cache curto em memória ----------
type Prog = { titulo: string; ini: number; fim: number };
const cacheEpg = new Map<string, { em: number; v: Prog[] }>();
const fmtHora = (ms: number) => new Date(ms).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Fortaleza" });
async function epgDe(cred: { u: string; p: string }, id: string): Promise<Prog[]> {
  const c = cacheEpg.get(id);
  if (c && Date.now() - c.em < 5 * 60 * 1000) return c.v;
  let v: Prog[] = [];
  try {
    const j = await api(cred, `&action=get_short_epg&stream_id=${encodeURIComponent(id)}&limit=4`);
    v = ((Array.isArray(j?.epg_listings) ? j.epg_listings : []) as any[])
      .map((p) => ({ titulo: b64txt(p.title).trim(), ini: Number(p.start_timestamp) * 1000, fim: Number(p.stop_timestamp) * 1000 }))
      .filter((p) => p.titulo && !/no\s*programm/i.test(p.titulo) && p.fim > Date.now())
      .sort((a, b) => a.ini - b.ini);
  } catch { /* sem guia */ }
  cacheEpg.set(id, { em: Date.now(), v });
  return v;
}
// busca a programação de vários canais em paralelo, sem passar do tempo-limite
async function epgVarios(cred: { u: string; p: string }, ids: string[], limiteMs = 2500, paralelo = 20) {
  const out = new Map<string, Prog[]>();
  const rc = RC();
  if (rc?.relay) { // pela TV: pede os guias dos primeiros canais de uma vez (uma só ida e volta)
    if (!rc.cap) return out;
    ids = ids.slice(0, 16);
    const cr = cred as Cred;
    const faltam = ids.filter((id) => { const k = cacheEpg.get(id); return !(k && Date.now() - k.em < 5 * 60 * 1000); }).map((id) => urlPlayer(cr.b ?? BASE_PROV, cr.u, cr.p, `&action=get_short_epg&stream_id=${encodeURIComponent(id)}&limit=3`)).filter((u) => !rc.rel.has(u));
    if (faltam.length) { faltam.forEach((u) => rc.need.add(u)); throw new RelayNeed(); }
  }
  const fila = [...ids];
  const fim = Date.now() + limiteMs;
  const trabalhador = async () => {
    while (fila.length && Date.now() < fim) {
      const id = fila.shift()!;
      const v = await Promise.race([epgDe(cred, id), new Promise<Prog[]>((r) => setTimeout(() => r([]), Math.max(0, fim - Date.now())))]);
      out.set(id, v);
    }
  };
  await Promise.all(Array.from({ length: paralelo }, trabalhador));
  return out;
}
function textoEpg(v: Prog[] | undefined) {
  const agora = v?.find((p) => p.ini <= Date.now() && p.fim > Date.now());
  const prox = v?.find((p) => p.ini >= (agora?.fim ?? Date.now()) - 60000 && p !== agora);
  if (!agora) return { linha: "", player: prox ? `A seguir · ${fmtHora(prox.ini)}  ${prox.titulo}` : "" };
  const pct = Math.min(100, Math.max(0, Math.round(((Date.now() - agora.ini) / (agora.fim - agora.ini)) * 100)));
  const falta = Math.max(1, Math.round((agora.fim - Date.now()) / 60000));
  return {
    linha: `${fmtHora(agora.ini)}  ${agora.titulo}`,
    player: `AGORA  ${fmtHora(agora.ini)} – ${fmtHora(agora.fim)}   ${agora.titulo}{br}${pct}% exibido · faltam ${falta} min` + (prox ? `{br}A SEGUIR  ${fmtHora(prox.ini)}   ${prox.titulo}` : ""),
  };
}

// ---------- TV ao vivo dentro do player: OK abre a lista de canais (com EPG) por cima do vídeo ----------
const CORACAO = "{col:msx-red}♥{col:msx-white}  ";
// coração do player: cheio e vermelho quando é favorito (sintaxe de cor do MSX: "{COR}:{ÍCONE}")
const iconeFav = (fav: boolean) => (fav ? "msx-red:favorite" : "favorite-border");
function canalItem(x: any, cred: { u: string; p: string }, t: string, c: string, painel = false, atual = "", cn = "", n = 0, epg?: Prog[], favs?: Set<string>) {
  const nome = limparNome(String(x.name));
  const guia = textoEpg(epg);
  const logo = x.stream_icon || undefined;
  const lista = pn({ a: "painel", t, c, cn, s: x.stream_id });
  const ativo = painel && String(x.stream_id) === atual;
  const ehFav = !!favs?.has(String(x.stream_id));
  const favAcao = pn({ a: "fav", t, c, cn, s: x.stream_id, n: nome, i: String(x.stream_icon ?? "") });
  // amarelo: para o vídeo e abre a tela inicial do Gold Play ("home" do MSX só mostra a cena principal/menu)
  const inicioAcao = `[player:eject|${go({ a: "home", t })}]`;
  const visual = painel
    ? { color: ativo ? VID.ouro : VID.n }
    : { image: logo, imageWidth: 1, imageFiller: "fit", wrapperColor: "rgba(255,255,255,0.06)", icon: logo ? undefined : "live-tv", iconSize: "small", color: VID.n };
  return {
    ...(favs?.has(String(x.stream_id)) ? { tag: "♥", tagColor: "msx-red" } : {}),
    title: (ativo ? "▶  " : "") + nome, titleFooter: guia.linha || "TV Ao Vivo", truncation: "title|titleFooter",
    ...visual,
    focus: ativo ? true : undefined, enumerate: !painel,
    playerLabel: nome,
    action: tocar("live", cred, x.stream_id, "ts", "o canal", { t, tp: "live", nome, icone: String(x.stream_icon ?? ""), extra: { c: String(x.category_id ?? c ?? "") } }),
    properties: {
      "control:type": "extended",
      "control:transparent": true,
      "control:action": lista,
      "info:headline": nome,
      "info:text": guia.player || "TV Ao Vivo",
      "progress:color": COR.destaque,
      "button:content:icon": "list",
      "button:content:action": lista,
      "button:content:focus": true,
      "trigger:ready": "player:button:content:focus",
      "trigger:start": "player:button:content:focus",
      "trigger:back": "quiet",
      "control:retune": "retain",
      "button:forward:key": "red",
      // o botão "eject" do MSX só aceita foco e atalho (não ação): o verde fica no "rewind"
      "button:rewind:icon": iconeFav(ehFav),
      "button:rewind:action": favAcao,
      "button:rewind:key": "green",
      "button:speed:icon": "home",
      "button:speed:action": inicioAcao,
      "button:speed:key": "yellow",
      "button:forward:icon": "apps",
      "button:forward:action": pn({ a: "pcats", t, s: x.stream_id }),
      "button:restart:icon": "event-note",
      "button:restart:action": pn({ a: "guia", t, s: x.stream_id, n: nome, c, cn }),
    },
  };
}
const b64txt = (v: unknown) => { try { return new TextDecoder().decode(Uint8Array.from(atob(String(v ?? "")), (ch) => ch.charCodeAt(0))); } catch { return String(v ?? ""); } };
const hora = (v: unknown) => { const m = String(v ?? "").match(/(\d{2}):(\d{2})/); return m ? `${m[1]}:${m[2]}` : ""; };

async function tratar(url: URL) {
  const a = url.searchParams.get("a") ?? "inicio";
  const pg = Math.max(0, parseInt(url.searchParams.get("pg") ?? "0", 10) || 0);

  const d = idOk(url.searchParams.get("d"));

  // o player (msx/player.html) avisa o que está tocando e em que ponto
  if (a === "visto") {
    const cr = await lerToken(url.searchParams.get("t"));
    const tp = url.searchParams.get("tp") ?? "", s = url.searchParams.get("s") ?? "";
    if (!cr || !["live", "filme", "ep"].includes(tp) || !s) return { ok: false };
    let extra: unknown = {};
    try { extra = JSON.parse(url.searchParams.get("x") ?? "{}"); } catch { /* sem extra */ }
    const num = (k: string) => Math.max(0, Math.min(1e6, parseInt(url.searchParams.get(k) ?? "0", 10) || 0));
    const live = tp === "live";
    await gravarVisto(quem(cr), tp, s.slice(0, 40), limparNome(url.searchParams.get("n") ?? "").slice(0, 120), (url.searchParams.get("i") ?? "").slice(0, 400), extra, live ? 0 : num("pos"), live ? 0 : num("dur"));
    return { ok: true };
  }

  if (a === "inicio") {
    if (url.searchParams.get("x")) { _cfgT = 0; _usr.clear(); _base.clear(); await carregarConfig(); } // botão Atualizar
    // TV cadastrada no painel (MAC + usuário + senha + DNS): entra sozinha; o painel manda no cadastro
    const tv = await tvDoAparelho(d);
    if (tv?.usuario && tv.senha_enc) {
      if (tv.bloqueado) return telaCelular(await codigoDoAparelho(d), d, "Esta TV está bloqueada. Fale com o suporte.", tv);
      const ver = Date.parse(tv.atualizado);
      const tk0 = await lerSessao(d);
      const cr0 = await lerToken(tk0);
      if (tk0 && cr0 && cr0.v === ver && cr0.u === tv.usuario) {
        if (cr0.bloq) return telaCelular(await codigoDoAparelho(d), d, "Acesso bloqueado. Fale com o suporte.", tv);
        await registrarAcesso(cr0.u, d, "sessao");
        return await home(tk0!, cr0.u, d, !url.searchParams.get("x"));
      }
      const senha = await senhaDaTv(tv.senha_enc);
      const x = await infoUsuario(tv.usuario);
      if (x.bloq) return telaCelular(await codigoDoAparelho(d), d, "Acesso bloqueado. Fale com o suporte.", tv);
      const base = (await baseDoDns(tv.dns_id)) ?? x.b;
      let info;
      try { info = senha ? await api({ u: tv.usuario, p: senha, b: base }) : null; }
      catch { return telaCelular(await codigoDoAparelho(d), d, "Servidor indisponível agora. Toque em Atualizar para tentar de novo.", tv); }
      if (!info?.user_info || Number(info.user_info.auth) !== 1) return telaCelular(await codigoDoAparelho(d), d, "O cadastro desta TV está com usuário ou senha inválidos. Fale com o suporte.", tv);
      const exp = info.user_info.exp_date ? new Date(Number(info.user_info.exp_date) * 1000).toLocaleDateString("pt-BR") : "sem data";
      await registrarAcesso(tv.usuario, d, "login", "painel", tv.mac);
      await salvarVence(tv.usuario, info);
      await fixarDnsDoUsuario(tv.usuario, tv.dns_id);
      const tk = await criarToken(tv.usuario, senha!, ver);
      await salvarSessao(d, tk);
      return await home(tk, `${tv.usuario} · vence ${exp}`, d, true);
    }
    const tk = await lerSessao(d);
    const cr = await lerToken(tk);
    if (tk && cr) {
      if (cr.bloq) { await apagarSessao(d); return telaCelular(await codigoDoAparelho(d), d, "Acesso bloqueado. Fale com o suporte."); }
      let tkx: string = tk;
      if (cr.pv) {
        const rv = await resolverPv(cr, d, tk);
        if (!rv) return telaCelular(await codigoDoAparelho(d), d, "Usuário ou senha incorretos. Entre de novo pelo celular.");
        tkx = rv.t;
      }
      await registrarAcesso(cr.u, d, "sessao");
      return await home(tkx, cr.u, d, !url.searchParams.get("x"));
    }
    if (d && url.searchParams.get("r")) await fetch(`${REST_COD()}?aparelho=eq.${encodeURIComponent(d)}`, { method: "DELETE", headers: cab() }).catch(() => {});
    return telaCelular(await codigoDoAparelho(d), d);
  }

  if (a === "ver") {
    const tk = await lerSessao(d);
    return { ok: !!(tk && (await lerToken(tk))) };
  }

  if (a === "sair") {
    await apagarSessao(d);
    return telaCelular(await codigoDoAparelho(d), d, "Você saiu. Entre de novo pelo celular.");
  }

  // Resposta para o plugin de teclado do MSX: ele só aceita uma ação (ou lista simples).
  if (a === "in") {
    const v = (url.searchParams.get("v") ?? "").trim();
    const f = url.searchParams.get("f");
    const u = f === "u" ? v : (url.searchParams.get("u") ?? "").trim();
    const p = f === "p" ? (url.searchParams.get("v") ?? "") : (url.searchParams.get("p") ?? "");
    return { action: go(d ? { a: "form", u, p, d } : { a: "form", u, p }) };
  }

  if (a === "form") {
    const u = (url.searchParams.get("u") ?? "").trim();
    const p = url.searchParams.get("p") ?? "";
    return telaEntrar(undefined, d, u, p, true);
  }

  // ---- usuários salvos nesta TV ----
  if (a === "contas" || a === "esquecerlista") {
    const dele = a === "esquecerlista";
    const us = await contasDe(d);
    const atual = url.searchParams.get("cu") ?? "";
    const itens: any[] = us.map((n, i) => ({
      title: n, titleFooter: dele ? "Toque para remover desta TV" : n === atual ? "Usuário atual" : "Toque para entrar", color: VID.n, focus: i === 0,
      action: dele ? go({ a: "esquecer", d: d ?? "", u: n }) : go({ a: "conta", d: d ?? "", u: n }),
    }));
    if (!dele) {
      itens.push({ title: "Adicionar usuário", titleFooter: "Entrar com outro usuário e senha", color: VID.n, focus: !us.length, action: go({ a: "novo", d: d ?? "" }) });
      if (us.length) itens.push({ title: "Remover usuário salvo", titleFooter: "Apaga o atalho desta TV", color: VID.n, action: go({ a: "esquecerlista", d: d ?? "" }) });
    } else if (!us.length) itens.push({ title: "Nenhum usuário salvo", action: "none" });
    return lista(dele ? "Remover usuário" : "Usuários", itens, "0,0,6,1", {}, `${us.length} salvo(s)`, "live");
  }
  if (a === "esquecer") {
    await esquecerConta(d, (url.searchParams.get("u") ?? "").trim());
    return telaEntrar("Usuário removido desta TV.", d);
  }
  if (a === "novo") return telaEntrar(undefined, d);

  if (a === "login" || a === "conta") {
    const u = (url.searchParams.get("u") ?? "").trim();
    const salvo = a === "conta";
    const p = salvo ? (await senhaSalva(d, u)) ?? "" : url.searchParams.get("p") ?? "";
    if (!u || !p) return telaEntrar(salvo ? "Não achei a senha salva. Digite de novo." : "Informe usuário e senha", d, u, "");
    let info;
    const x = await infoUsuario(u);
    if (x.bloq) return telaEntrar("Acesso bloqueado. Fale com o suporte.", d, u, "");
    const au = await autenticar(u, p, x.b);
    const cx = RC()!;
    if (!au.ok && cx.need.size) { // o servidor não alcança algum provedor: a TV tenta por ele
      if (cx.cap) throw new RelayNeed();
      // o MSX só aceita telas aqui: uma tela "Entrando…" que dispara sozinha o login pelo plugin da TV
      const acao = `content:request:interaction:${q(salvo ? { a: "conta", u, d: d ?? "", rl: 1 } : { a: "login", u, p, d: d ?? "", rl: 1 })}@${PLUGIN}`;
      return { type: "list", headline: "Gold Play", ready: { action: acao }, template: { type: "separate", layout: "0,0,12,1", color: "msx-glass" }, items: [{ title: "Entrando…", titleFooter: "Aguarde um instante", action: acao, focus: true }] };
    }
    if (!au.ok) return telaEntrar(au.erroProv ? "Provedor indisponível. Tente de novo." : "Usuário ou senha incorretos", d, u, "");
    info = au.info;
    if (cx.rel.size > 0) cx.relay = true;
    const exp = info.user_info.exp_date ? new Date(Number(info.user_info.exp_date) * 1000).toLocaleDateString("pt-BR") : "sem data";
    await registrarAcesso(u, d, "login", "tv", (await tvDoAparelho(d))?.mac ?? null);
    await salvarVence(u, info);
    if (au.dnsId) await fixarDnsDoUsuario(u, au.dnsId);
    const tk = await criarToken(u, p);
    await salvarSessao(d, tk);
    await lembrarConta(d, u, p);
    return await home(tk, `${u} · vence ${exp}`, d, true);
  }

  if (a === "japi" && ["codigo", "ver", "entrar", "conta0"].includes(url.searchParams.get("op") ?? "")) return await apiLogin(url, d);
  let cred = await lerToken(url.searchParams.get("t"));
  if (!cred && a === "japi") return { ok: false, erro: "sessao" };
  if (!cred) return telaEntrar("Sessão expirada, entre de novo", d);
  if (cred.bloq) return telaEntrar("Acesso bloqueado. Fale com o suporte.", d);
  let t = url.searchParams.get("t")!;
  if (cred.pv) {
    const rv = await resolverPv(cred, d, t);
    if (!rv) return telaEntrar("Usuário ou senha incorretos", d);
    cred = rv.cred; t = rv.t;
  }
  const c = url.searchParams.get("c") ?? "";

  if (a === "home") return await home(t, cred.u, d ?? (await aparelhoDoToken(t)));
  if (a === "japi") return await apiApp(cred, url);

  // ---- perfis ----
  if (a === "perfis") return await telaPerfis(cred, t, d);
  if (a === "perfisger") return await telaGerenciar(cred, t, d);
  if (a === "perfiledit") return await telaPerfilEdit(cred, t, d, url.searchParams.get("id") ?? "");
  if (a === "perfil") {
    const pf = url.searchParams.get("pf") ?? "p0";
    if (!(await listaPerfis(cred.u)).some((x) => x.id === pf)) return await telaPerfis(cred, t, d);
    const novo = await criarToken(cred.u, cred.p, cred.v, false, pf, !!cred.r);
    const dev = d ?? (await aparelhoDoToken(t));
    if (dev) await salvarSessao(dev, novo);
    return await home(novo, cred.u, dev, false);
  }
  if (a === "perfilnovo") { // resposta para o teclado do MSX: uma ação
    const nome = limparNome(url.searchParams.get("v") ?? "").slice(0, 20);
    if (!nome) return { action: "warn:Digite um nome" };
    const atuais = await perfisDe(cred.u);
    if (atuais.length >= 5) return { action: "warn:Limite de 5 perfis" };
    if (!atuais.length) await gravarPerfil(cred.u, { id: "p0", nome: "Principal", cor: 0, infantil: false });
    const id = "p" + Array.from(crypto.getRandomValues(new Uint8Array(4)), (x) => x.toString(16).padStart(2, "0")).join("");
    await gravarPerfil(cred.u, { id, nome, cor: (atuais.length || 1) % CORES_PERFIL.length, infantil: false });
    return { action: go(d ? { a: "perfis", t, d } : { a: "perfis", t }) };
  }
  if (a === "perfilnome" || a === "perfilcor" || a === "perfilinf") {
    const id = url.searchParams.get("id") ?? "";
    const p = (await listaPerfis(cred.u)).find((x) => x.id === id);
    if (!p) return aviso("Perfil", "Perfil não encontrado.");
    if (a === "perfilnome") {
      const nome = limparNome(url.searchParams.get("v") ?? "").slice(0, 20);
      if (!nome) return { action: "warn:Digite um nome" };
      await gravarPerfil(cred.u, { ...p, nome });
      return { action: "[info:Nome alterado|reload:content]" };
    }
    if (a === "perfilcor") await gravarPerfil(cred.u, { ...p, cor: (p.cor + 1) % CORES_PERFIL.length });
    if (a === "perfilinf") await gravarPerfil(cred.u, { ...p, infantil: true });
    return await telaPerfilEdit(cred, t, d, id);
  }
  if (a === "perfildel") {
    const id = url.searchParams.get("id") ?? "";
    const p = (await listaPerfis(cred.u)).find((x) => x.id === id);
    if (!p || id === "p0") return aviso("Perfil", "Este perfil não pode ser excluído.");
    return lista(`Excluir ${p.nome}?`, [
      { title: "{ico:delete}  Sim, excluir", titleFooter: "Os favoritos e o histórico dele também somem", color: VID.voltar, action: go(d ? { a: "perfildelok", t, id, d } : { a: "perfildelok", t, id }) },
      { title: "Cancelar", color: VID.n, action: "back", focus: true },
    ], "0,0,6,1");
  }
  if (a === "perfildelok") {
    const id = url.searchParams.get("id") ?? "";
    if (id && id !== "p0") await apagarPerfil(cred.u, id);
    return await telaGerenciar(cred, t, d);
  }

  // ---- senha do controle parental (resposta para o teclado do MSX: uma ação) ----
  if (a === "pin") {
    const cfg = await contaCfg(cred.u);
    const v = (url.searchParams.get("v") ?? "").trim();
    const op = url.searchParams.get("op") ?? "";
    if (op === "senha2") { // nova senha (a atual já foi conferida no passo anterior)
      if (url.searchParams.get("ok") !== (await chaveAdulto(t, "senha", cfg.pin))) return { action: "warn:Comece de novo pela senha atual" };
      if (!/^\d{4}$/.test(v)) return { action: "warn:A senha precisa ter 4 números" };
      await salvarConta(cred.u, { pin: v });
      return { action: "info:Senha alterada" };
    }
    if (v !== cfg.pin) return { action: "warn:Senha incorreta" };
    const base = (o: Record<string, string>) => (d ? { ...o, d } : o);
    if (op === "senha1") return { action: inputAction(`${SELF()}?${q(base({ a: "pin", t, op: "senha2", ok: await chaveAdulto(t, "senha", cfg.pin) }))}&v={INPUT}`, "Nova senha", "Digite 4 números") };
    if (op === "parental") { await salvarConta(cred.u, { parental: !cfg.parental }); return { action: `[info:Controle parental ${cfg.parental ? "desligado" : "ligado"}|reload:content]` }; }
    if (op === "infantil") {
      const p = (await listaPerfis(cred.u)).find((x) => x.id === url.searchParams.get("id"));
      if (p) await gravarPerfil(cred.u, { ...p, infantil: false });
      return { action: "[info:Perfil fora do modo infantil|reload:content]" };
    }
    const cc = url.searchParams.get("c") ?? "", cn = url.searchParams.get("cn") ?? "";
    const pk = await chaveAdulto(t, cc, cfg.pin);
    if (url.searchParams.get("dest") === "painel") return { action: pn({ a: "painel", t, c: cc, cn, s: url.searchParams.get("s") ?? "", pk }) };
    return { action: go({ a: "itens", k: url.searchParams.get("k") ?? "live", t, c: cc, cn, pk }) };
  }

  // ---- guia de programação do canal (painel do player) ----
  if (a === "guia") {
    const s = url.searchParams.get("s") ?? "", cc = url.searchParams.get("c") ?? "", cn = url.searchParams.get("cn") ?? "";
    return await telaGuia(cred, t, s, limparNome(url.searchParams.get("n") ?? "Canal"), pn({ a: "painel", t, c: cc, cn, s }));
  }
  if (a === "jogos") return await telaJogos(t);
  if (a === "config") {
    const base = (o: Record<string, string>) => (d ? { ...o, d } : o);
    return lista("Configurações", [
      { title: "{ico:palette}  Temas", titleFooter: "Trocar o visual do app nesta TV", color: VID.n, action: go(base({ a: "temas", t })) },
      { title: "{ico:search}  Pesquisar", titleFooter: "Procurar canais, filmes e séries", color: VID.n, action: abrirBusca(t, "") },
      { title: "{ico:people}  Perfis", titleFooter: "Trocar ou criar perfis", color: VID.n, action: go(base({ a: "perfis", t })) },
      { title: "{ico:lock}  Controle parental e perfis", titleFooter: "Senha, modo infantil, nomes", color: VID.n, action: go(base({ a: "perfisger", t })) },
      { title: "{ico:auto-awesome}  Nova interface (prévia)", titleFooter: "Tela inicial, filmes, séries, TV ao vivo e player novos", color: VID.ouro, action: `link:${APP_NOVO}?${q({ t, api: SELF(), ...(d ? { d } : {}) })}` },
      { title: "{ico:science}  Teste: interface nova", titleFooter: "Prova do app próprio: lista fina, relógio e prévia do canal", color: VID.ouro, action: `link:${APP_TESTE}?${q({ t, api: SELF() })}` },
      ...(TEMA === "moderno" ? [{ title: "{ico:science}  Teste de layout (Moderno)", titleFooter: "Tela de teste: tire uma foto e envie", color: VID.n, action: go(base({ a: "modteste", t })) }] : []),
    ], "0,0,6,1");
  }
  if (a === "modteste") { // tela de teste: confere se a TV aceita medidas fracionadas e qual texto de relógio funciona
    const fundoM = mt({ k: "bg" });
    const caixa = (layout: string, tit: string, sub = "") => ({ type: "default", layout, color: VID.n, title: tit, titleFooter: sub, focus: false, action: "none" });
    const itens: any[] = [
      { type: "space", layout: "0,0,12,6", offset: "-1,-1,2,2", image: fundoM, imageFiller: "cover", enable: false },
      { type: "space", layout: "0,0,6,1", headline: "Teste de layout", text: "{col:msx-white-soft}Envie uma foto desta tela" },
      { type: "space", layout: "8,0,4,1", text: "A {now:time}{br}B {now:time:HH:mm}{br}C {now:tvx:time}{br}D {now:date}" },
      ...[0, 1, 2, 3, 4].map((i) => caixa(`0,${1 + i * 0.5},3,0.5`, `Meia altura ${i + 1}`)),
      ...[0, 1, 2, 3].map((i) => caixa(`${3 + i * 2},1,2,2.5`, `Capa ${i + 1}`, "2 x 2,5")),
      ...[0, 1, 2, 3].map((i) => caixa(`${3 + i * 2},3.5,2,2.5`, `Capa ${i + 5}`, "2 x 2,5")),
      { type: "default", layout: "0,3.5,3,1.5", color: VID.ouro, title: "Foco aqui", titleFooter: "OK volta", focus: true, action: "back" },
    ];
    return { type: "pages", transparent: 2, ready: { action: "quiet" }, background: fundoM, pages: [{ items: itens }] };
  }
  if (a === "temas" || a === "tema") {
    const dev = d ?? (await aparelhoDoToken(t));
    if (a === "tema" && dev) { await salvarTemaAparelho(dev, url.searchParams.get("v") ?? ""); usarTema((url.searchParams.get("v") ?? "") || TEMA_PAINEL); return await home(t, cred.u, dev, false); }
    const atual = dev ? await temaDoAparelho(dev) : "";
    const opc = [
      { id: "", nome: "Padrão do app", desc: `O tema escolhido no painel (${TEMA_PAINEL === "onix" ? "Ônix" : TEMA_PAINEL === "moderno" ? "Moderno" : "Clássico"})`, img: IMG + (TEMA_PAINEL === "onix" ? "temas/onix/" : "") + "card-tv.png" },
      { id: "classico", nome: "Clássico", desc: "Colorido, com gradientes", img: IMG + "card-tv.png" },
      { id: "onix", nome: "Ônix", desc: "Preto com dourado, elegante", img: IMG + "temas/onix/card-tv.png" },
      { id: "app", nome: "Interface nova (premium)", desc: "Abre direto a interface nova ao iniciar o app", img: mt({ k: "tile", i: "star", t: "Premium", s: "Interface nova" }) },
      { id: "moderno", nome: "Moderno", desc: "Azul escuro, telas limpas e capas grandes", img: mt({ k: "tile", i: "live", t: "Moderno", s: "Azul escuro" }) },
    ];
    return lista("Temas", opc.map((o) => ({
      title: (o.id === atual ? "{col:msx-yellow}●{col:msx-white}  " : "") + o.nome, titleFooter: o.desc, image: o.img, imageWidth: 2, imageFiller: "fit", color: VID.n,
      action: go(dev ? { a: "tema", t, v: o.id, d: dev } : { a: "tema", t, v: o.id }), ...(o.id === atual ? { focus: true } : {}),
    })), "0,0,12,1", {}, "Vale só para esta TV");
  }
  if (a === "guiahome") return await telaGuiaHome(cred, t, pg);
  if (a === "jogo") return await telaJogo(cred, t, url.searchParams.get("n1") ?? "", url.searchParams.get("n2") ?? "");
  if (a === "buscadados") { const kk = url.searchParams.get("k") ?? ""; return await buscaDados(cred, t, kk, await filtroAdulto(cred, kk)); }
  if (a === "busca") return await telaBusca(cred, t, url.searchParams.get("k") ?? "", (url.searchParams.get("q") ?? "").slice(0, 30), url.searchParams.get("f") ?? "", url.searchParams.get("m") ?? "");
  if (a === "buscatodos") {
    const k = url.searchParams.get("k") ?? "", texto = (url.searchParams.get("q") ?? "").slice(0, 30);
    const todos = await resultadosBusca(cred, k, texto);
    const prox = (n: number) => go({ a: "buscatodos", t, ...(k ? { k } : {}), q: texto, pg: n });
    return paginar(`Pesquisa: ${xmlMsx(texto.toUpperCase())}`, todos, pg, (x) => itemBusca(x, cred, t), prox, "0,0,4,1", k || "live", `${todos.length} resultados`, { title: "‹   PESQUISA", titleFooter: "Voltar ao teclado" });
  }

  const TIPOS = {
    live: { nome: "TV ao vivo", cats: "get_live_categories", itens: "get_live_streams", cor: COR.tv, solido: "#5B3FD9", icone: "live-tv" },
    vod: { nome: "Filmes", cats: "get_vod_categories", itens: "get_vod_streams", cor: COR.vod, solido: "#C02670", icone: "movie" },
    series: { nome: "Séries", cats: "get_series_categories", itens: "get_series", cor: COR.series, solido: "#0B8F9C", icone: "video-library" },
  } as const;
  const tipoQ = url.searchParams.get("k") as keyof typeof TIPOS;
  const T = TIPOS[tipoQ];

  if (a === "cats") {
    if (!T) return aviso("Gold Play", "Seção desconhecida");
    const [cats, regra] = await Promise.all([api(cred, `&action=${T.cats}`), regraAdulto(cred)]);
    const lst = ((Array.isArray(cats) ? cats : []) as any[]).filter((x) => !(regra.infantil && ehAdulto(String(x.category_name))));
    // visual transparente (o vídeo/fundo aparece por trás), como o usuário preferiu
    const linha = (nome: string, ic: string, cid: string, sub: string) => ({ title: nome, titleFooter: sub, color: VID.n, action: go({ a: "itens", k: tipoQ, t, c: cid, cn: cid ? nome : "" }) });
    const itens: any[] = [
      { ...linha("Todos", "apps", "", `Todo o catálogo de ${T.nome.toLowerCase()}`), focus: true },
      { title: "{ico:search}  PESQUISAR", titleFooter: `Procurar em ${T.nome}`, color: VID.ouro, action: abrirBusca(t, tipoQ) },
      ...(tipoQ === "live" ? [
        { ...linha("Canais favoritos", "star", "fav", "Seus canais favoritos"), title: CORACAO + "CANAIS FAVORITOS" },
        { ...linha("Últimos vistos", "history", "ult", "Os canais que você assistiu por último"), title: "{ico:history}  ÚLTIMOS VISTOS" },
      ] : [
        { ...linha(tipoQ === "vod" ? "Filmes favoritos" : "Séries favoritas", "star", "fav", tipoQ === "vod" ? "Os filmes que você favoritou" : "As séries que você favoritou"), title: CORACAO + (tipoQ === "vod" ? "FILMES FAVORITOS" : "SÉRIES FAVORITAS") },
        { title: "{ico:play-circle-outline}  CONTINUAR ASSISTINDO", titleFooter: "De onde você parou", color: VID.n, action: go({ a: "continuar", t, k: tipoQ }) },
        { title: "{ico:fiber-new}  ADICIONADOS RECENTEMENTE", titleFooter: "Os últimos que chegaram", color: VID.n, action: go({ a: "itens", k: tipoQ, t, c: "", cn: "Recentes", o: "rec" }) },
        { title: "{ico:star}  MAIS BEM AVALIADOS", titleFooter: "Pela nota", color: VID.n, action: go({ a: "itens", k: tipoQ, t, c: "", cn: "Mais bem avaliados", o: "nota" }) },
      ]),
      ...lst.map((x: any) => {
        const nome = limparNome(String(x.category_name));
        if (regra.protege && ehAdulto(nome)) return { title: `{ico:lock}  ${nome}`, titleFooter: "Protegido por senha", color: VID.n, action: pedirSenha({ t, dest: "itens", k: tipoQ, c: String(x.category_id), cn: nome }) };
        return linha(nome, iconeDoNome(nome, "play"), x.category_id, T.nome);
      }),
    ];
    return lista(T.nome, itens, "0,0,6,1", {}, `${lst.length} categorias`, tipoQ);
  }

  if (a === "itens") {
    if (!T) return aviso("Gold Play", "Seção desconhecida");
    const regra = await regraAdulto(cred);
    if (regra.protege && c && c !== "fav" && c !== "ult" && (await catsAdultas(cred, tipoQ)).has(c)) {
      if (regra.infantil || url.searchParams.get("pk") !== (await chaveAdulto(t, c, regra.pin))) return aviso("Protegido", "Esta categoria pede a senha do controle parental.");
    }
    const favVod = tipoQ === "live" ? null : new Set((await favoritosVod(quem(cred), tipoQ === "vod" ? "v" : "s")).map((f) => f.stream_id));
    const dados = c === "fav" && tipoQ !== "live" ? (await favoritosVod(quem(cred), tipoQ === "vod" ? "v" : "s")).map((f) => ({ name: f.name, stream_id: f.stream_id, series_id: f.stream_id, stream_icon: f.stream_icon, cover: f.stream_icon }))
      : c === "fav" && tipoQ === "live" ? await favoritosDe(quem(cred))
      : c === "ult" && tipoQ === "live" ? await ultimosCanais(quem(cred))
      : await api(cred, `&action=${T.itens}${c && c !== "fav" && c !== "ult" ? "&category_id=" + encodeURIComponent(c) : ""}`);
    const o = tipoQ === "live" ? "" : (url.searchParams.get("o") ?? "");
    const semAdulto = !c && regra.protege ? await filtroAdulto(cred, tipoQ) : null;
    const brutos = (Array.isArray(dados) ? dados : []) as any[];
    if (!c) anotarContagem(cred.u, tipoQ, brutos.length);
    const todos = ordenar(semAdulto ? brutos.filter((x) => !semAdulto(String(x.category_id), tipoQ)) : brutos, o in ORDENS ? o : "");
    const cnQ = url.searchParams.get("cn") ?? "";
    const pkQ = url.searchParams.get("pk") ?? "";
    const prox = (n: number) => go({ a: "itens", k: tipoQ, t, c, cn: cnQ, pg: n, ...(o ? { o } : {}), ...(pkQ ? { pk: pkQ } : {}) });
    const po = PROX_ORDEM[o] ?? "";
    const botaoOrdem = { title: `{ico:sort}  Ordem: ${ORDENS[o] ?? "Padrão"}`, titleFooter: `Trocar para ${ORDENS[po]}`, color: VID.voltar, action: go({ a: "itens", k: tipoQ, t, c, cn: cnQ, ...(po ? { o: po } : {}) }) };
    if (tipoQ === "live") {
      const ep = await epgVarios(cred, todos.slice(pg * POR_PAGINA, (pg + 1) * POR_PAGINA).map((x: any) => String(x.stream_id)));
      const favs = new Set((await favoritosDe(quem(cred))).map((f) => f.stream_id));
      return paginar("Canais", todos, pg, (x) => canalItem(x, cred, t, c, false, "", url.searchParams.get("cn") ?? "", 0, ep.get(String(x.stream_id)), favs), prox, "0,0,4,1", tipoQ);
    }
    if (TEMA === "moderno") { // grade de 4 colunas com rolagem vertical infinita (a página seguinte carrega sozinha ao chegar no fim)
      const fino = (x: Record<string, unknown>) => ({ ...x, layout: "0,0,3,1" });
      const topoM = [
        fino({ title: "{ico:search}  Pesquisar", titleFooter: `Procurar em ${T.nome}`, color: VID.ouro, action: abrirBusca(t, tipoQ) }),
        fino({ title: "{ico:sort}  Ordem: " + (ORDENS[o] ?? "Padrão"), titleFooter: `Trocar para ${ORDENS[po]}`, color: VID.n, action: botaoOrdem.action }),
        fino({ title: "{ico:apps}  Categorias", titleFooter: cnQ || "Escolher uma categoria", color: VID.n, action: go({ a: "cats", k: tipoQ, t }) }),
      ];
      const montarM = (x: any) => (tipoQ === "vod" ? cartaoFilme(x, t, favVod ?? undefined) : cartaoSerie(x, t, favVod ?? undefined));
      return paginar(cnQ || T.nome, todos, pg, montarM, prox, "0,0,3,4", tipoQ, `${todos.length.toLocaleString("pt-BR")} títulos`, { title: "‹   INÍCIO", titleFooter: "Voltar", layout: "0,0,3,1" } as any, topoM);
    }
    const voltar = { title: "‹   CATEGORIAS", titleFooter: "Voltar às categorias" };
    if (tipoQ === "vod") return paginar(cnQ || "Filmes", todos, pg, (x) => cartaoFilme(x, t, favVod ?? undefined), prox, "0,0,2,3", tipoQ, undefined, voltar, [botaoOrdem]);
    return paginar(cnQ || "Séries", todos, pg, (x) => cartaoSerie(x, t, favVod ?? undefined), prox, "0,0,2,3", tipoQ, undefined, voltar, [botaoOrdem]);
  }

  if (a === "filme") return await telaFilme(cred, t, url.searchParams.get("s") ?? "");
  if (a === "favvod") { // favoritar filme ("v") ou série ("s") pela tela de detalhes
    const tp = url.searchParams.get("tp") === "s" ? "s" : "v", s = url.searchParams.get("s") ?? "";
    await alternarFavorito(quem(cred), `${tp}:${s}`, url.searchParams.get("n") ?? "", url.searchParams.get("i") ?? "");
    return tp === "v" ? await telaFilme(cred, t, s) : await telaSerie(cred, t, s);
  }

  if (a === "continuar") {
    const k = url.searchParams.get("k") ?? "";
    const hs = (await historicoDe(quem(cred), k === "series" ? ["ep"] : k === "vod" ? ["filme"] : ["filme", "ep"], 60)).filter(emAndamento).slice(0, 40);
    if (!hs.length) return aviso("Continuar assistindo", "Nada por aqui ainda. Comece um filme ou episódio e ele aparece nesta lista.");
    return lista("Continuar assistindo", hs.map((h) => itemContinuar(h, cred, t)), "0,0,2,3", {}, `${hs.length}`, k === "series" ? "series" : "vod");
  }

  if (a === "painel" || a === "fav") {
    const s = url.searchParams.get("s") ?? "";
    const cn = url.searchParams.get("cn") ?? "";
    let avisoFav = "";
    let agoraFav = false;
    if (a === "fav") {
      agoraFav = await alternarFavorito(quem(cred), s, url.searchParams.get("n") ?? "Canal", url.searchParams.get("i") ?? "");
      avisoFav = agoraFav ? "adicionado aos favoritos" : "removido dos favoritos";
    }
    const regra = await regraAdulto(cred);
    if (regra.protege && c && c !== "fav" && c !== "ult" && (await catsAdultas(cred, "live")).has(c)) {
      if (regra.infantil || url.searchParams.get("pk") !== (await chaveAdulto(t, c, regra.pin))) return { type: "list", headline: "Protegido", items: [{ title: "Esta categoria pede a senha do controle parental", action: "back" }] };
    }
    const dados = c === "fav" ? await favoritosDe(quem(cred)) : c === "ult" ? await ultimosCanais(quem(cred)) : await api(cred, `&action=get_live_streams${c ? "&category_id=" + encodeURIComponent(c) : ""}`);
    const semAdulto = !c && regra.protege ? await filtroAdulto(cred, "live") : null;
    const todos = ((Array.isArray(dados) ? dados : []) as any[]).filter((x) => !semAdulto || !semAdulto(String(x.category_id), "live")).slice(0, 400);
    const idx = todos.findIndex((x: any) => String(x.stream_id) === s);
    const perto = idx >= 0 ? todos.slice(Math.max(0, idx - 4), idx + 20) : todos.slice(0, 24);
    const ids = [s, ...perto.map((x: any) => String(x.stream_id)).filter((i: string) => i !== s)];
    const ep = await epgVarios(cred, ids, 1200);
    const navegar = {
      title: "‹   CATEGORIAS", titleFooter: `Atual: ${cn || "Todos os canais"}`, key: "red",
      color: VID.voltar,
      action: pn({ a: "pcats", t, s }),
    };
    const favs = new Set((await favoritosDe(quem(cred))).map((f) => f.stream_id));
    const nParam = url.searchParams.get("n") ?? "", iParam = url.searchParams.get("i") ?? "";
    const atualCanal: any = todos.find((x: any) => String(x.stream_id) === s) ?? (a === "fav" && nParam ? { name: nParam, stream_id: s, stream_icon: iParam } : undefined);
    const alternar = atualCanal ? pn({ a: "fav", t, c, cn, s, n: limparNome(String(atualCanal.name)), i: String(atualCanal.stream_icon ?? "") }) : "[]";
    const canais = todos.map((x: any, i: number) => ({ x, i })).filter((o: any) => o.i !== idx)
      .map((o: any) => ({ ...canalItem(o.x, cred, t, c, true, s, cn, o.i + 1, ep.get(String(o.x.stream_id)), favs), focus: undefined }));
    const fixo = atualCanal ? [{ ...canalItem(atualCanal, cred, t, c, true, s, cn, idx + 1, ep.get(s), favs), action: "back", focus: true, ...(avisoFav ? { titleFooter: "Canal " + avisoFav } : {}) }] : [];
    // depois de favoritar, troca o coração do player na hora (as propriedades do canal só valem ao abrir o vídeo)
    const atualizaCoracao = a === "fav" && atualCanal
      ? { ready: { action: "player:button:rewind:setup", data: { icon: iconeFav(agoraFav), action: alternar, key: "green" } } }
      : {};
    // Fora da barra do player, as teclas coloridas só valem em itens da tela aberta (como o vermelho já fazia):
    // por isso a primeira linha tem os três botões lado a lado, cada um com a sua tecla.
    const ehFavAtual = favs.has(s);
    const casinha = { title: "{col:msx-yellow}{ico:home}{col:msx-white}  Início", titleFooter: "Voltar à tela inicial", key: "yellow", color: VID.voltar, action: `[player:eject|${go({ a: "home", t })}]` };
    const botoes = [
      { ...navegar, layout: "0,0,8,1", title: "{col:msx-red}●{col:msx-white}  Categorias", truncation: "titleFooter", focus: !atualCanal ? true : undefined },
    ];
    return {
      ...atualizaCoracao,
      type: "list", transparent: 2, headline: "Canais{tb}{tb}{col:msx-red}●{col:msx-white-soft} Categorias      {col:msx-yellow}●{col:msx-white-soft} Início",
      template: { type: "default", layout: "0,0,8,1", color: COR.vidro },
      items: [...botoes, ...fixo, ...canais, casinha],
    };
  }

  // categorias de canais dentro do painel do player
  if (a === "pcats") {
    const s = url.searchParams.get("s") ?? "";
    const [cats, regra] = await Promise.all([api(cred, "&action=get_live_categories"), regraAdulto(cred)]);
    const lst = ((Array.isArray(cats) ? cats : []) as any[]).filter((x) => !(regra.infantil && ehAdulto(String(x.category_name))));
    const item = (nome: string, cid: string, titulo = nome) => ({
      title: titulo, titleFooter: "TV ao vivo", truncation: "title",
      color: VID.n,
      action: pn({ a: "painel", t, c: cid, cn: cid ? nome : "", s }),
    });
    return {
      type: "list", transparent: 2, headline: "Categorias", extension: `${lst.length}`,
      template: { type: "default", layout: "0,0,8,1", color: COR.vidro },
      items: [item("Todos os canais", ""), { ...item("FAVORITOS", "fav", CORACAO + "FAVORITOS"), titleFooter: "Seus canais favoritos" }, { ...item("Últimos vistos", "ult", "{ico:history}  ÚLTIMOS VISTOS"), titleFooter: "Os canais que você assistiu por último" }, ...lst.map((x: any) => {
        const nome = limparNome(String(x.category_name));
        if (regra.protege && ehAdulto(nome)) return { title: `{ico:lock}  ${nome}`, titleFooter: "Protegido por senha", truncation: "title", color: VID.n, action: pedirSenha({ t, dest: "painel", c: String(x.category_id), cn: nome, s }) };
        return item(nome, String(x.category_id));
      })],
    };
  }

  if (a === "serie") {
    const s = url.searchParams.get("s") ?? "";
    const temp = url.searchParams.get("n");
    if (temp === null) return await telaSerie(cred, t, s);
    const info = await api(cred, `&action=get_series_info&series_id=${encodeURIComponent(s)}`);
    const nome = limparNome(String(info?.info?.name ?? "Série"));
    const eps = info?.episodes ?? {};
    const numeros = Object.keys(eps).sort((x, y) => Number(x) - Number(y));
    if (temp === "*") { // todas as temporadas (séries com muitas)
      return lista(limparNome(nome), numeros.map((n) => ({
        title: `Temporada ${n}`, titleFooter: `${eps[n].length} episódios`, color: VID.n,
        action: go({ a: "serie", t, s, n }),
      })), "0,0,6,1", {}, `${numeros.length} temporadas`, "series");
    }
    const lst = (eps[temp] ?? []) as any[];
    return lista(`${nome}`, lst.map((e) => ({
      titleHeader: `Episódio ${e.episode_num}`, title: String(e.title ?? ""), titleFooter: e.info?.duration ? String(e.info.duration) : "",
      image: e.info?.movie_image || undefined, imageFiller: "cover", icon: e.info?.movie_image ? undefined : "play-arrow", color: COR.vidro,
      ...epAcao(cred, t, s, nome, temp, e, imgOk(info?.info?.cover)),
    })), "0,0,4,2", {}, `Temporada ${temp}`, "series");
  }

  return aviso("Gold Play", "Tela não encontrada");
}

// ---------- Jogos do dia (API própria do painel) ----------
// A API é consultada pelo Edge Function para evitar bloqueio de CORS no navegador da TV.
const JOGOS_API = "https://xsender.painelmaster.lol/retornojogosmx.json";
type Jogo = {
  liga: string;
  ord: number;
  quando: number;
  estado: string;
  status: string;
  casa: Time;
  fora: Time;
  transmissao: string;
  canaisLista: string[];
};
type Time = { nome: string; sigla: string; cor: string; gols: string; venceu: boolean; logo: string };
let cacheJogos: { em: number; dia: string; v: Jogo[] } | null = null;
const FUSO = -3 * 3600_000; // America/Fortaleza (sem horário de verão)
const diaLocal = (ms = Date.now()) => new Date(ms + FUSO).toISOString().slice(0, 10);
const horaLocal = (ms: number) => new Date(ms + FUSO).toISOString().slice(11, 16);

const semAcentoJogo = (v: unknown) => String(v ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
const textoJogo = (v: unknown) => limparNome(String(v ?? ""));
const siglaTime = (nome: string) => {
  const palavras = nome.split(/\s+/).filter(Boolean);
  if (!palavras.length) return "?";
  if (palavras.length === 1) return palavras[0].slice(0, 4).toUpperCase();
  return palavras.filter((p) => !/^(fc|sc|ec|ac|cf|club|clube)$/i.test(p)).slice(0, 3).map((p) => p[0]).join("").slice(0, 4).toUpperCase();
};
const golsJogo = (v: unknown) => {
  const s = String(v ?? "").trim();
  return /^\d{1,3}$/.test(s) ? s : "";
};
const jogoHoje = (v: unknown, hoje: string) => {
  const s = semAcentoJogo(v);
  if (!s || s === "hoje" || s === "today") return true;
  const dmy = hoje.slice(8, 10) + "/" + hoje.slice(5, 7) + "/" + hoje.slice(0, 4);
  return s === hoje || s === dmy || s === hoje.split("-").reverse().join("/");
};
function estadoJogo(statusRaw: unknown, placar1: string, placar2: string) {
  const bruto = String(statusRaw ?? "").trim();
  const s = semAcentoJogo(bruto);
  if (!s) return { estado: "pre", status: "" };
  // minuto de jogo: 27' · 45'+2 · 90+3'
  const min = bruto.match(/^(\d{1,3})\s*['’′]?\s*(?:\+\s*(\d{1,2}))?\s*['’′]?$/);
  if (min && /['’′+]/.test(bruto)) return { estado: "in", status: `AO VIVO ${min[1]}${min[2] ? "+" + min[2] : ""}'` };
  if (/^(int|ht|intervalo|half ?time)$/.test(s)) return { estado: "in", status: "INTERVALO" };
  if (/adiad|cancel|postpon|suspens/.test(s)) return { estado: "post", status: "ADIADO" };
  if (/encerr|finaliz|finished|fim|full time|^ft$|^fim$/.test(s)) return { estado: "post", status: "ENCERRADO" };
  if (/ao vivo|aovivo|live|andamento|inplay|^[12]t$|^et$|prorrog|penalt/.test(s)) return { estado: "in", status: "AO VIVO" };
  if (placar1 !== "" && placar2 !== "" && /final|resultado/.test(s)) return { estado: "post", status: "ENCERRADO" };
  return { estado: "pre", status: "" };
}
function horaDoJogo(horario: unknown) {
  const m = String(horario ?? "").match(/(\d{1,2}):(\d{2})/);
  if (!m) return NaN;
  const h = Number(m[1]), min = Number(m[2]);
  if (h > 23 || min > 59) return NaN;
  const d = diaLocal();
  return Date.parse(`${d}T${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}:00-03:00`);
}
const CORES_TIME = ["2563EB", "DC2626", "059669", "D97706", "7C3AED", "DB2777", "0891B2", "65A30D", "EA580C", "4F46E5"];
const corDoNome = (n: string) => { let h = 0; for (const ch of n) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return CORES_TIME[h % CORES_TIME.length]; };
const HOST_IMG_JOGOS = "img.tropatech.com.br";
const urlLogoOk = (v: unknown) => { try { const u = new URL(String(v ?? "")); return u.protocol === "https:" && u.hostname === HOST_IMG_JOGOS ? u.toString() : ""; } catch { return ""; } };
const montarTimeJogo = (nomeRaw: unknown, logoRaw: unknown, gols: string, venceu = false): Time => {
  const nome = textoJogo(nomeRaw) || "?";
  return { nome, sigla: siglaTime(nome), cor: corDoNome(nome), gols, venceu, logo: urlLogoOk(logoRaw) };
};

async function jogosDoDia(limiteMs = 3500): Promise<Jogo[] | null> {
  const dia = diaLocal();
  if (cacheJogos && cacheJogos.dia === dia && Date.now() - cacheJogos.em < 90_000) return cacheJogos.v;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), limiteMs);
  try {
    const r = await fetch(JOGOS_API, {
      signal: ctl.signal,
      headers: { "accept": "application/json", "user-agent": "GoldPlay-MSX/1.0" },
    });
    if (!r.ok) throw new Error("API de jogos respondeu " + r.status);
    const bruto = await r.json();
    const lista = Array.isArray(bruto) ? bruto : [];
    const jogos = lista.map((x: any, ord: number): Jogo | null => {
      const placar1 = golsJogo(x?.placar_time1);
      const placar2 = golsJogo(x?.placar_time2);
      if (!jogoHoje(x?.data_jogo, dia)) return null;
      const casaNome = textoJogo(x?.time1) || "Time 1";
      const foraNome = textoJogo(x?.time2) || "Time 2";
      const estado = estadoJogo(x?.status, placar1, placar2);
      const quando = horaDoJogo(x?.horario);
      const canaisLista: string[] = Array.isArray(x?.canais) ? x.canais.map((c: any) => textoJogo(c?.nome)).filter(Boolean) : [];
      const canais = canaisLista.join(" · ");
      return {
        liga: textoJogo(x?.competicao) || "Futebol",
        ord,
        quando: Number.isFinite(quando) ? quando : Date.now() + ord,
        estado: estado.estado,
        status: estado.status || (String(x?.horario ?? "").match(/\d{1,2}:\d{2}/)?.[0] ?? "A DEFINIR"),
        casa: montarTimeJogo(casaNome, x?.img_time1_url, placar1, placar1 !== "" && placar2 !== "" && Number(placar1) > Number(placar2)),
        fora: montarTimeJogo(foraNome, x?.img_time2_url, placar2, placar1 !== "" && placar2 !== "" && Number(placar2) > Number(placar1)),
        transmissao: canais,
        canaisLista,
      };
    }).filter(Boolean) as Jogo[];
    const peso: Record<string, number> = { in: 0, pre: 1, post: 2 };
    // ao vivo e próximos: do mais cedo ao mais tarde; encerrados: o mais recente primeiro
    jogos.sort((a, b) => (peso[a.estado] ?? 1) - (peso[b.estado] ?? 1) || (a.estado === "post" ? b.quando - a.quando : a.quando - b.quando) || a.ord - b.ord);
    cacheJogos = { em: Date.now(), dia, v: jogos };
    return jogos;
  } catch {
    // Se a fonte cair momentaneamente, conserva os últimos jogos do mesmo dia.
    return cacheJogos?.dia === dia ? cacheJogos.v : null;
  } finally {
    clearTimeout(timer);
  }
}

// cartão SVG de um jogo (placar em duas linhas, estilo app esportivo)
async function jogoSvg(g: URLSearchParams, logos: { h?: string; f?: string } = {}) {
  const W = 600, H = 380;
  const k = g.get("k") ?? "pre";
  const st = limparNome(g.get("s") ?? "").slice(0, 18);
  const liga = limparNome(g.get("l") ?? "").slice(0, 24).toUpperCase();
  const canais = (g.get("c") ?? "").replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, 80);
  // logos embutidas no SVG não aparecem na TV; quando a tela põe a logo por cima (item à parte), aqui fica só o disco branco
  const lg = g.get("lg") ?? "";
  const logoH: string | null = logos.h ?? (lg.includes("h") ? "" : null), logoF: string | null = logos.f ?? (lg.includes("f") ? "" : null);
  const linha = (y: number, p: string, logo: string | null) => {
    const [nome = "", sigla = "", cor = "475569", gols = "", v = ""] = (g.get(p) ?? "").split("|");
    const apaga = k === "post" && v !== "1";
    const n = limparNome(nome); const longo = n.length > 14; const nm = n.length > 23 ? n.slice(0, 22) + "…" : n;
    const c = /^[0-9a-f]{6}$/i.test(cor) ? cor : "475569";
    const escudo = logo === ""
      ? `<circle cx="74" cy="${y}" r="38" fill="#fff" fill-opacity=".96"/>`
      : logo
      ? `<circle cx="74" cy="${y}" r="38" fill="#fff" fill-opacity=".94"/><image href="${logo}" x="48" y="${y - 26}" width="52" height="52" preserveAspectRatio="xMidYMid meet"/><circle cx="74" cy="${y}" r="37" fill="none" stroke="#fff" stroke-opacity=".5" stroke-width="2"/>`
      : `<circle cx="74" cy="${y}" r="38" fill="#${c}"/><circle cx="74" cy="${y}" r="38" fill="url(#bri)"/><circle cx="74" cy="${y}" r="37" fill="none" stroke="#fff" stroke-opacity=".35" stroke-width="2"/>`
        + `<text x="74" y="${y + 9}" text-anchor="middle" font-size="${sigla.length > 3 ? 20 : 25}" font-weight="800" fill="#fff" font-family="Arial, Helvetica, sans-serif">${xml(sigla)}</text>`;
    return escudo
      + `<text x="132" y="${y + 13}" font-size="${longo ? 30 : 36}" font-weight="700" fill="#fff" fill-opacity="${apaga ? 0.6 : 1}" font-family="Arial, Helvetica, sans-serif">${xml(nm)}</text>`
      + (k !== "pre" ? `<text x="${W - 40}" y="${y + 17}" text-anchor="end" font-size="52" font-weight="800" fill="#fff" fill-opacity="${apaga ? 0.55 : 1}" font-family="Arial, Helvetica, sans-serif">${xml(gols.slice(0, 3))}</text>` : "");
  };
  const aoVivo = k === "in";
  const pw = Math.max(110, st.length * 15 + (aoVivo ? 58 : 36));
  const pill = `<rect x="${W - 32 - pw}" y="26" width="${pw}" height="46" rx="23" fill="${aoVivo ? "#EF4444" : k === "post" ? "#fff" : "#F5B400"}" fill-opacity="${aoVivo ? 1 : k === "post" ? 0.16 : 0.95}"/>`
    + (aoVivo ? `<circle cx="${W - 32 - pw + 24}" cy="49" r="7" fill="#fff"/>` : "")
    + `<text x="${W - 32 - pw / 2 + (aoVivo ? 12 : 0)}" y="58" text-anchor="middle" font-size="24" font-weight="800" fill="${k === "pre" ? "#1A1300" : "#fff"}" font-family="Arial, Helvetica, sans-serif">${xml(st)}</text>`;
  const rodape = canais
    ? `<line x1="40" x2="${W - 40}" y1="300" y2="300" stroke="#fff" stroke-opacity=".1" stroke-width="2"/>`
      + `<text x="40" y="342" font-size="22" font-weight="700" fill="#F5B400" font-family="Arial, Helvetica, sans-serif">ONDE ASSISTIR</text>`
      + `<text x="${40 + 190}" y="342" font-size="22" font-weight="600" fill="#fff" fill-opacity=".85" font-family="Arial, Helvetica, sans-serif">${xml(canais.length > 27 ? canais.slice(0, 26) + "…" : canais)}</text>`
    : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><defs>`
    + `<linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#1B1F3B" stop-opacity=".82"/><stop offset="1" stop-color="#0B0D1E" stop-opacity=".72"/></linearGradient>`
    + `<linearGradient id="sh" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".12"/><stop offset=".45" stop-color="#fff" stop-opacity="0"/></linearGradient>`
    + `<radialGradient id="bri" cx=".35" cy=".3" r=".8"><stop offset="0" stop-color="#fff" stop-opacity=".35"/><stop offset="1" stop-color="#000" stop-opacity=".25"/></radialGradient>`
    + `<clipPath id="c"><rect x="8" y="8" width="${W - 16}" height="${H - 16}" rx="0"/></clipPath></defs>`
    + `<g clip-path="url(#c)"><rect width="${W}" height="${H}" fill="url(#bg)"/><rect width="${W}" height="${H}" fill="url(#sh)"/>`
    + (aoVivo ? `<rect width="8" height="${H}" x="8" fill="#EF4444"/>` : "")
    + `<circle cx="${W}" cy="${H}" r="170" fill="#F5B400" fill-opacity=".07"/>`
    + `<text x="40" y="58" font-size="22" font-weight="700" letter-spacing="2" fill="#fff" fill-opacity=".7" font-family="Arial, Helvetica, sans-serif">${xml(liga)}</text>${pill}`
    + `<line x1="40" x2="${W - 40}" y1="96" y2="96" stroke="#fff" stroke-opacity=".1" stroke-width="2"/>`
    + linha(156, "h", logoH) + linha(246, "f", logoF) + rodape + `</g>`
    + `<rect x="9" y="9" width="${W - 18}" height="${H - 18}" rx="0" fill="none" stroke="#fff" stroke-opacity=".2" stroke-width="2"/></svg>`;
}
// cartão do jogo em PNG com as logos já dentro (a TV não carrega imagem embutida em SVG)
let _resvg: any = null;
const _jgp = new Map<string, { em: number; v: Uint8Array }>();
async function logoDataUri(u: string): Promise<string | undefined> {
  try {
    const r = await fetch(u, { signal: AbortSignal.timeout(4000) }); if (!r.ok) return undefined;
    const b = new Uint8Array(await r.arrayBuffer()); let bin = ""; for (let i = 0; i < b.length; i += 8192) bin += String.fromCharCode(...b.subarray(i, i + 8192));
    return `data:${r.headers.get("content-type") || "image/png"};base64,${btoa(bin)}`;
  } catch { return undefined; }
}
async function jogoPng(g: URLSearchParams): Promise<Uint8Array> {
  const ch = g.toString(); const c = _jgp.get(ch);
  if (c && Date.now() - c.em < 120_000) return c.v;
  if (!_resvg) {
    const m = await import("npm:@resvg/resvg-wasm@2.6.2");
    await m.initWasm(fetch("https://unpkg.com/@resvg/resvg-wasm@2.6.2/index_bg.wasm"));
    if (!_fonte) _fonte = new Uint8Array(await (await fetch(IMG + "fontes/DejaVuSans-Bold.ttf")).arrayBuffer());
    _resvg = m;
  }
  const [h, f] = await Promise.all([g.get("hl") ? logoDataUri(g.get("hl")!) : undefined, g.get("fl") ? logoDataUri(g.get("fl")!) : undefined]);
  const svg = (await jogoSvg(g, { h, f })).replace(/font-family="[^"]*"/g, 'font-family="DejaVu Sans"');
  const v = new _resvg.Resvg(svg, { font: { fontBuffers: [_fonte], defaultFontFamily: "DejaVu Sans", loadSystemFonts: false } }).render().asPng();
  if (_jgp.size > 300) _jgp.clear();
  _jgp.set(ch, { em: Date.now(), v });
  return v;
}
const jogoPngUrl = (j: Jogo) => `${SELF()}?${q({ a: "jgp", k: j.estado, s: j.status, l: j.liga, h: timeTxt(j.casa), f: timeTxt(j.fora), c: j.transmissao,
  ...(j.casa.logo ? { hl: j.casa.logo } : {}), ...(j.fora.logo ? { fl: j.fora.logo } : {}) })}`;
const timeTxt = (t: Time) => [t.nome, t.sigla, t.cor, t.gols, t.venceu ? "1" : ""].join("|");
const jogoImg = (j: Jogo, lg = "") => `${SELF()}?${q({ ...(lg ? { lg } : {}),
  a: "jg", k: j.estado, s: j.status, l: j.liga, h: timeTxt(j.casa), f: timeTxt(j.fora), c: j.transmissao,
})}`;

// cartão de abertura da faixa de jogos
function resumoSvg(total: number, vivos: number, falhou: boolean) {
  const W = 600, H = 380;
  const sub = falhou ? "Placar indisponível agora" : total ? `${total} partida${total > 1 ? "s" : ""}${vivos ? ` · ${vivos} ao vivo` : ""}` : "Nenhuma partida hoje";
  const bola = "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 3.3l1.35-.95c1.82.56 3.37 1.76 4.38 3.34l-.39 1.34-1.35.46L13 6.7V5.3zm-3.35-.95L11 5.3v1.4L7.01 9.49l-1.35-.47-.39-1.34c1.01-1.57 2.56-2.77 4.38-3.33zM7.08 17.11l-1.14.1C4.73 15.81 4 13.99 4 12c0-.12.01-.23.02-.35l1-.73 1.38.48 1.46 4.34-.78 1.37zm7.42 2.48c-.79.26-1.63.41-2.5.41s-1.71-.15-2.5-.41l-.69-1.49.64-1.1h5.11l.64 1.11-.7 1.48zM14.27 15H9.73l-1.35-4.02L12 8.44l3.63 2.54L14.27 15zm3.79 2.21l-1.14-.1-.79-1.37 1.46-4.34 1.39-.47 1 .73c.01.11.02.22.02.34 0 1.99-.73 3.81-1.94 5.21z";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><defs>`
    + (TEMA === "onix"
      ? `<linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#2B2418"/><stop offset=".55" stop-color="#16130F"/><stop offset="1" stop-color="#0C0B0D"/></linearGradient>`
      : `<linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#F5B400"/><stop offset=".6" stop-color="#FF7A00"/><stop offset="1" stop-color="#E11D48"/></linearGradient>`)
    + `<linearGradient id="sh" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".2"/><stop offset=".5" stop-color="#fff" stop-opacity="0"/></linearGradient>`
    + `<clipPath id="c"><rect x="8" y="8" width="${W - 16}" height="${H - 16}" rx="0"/></clipPath></defs>`
    + `<g clip-path="url(#c)"><rect width="${W}" height="${H}" fill="url(#g)"/><rect width="${W}" height="${H}" fill="url(#sh)"/>`
    + `<g transform="translate(400 170) scale(10)" fill="#fff" fill-opacity=".13"><path d="${bola}"/></g>`
    + `<rect x="40" y="40" width="84" height="84" rx="24" fill="#fff" fill-opacity=".22"/><g transform="translate(58 58) scale(2)" fill="#fff"><path d="${bola}"/></g>`
    + `<text x="40" y="226" font-size="46" font-weight="800" fill="#fff" font-family="Arial, Helvetica, sans-serif">Jogos de hoje</text>`
    + `<text x="42" y="272" font-size="28" font-weight="600" fill="#fff" fill-opacity=".88" font-family="Arial, Helvetica, sans-serif">${xml(sub)}</text>`
    + (total && !falhou ? `<text x="42" y="330" font-size="24" font-weight="700" fill="#fff" fill-opacity=".95" font-family="Arial, Helvetica, sans-serif">Ver todos  ›</text>` : "")
    + `</g><rect x="9" y="9" width="${W - 18}" height="${H - 18}" rx="0" fill="none" stroke="${TEMA === "onix" ? "#D6B25E" : "#fff"}" stroke-opacity="${TEMA === "onix" ? ".7" : ".35"}" stroke-width="2"/></svg>`;
}
const resumoImg = (total: number, vivos: number, falhou: boolean) => `${SELF()}?${q({ a: "jr", n: total, vv: vivos, x: falhou ? 1 : 0, ...(TEMA !== "classico" ? { th: TEMA } : {}) })}`;

async function home(t: string, quemTxt: string, d: string | null = null, escolher = false) {
  // TV que escolheu a interface nova: abre direto (com botões de reserva caso a abertura automática não aconteça)
  if (d && (await temaDoAparelho(d)) === "app") {
    const link = `link:${APP_NOVO}?${q({ t, api: SELF(), d })}`;
    return { type: "pages", transparent: 2, ready: { action: link }, background: FUNDO_CFG || IMG + "bg-tv.jpg", pages: [{ items: [
      camadaFundo("bg-tv.jpg"),
      { type: "space", layout: "4,0,4,2", image: LOGO, imageFiller: "fit" },
      { type: "default", layout: "3,3,6,1", color: VID.ouro, title: "Abrir o Gold Play", titleFooter: "Interface nova", alignment: "center", action: link, focus: true },
      { type: "default", layout: "3,4,6,1", color: VID.n, title: "Usar o visual clássico", titleFooter: "Volta para as telas antigas nesta TV", alignment: "center", action: go({ a: "tema", t, v: "", d }) },
    ] }] };
  }
  const [usuario] = quemTxt.split(" · ");
  const cred = await lerToken(t);
  const linhas = cred ? await perfisDe(cred.u) : [];
  // com 2 perfis ou mais, ao abrir o app pergunta quem está assistindo
  if (cred && escolher && linhas.length >= 2) return await telaPerfis(cred, t, d);
  const perfil = cred && linhas.length ? linhas.find((x) => x.id === (cred.pf || "p0")) ?? null : null;
  const [jogos, vence0, hist] = await Promise.all([jogosDoDia(), venceDe(usuario), cred ? historicoDe(quem(cred), ["filme", "ep", "live"], 60) : Promise.resolve([] as Hist[])]);
  // vencimento: perto do fim, confere de novo no provedor (pode já ter renovado)
  let vence = vence0;
  const diasPara = (ms: number) => Math.ceil((ms - Date.now()) / 86400000);
  if (cred && vence !== null && diasPara(vence) <= AVISO_DIAS) {
    try {
      const i = await api(cred);
      const exp = Number(i?.user_info?.exp_date);
      if (Number.isFinite(exp) && exp > 0) { vence = exp * 1000; await salvarVence(usuario, i); }
    } catch (e) { if (e instanceof RelayNeed) throw e; }
  }
  const cont = cred ? await contagemDe(cred.u) : null;
  const qtd = cont?.v ?? {};
  const velho = cred && (!cont || Date.now() - cont.t > 6 * 3600_000);
  if (cred && velho) {
    const er = (globalThis as any).EdgeRuntime;
    const tarefa = Promise.all((["live", "vod", "series"] as const).map((k) => catalogoBusca(cred, k).catch(() => null)));
    if (er?.waitUntil) er.waitUntil(tarefa);
  }
  const selo = (_n?: number) => ({});
  // quantidade escrita no canto inferior direito do cartão
  const qtdTxt = (x: number, n?: number) => (fmtQtd(n) ? [{ type: "space", layout: `${x},1,4,3`, offset: "0,1.95,-0.45,-1.95", alignment: "right", enable: false, text: `{col:${TEMA === "onix" ? "msx-yellow" : "msx-white"}}${fmtQtd(n)}` }] : []);
  // blocos ao lado do Jogos de hoje: Guia de Programação e Continuar assistindo
  const ult = cred ? hist.find((h) => h.tipo !== "live" && emAndamento(h)) : undefined;
  const blocosHome: any[] = [
    { type: "default", layout: "4,4,4,2", color: "transparent", imageFiller: "fit", action: go({ a: "guiahome", t }),
      image: blocoImg({ t: "Guia de Programação", a1: "Veja o que está passando agora", i: "live" }) },
  ];
  const nCapas = new Set(hist.filter((h) => h.tipo !== "live" && emAndamento(h) && h.icone).map((h) => h.icone)).size;
  if (cred && ult) {
    const pct = ult.dur ? Math.round((ult.pos / ult.dur) * 100) : 0;
    const ic = itemContinuar(ult, cred, t) as any;
    // com vários em andamento, o card abre a lista para escolher; com um só, continua direto
    blocosHome.push({ ...ic, ...(nCapas >= 2 ? { action: go({ a: "continuar", t }), playerLabel: undefined, properties: undefined } : {}), title: undefined, titleFooter: undefined, type: "default", layout: "8,4,4,2", color: "transparent", imageFiller: "fit",
      image: blocoImg({ t: "Continuar assistindo", a2: nCapas >= 2 ? `${nCapas} em andamento` : `${pct ? pct + "% · " : ""}parou em ${fmtTempo(ult.pos)}`, p: nCapas >= 2 ? 0 : pct, i: ult.tipo === "ep" ? "series" : "movie", c: ult.icone ? 1 : 0 }) });
    const capa = nCapas >= 2 ? `${SELF()}?${q({ a: "capas", v: 2, t, th: TEMA, h: Math.floor(Date.now() / 600_000) })}` : ult.icone;
    if (capa) blocosHome.push({ type: "space", layout: "8,4,4,2", offset: "2.3,0.16,-2.72,-0.36", image: capa, imageFiller: "fit", enable: false });
  } else {
    blocosHome.push({ type: "default", layout: "8,4,4,2", color: "transparent", imageFiller: "fit", action: go({ a: "cats", k: "vod", t }),
      image: blocoImg({ t: "Continuar assistindo", a1: "Nada começado ainda", a2: "Escolha um filme ou série", i: "movie" }) });
  }
  const dias = vence !== null ? diasPara(vence) : null;
  const dataVence = vence !== null ? new Date(vence).toLocaleDateString("pt-BR", { timeZone: "America/Fortaleza" }) : "";
  const renovar = CONTATO ? `{br}{col:msx-white}Renove: ${CONTATO}` : "{br}{col:msx-white-soft}Fale com seu revendedor";
  const subtitulo = dias === null ? "{col:msx-white-soft}Bom te ver por aqui"
    : dias <= 0 ? `{col:msx-red}Seu plano venceu${renovar}`
    : dias <= AVISO_DIAS ? `{col:msx-yellow}Seu plano vence em ${dias} dia${dias > 1 ? "s" : ""}${renovar}`
    : `{col:msx-white-soft}Plano ativo · vence ${dataVence}`;
  const lst = jogos ?? [];
  const vivos = lst.filter((j) => j.estado === "in").length;
  const todos = go({ a: "jogos", t });
  const card = (layout: string, img: string, acao: string, extra: Record<string, unknown> = {}) =>
    ({ type: "default", layout, image: im(img), imageFiller: "fit", color: "transparent", action: acao, ...extra });
  // cartões dos jogos: logo de cada time (da API) posta por cima do disco branco do cartão
  const destaques: any[] = [];
  [].forEach((j: Jogo, i: number) => {
    const x = 4 + i * 4, lg = (j.casa.logo ? "h" : "") + (j.fora.logo ? "f" : "");
    destaques.push({ type: "default", layout: `${x},4,4,2`, image: jogoImg(j, lg), imageFiller: "fit", color: "transparent", action: jogoAcao(j, t) });
    const logo = (url: string, dy: number) => ({ type: "space", layout: `${x},4,1,1`, offset: `0.5,${dy},-0.675,-0.711`, image: url, imageFiller: "fit", enable: false });
    if (j.casa.logo) destaques.push(logo(j.casa.logo, 0.678));
    if (j.fora.logo) destaques.push(logo(j.fora.logo, 1.15));
  });
  if (TEMA === "moderno") {
    const mac = (await tvDoAparelho(d))?.mac ?? "";
    const n = (v: number | undefined, un: string) => (fmtQtd(v) ? `${fmtQtd(v)} ${un}` : "");
    const bt = (x: number, i: string, acao: string) => ({ type: "default", layout: `${x},0,1,1`, offset: "0.12,0.1,-0.24,-0.2", image: mt({ k: "btn", i }), imageFiller: "fit", color: "transparent", action: acao });
    const tile = (x: number, i: string, t0: string, s0: string, acao: string, extra: Record<string, unknown> = {}) =>
      ({ type: "default", layout: `${x},1,3,3`, offset: "0.06,0.35,-0.12,-0.7", image: mt({ k: "tile", i, t: t0, s: s0 }), imageFiller: "fit", color: "transparent", action: acao, ...extra });
    const pill = (x: number, i: string, t0: string, s0: string, acao: string) =>
      ({ type: "default", layout: `${x},4,4,1`, offset: "0.1,0.04,-0.2,-0.08", color: VID.n, icon: i, iconSize: "large", title: t0, titleFooter: s0, truncation: "title|titleFooter", action: acao });
    const fundoM = mt({ k: "bg" });
    return {
      type: "pages", transparent: 2, ready: { action: "quiet" }, background: fundoM,
      pages: [{ items: [
        { type: "space", layout: "0,0,12,6", offset: "-1,-1,2,2", image: fundoM, imageFiller: "cover", enable: false },
        { type: "space", layout: "0,0,2,1", image: LOGO, imageFiller: "fit" },
        { type: "default", layout: "2,0,6,1", color: "transparent", image: perfil ? avatar(perfil) : undefined, imageWidth: perfil ? 1 : undefined, imageFiller: "fit",
          title: `Olá, ${perfil?.nome ?? usuario}`, titleFooter: subtitulo.replace("{br}", "  ·  "), truncation: "titleFooter",
          action: go(d ? { a: "perfis", t, d } : { a: "perfis", t }) },
        bt(8, "search", abrirBusca(t, "")),
        bt(9, "settings", go(d ? { a: "config", t, d } : { a: "config", t })),
        bt(10, "refresh", go(d ? { a: "inicio", d, x: Date.now() } : { a: "inicio", x: Date.now() })),
        bt(11, "logout", d ? `content:request:interaction:sair@${PLUGIN}` : go({ a: "inicio" })),
        tile(0, "live", "TV ao vivo", n(qtd.live, "canais"), go({ a: "cats", k: "live", t }), { id: "tv", focus: true }),
        tile(3, "movie", "Filmes", n(qtd.vod, "títulos"), go({ a: "itens", k: "vod", t, c: "", cn: "" })),
        tile(6, "series", "Séries", n(qtd.series, "títulos"), go({ a: "itens", k: "series", t, c: "", cn: "" })),
        tile(9, "bolt", "Jogos de hoje", jogos === null ? "Placar indisponível" : lst.length ? `${lst.length} jogos${vivos ? ` · ${vivos} ao vivo` : ""}` : "Nenhuma partida hoje", lst.length ? todos : "none"),
        pill(0, "play-circle-outline", "Continuar assistindo", ult ? "Continue de onde parou" : "Nada começado ainda", ult ? go({ a: "continuar", t }) : go({ a: "cats", k: "vod", t })),
        pill(4, "view-list", "Guia de programação", "O que está passando agora", go({ a: "guiahome", t })),
        pill(8, "star", "Favoritos", "Seus canais favoritos", go({ a: "itens", k: "live", t, c: "fav", cn: "FAVORITOS" })),
        { type: "space", layout: "0,5,6,1", offset: "0.2,0.1,0,-0.1", text: mac ? `{col:msx-white-soft}Número do MAC: {col:msx-white}${mac}` : "" },
        { type: "space", layout: "6,5,6,1", offset: "0,0.1,-0.2,-0.1", alignment: "right", text: `{col:msx-white-soft}${usuario}` },
      ] }, ...paginaContinuar(hist, cred, t)],
    };
  }
  return {
    type: "pages", transparent: 2, ready: { action: "quiet" }, background: FUNDO_CFG || im("bg-tv.jpg"),
    pages: [{ items: [
      camadaFundo("bg-tv.jpg"),
      { type: "space", layout: "0,0,2,1", image: LOGO, imageFiller: "fit" },
      // saudação com o perfil: OK abre "Quem está assistindo?" (trocar ou criar perfis)
      { type: "default", layout: "2,0,3,1", color: "transparent", image: perfil ? avatar(perfil) : undefined, imageWidth: perfil ? 1 : undefined, imageFiller: "fit",
        title: `Olá, ${perfil?.nome ?? usuario}`, titleFooter: subtitulo.replace("{br}", "  ·  "), truncation: "titleFooter",
        action: go(d ? { a: "perfis", t, d } : { a: "perfis", t }) },
      // Pesquisar em tudo (canais, filmes e séries)
      card("5,0,1,1", "btn-lupa.png", abrirBusca(t, "")),
      card("6,0,2,1", "btn-config.png", go(d ? { a: "config", t, d } : { a: "config", t })),
      // Atualizar: recarrega a configuração do painel e a tela inicial (limpa os caches do servidor e da TV)
      card("8,0,2,1", "btn-atualizar.png", go(d ? { a: "inicio", d, x: Date.now() } : { a: "inicio", x: Date.now() }), ),
      card("10,0,2,1", "btn-sair.png", d ? `content:request:interaction:sair@${PLUGIN}` : go({ a: "inicio" })),
      card("0,1,4,3", "card-tv.png", go({ a: "cats", k: "live", t }), { id: "tv", focus: true, ...selo(qtd.live) }),
      card("4,1,4,3", "card-filmes.png", go({ a: "cats", k: "vod", t }), selo(qtd.vod)),
      card("8,1,4,3", "card-series.png", go({ a: "cats", k: "series", t }), selo(qtd.series)),
      ...qtdTxt(0, qtd.live), ...qtdTxt(4, qtd.vod), ...qtdTxt(8, qtd.series),
      { type: "default", layout: "0,4,4,2", image: `${SELF()}?${q({ a: "jgif", d: diaLocal(), h: Math.floor(Date.now() / 1800_000), th: TEMA })}`, imageFiller: "fit", color: "transparent", action: lst.length ? todos : "[]" },
      { type: "space", layout: "0,4,4,2", offset: "0,1.08,0,-1.12", alignment: "center", enable: false,
        text: (jogos === null ? "{col:msx-white-soft}Placar indisponível agora" : lst.length ? `{col:msx-white}${lst.length} jogos hoje${vivos ? `  |  {col:${TEMA === "onix" ? "msx-yellow" : "msx-red"}}${vivos} ao vivo{col:msx-white}` : ""}{br}{col:msx-white-soft}Ver todos  ›` : "{col:msx-white-soft}Nenhuma partida hoje") },
      ...destaques,
      ...blocosHome,
    ] }, ...paginaContinuar(hist, cred, t)],
  };
}
// 2ª página da tela inicial (à direita): Continuar assistindo e Últimos canais
function paginaContinuar(hist: Hist[], cred: Cred | null, t: string) {
  if (!cred) return [];
  const vod = hist.filter((h) => h.tipo !== "live" && emAndamento(h)).slice(0, 6);
  const canais = hist.filter((h) => h.tipo === "live").slice(0, 6);
  if (!vod.length && !canais.length) return [];
  const itens: any[] = [camadaFundo("bg-tv.jpg")];
  let y = 0;
  if (vod.length) {
    itens.push({ type: "space", layout: "0,0,12,1", headline: "Continuar assistindo", text: "{col:msx-white-soft}De onde você parou" });
    vod.forEach((h, i) => itens.push({ ...itemContinuar(h, cred, t), type: "default", layout: `${i * 2},1,2,3` }));
    y = 4;
  }
  if (canais.length) {
    itens.push({ type: "space", layout: `0,${y},12,1`, headline: "Últimos canais", ...(y ? { offset: "0,0.15,0,0" } : {}) });
    canais.forEach((h, i) => itens.push({
      ...canalItem({ name: h.nome, stream_id: h.item_id, stream_icon: h.icone || undefined, category_id: h.extra?.c ?? "" }, cred, t, String(h.extra?.c ?? ""), false),
      type: "default", layout: `${i * 2},${y + 1},2,1`, enumerate: false,
    }));
  }
  return [{ items: itens }];
}

// últimos canais vistos, no formato da lista de canais do provedor
async function ultimosCanais(u: string) {
  return (await historicoDe(u, ["live"], 40)).map((h) => ({ name: h.nome, stream_id: h.item_id, stream_icon: h.icone || undefined, category_id: h.extra?.c ?? "" }));
}

// ---------- Controle parental (senha da conta, padrão 0000) ----------
type ContaCfg = { pin: string; parental: boolean };
const _conta = new Map<string, { t: number; v: ContaCfg }>();
async function contaCfg(u: string): Promise<ContaCfg> {
  const c = _conta.get(u);
  if (c && Date.now() - c.t < 30_000) return c.v;
  let v: ContaCfg = { pin: "0000", parental: true };
  try {
    const r = await fetch(`${SB()}/rest/v1/conta_cfg?usuario=eq.${encodeURIComponent(u)}&select=pin,parental&limit=1`, { headers: sbh(), signal: AbortSignal.timeout(4000) });
    const j = await r.json();
    if (Array.isArray(j) && j[0]) v = { pin: String(j[0].pin || "0000"), parental: j[0].parental !== false };
  } catch { /* padrão: ligado, 0000 */ }
  _conta.set(u, { t: Date.now(), v });
  return v;
}
async function salvarConta(u: string, campos: Partial<ContaCfg>) {
  const atual = await contaCfg(u);
  const novo = { ...atual, ...campos };
  await fetch(`${SB()}/rest/v1/conta_cfg?on_conflict=usuario`, { method: "POST", headers: { ...sbh(), prefer: "resolution=merge-duplicates" }, body: JSON.stringify({ usuario: u, pin: novo.pin, parental: novo.parental, atualizado: new Date().toISOString() }), signal: AbortSignal.timeout(4000) });
  _conta.set(u, { t: Date.now(), v: novo });
}
const RE_ADULTO = /(^|[^a-z])(adult[oa]?s?|xxx|porn\w*|erotic\w*|sexo|sexy|hentai)([^a-z]|$)|\+ ?18|18 ?\+/;
const ehAdulto = (nome: string) => RE_ADULTO.test(semAcento(String(nome ?? "")));
const CATS_ACAO: Record<string, string> = { live: "get_live_categories", vod: "get_vod_categories", series: "get_series_categories" };
const _catsAdultas = new Map<string, { t: number; v: Set<string> }>();
async function catsAdultas(cred: Cred, k: string): Promise<Set<string>> {
  const ch = `${cred.u}|${k}`;
  const c = _catsAdultas.get(ch);
  if (c && Date.now() - c.t < 10 * 60_000) return c.v;
  const lst = await api(cred, `&action=${CATS_ACAO[k]}`);
  const v = new Set<string>(((Array.isArray(lst) ? lst : []) as any[]).filter((x) => ehAdulto(String(x.category_name))).map((x) => String(x.category_id)));
  _catsAdultas.set(ch, { t: Date.now(), v });
  return v;
}
// o que fica escondido/protegido para esta sessão: perfil infantil esconde; com o controle ligado, pede a senha
async function regraAdulto(cred: Cred) {
  const [cfg, pf] = await Promise.all([contaCfg(cred.u), perfilAtual(cred)]);
  return { infantil: !!pf?.infantil, protege: cfg.parental || !!pf?.infantil, pin: cfg.pin };
}
// filtro para listas "Todos", pesquisa e recentes: tira itens de categorias adultas quando protegido
async function filtroAdulto(cred: Cred, k: string): Promise<(cat: string, k: string) => boolean> {
  const r = await regraAdulto(cred);
  if (!r.protege) return () => false;
  const tipos = k === "live" || k === "vod" || k === "series" ? [k] : ["live", "vod", "series"];
  const sets: Record<string, Set<string>> = {};
  await Promise.all(tipos.map(async (tp) => { sets[tp] = await catsAdultas(cred, tp); }));
  return (cat: string, kk: string) => !!sets[kk]?.has(String(cat));
}
// chave que libera uma categoria adulta (vale para este token, esta categoria e a senha atual)
async function chaveAdulto(t: string, c: string, pin: string) {
  const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`adulto|${t}|${c}|${pin}|${SBK()}`));
  return b64(new Uint8Array(h)).slice(0, 16);
}
const pedirSenha = (destino: Record<string, string | number>, titulo = "Controle parental") =>
  inputAction(`${SELF()}?${q({ a: "pin", ...destino })}&v={INPUT}`, titulo, "Digite a senha de 4 dígitos");

// ---------- Perfis (estilo Netflix) ----------
type Perfil = { id: string; nome: string; cor: number; infantil: boolean };
const CORES_PERFIL = [["#7C5CFF", "#3B82F6"], ["#F43F8E", "#F59E0B"], ["#10B981", "#06B6D4"], ["#F97316", "#EF4444"], ["#8B5CF6", "#EC4899"], ["#0EA5E9", "#22D3EE"]];
const _perfis = new Map<string, { t: number; v: Perfil[] }>();
async function perfisDe(u: string): Promise<Perfil[]> {
  const c = _perfis.get(u);
  if (c && Date.now() - c.t < 20_000) return c.v;
  let v: Perfil[] = [];
  try {
    const r = await fetch(`${SB()}/rest/v1/perfis_app?usuario=eq.${encodeURIComponent(u)}&select=id,nome,cor,infantil&order=criado`, { headers: sbh(), signal: AbortSignal.timeout(4000) });
    const j = await r.json();
    if (Array.isArray(j)) v = j.map((x) => ({ id: String(x.id), nome: String(x.nome), cor: Number(x.cor) || 0, infantil: !!x.infantil }));
  } catch { /* sem perfis */ }
  _perfis.set(u, { t: Date.now(), v });
  return v;
}
// sem perfis cadastrados, existe só o "Principal" (p0), dono dos dados antigos
async function listaPerfis(u: string): Promise<Perfil[]> {
  const v = await perfisDe(u);
  return v.length ? v : [{ id: "p0", nome: "Principal", cor: 0, infantil: false }];
}
async function perfilAtual(cred: Cred): Promise<Perfil | null> {
  const v = await listaPerfis(cred.u);
  return v.find((x) => x.id === (cred.pf || "p0")) ?? v[0] ?? null;
}
async function gravarPerfil(u: string, p: Perfil) {
  await fetch(`${SB()}/rest/v1/perfis_app?on_conflict=usuario,id`, { method: "POST", headers: { ...sbh(), prefer: "resolution=merge-duplicates" }, body: JSON.stringify({ usuario: u, id: p.id, nome: p.nome, cor: p.cor, infantil: p.infantil }), signal: AbortSignal.timeout(4000) });
  _perfis.delete(u);
}
async function apagarPerfil(u: string, id: string) {
  const dono = `${u}#${id}`;
  await Promise.all([
    fetch(`${SB()}/rest/v1/perfis_app?usuario=eq.${encodeURIComponent(u)}&id=eq.${encodeURIComponent(id)}`, { method: "DELETE", headers: sbh(), signal: AbortSignal.timeout(4000) }),
    fetch(`${REST_FAV()}?usuario=eq.${encodeURIComponent(dono)}`, { method: "DELETE", headers: cab(), signal: AbortSignal.timeout(4000) }),
    fetch(`${REST_HIST()}?usuario=eq.${encodeURIComponent(dono)}`, { method: "DELETE", headers: cab(), signal: AbortSignal.timeout(4000) }),
  ]).catch(() => {});
  _perfis.delete(u);
}
const avatar = (p: Perfil) => `${SELF()}?${q({ a: "av", n: p.nome.slice(0, 20), c: p.cor % CORES_PERFIL.length, k: p.infantil ? 1 : 0 })}`;
function avatarSvg(nome: string, cor: number, infantil: boolean) {
  const [c1, c2] = CORES_PERFIL[Math.abs(cor) % CORES_PERFIL.length];
  const letra = xml((limparNome(nome).charAt(0) || "?").toUpperCase());
  return `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400" viewBox="0 0 400 400"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient></defs>`
    + `<rect x="10" y="10" width="380" height="380" rx="70" fill="url(#g)"/><circle cx="330" cy="70" r="120" fill="#fff" fill-opacity=".12"/>`
    + `<text x="200" y="262" text-anchor="middle" font-size="190" font-weight="800" fill="#fff" font-family="Arial, Helvetica, sans-serif">${letra}</text>`
    + (infantil ? `<rect x="110" y="318" width="180" height="50" rx="25" fill="#000" fill-opacity=".35"/><text x="200" y="352" text-anchor="middle" font-size="28" font-weight="800" fill="#fff" font-family="Arial, Helvetica, sans-serif">INFANTIL</text>` : "")
    + `</svg>`;
}
// "Quem está assistindo?"
async function telaPerfis(cred: Cred, t: string, d: string | null) {
  const v = await listaPerfis(cred.u);
  const n = v.length + (v.length < 5 ? 1 : 0);
  const x0 = Math.max(0, Math.floor((12 - n * 2) / 2));
  const base = (o: Record<string, string>) => (d ? { ...o, d } : o);
  const itens: any[] = [
    camadaFundo("bg-tv.jpg"),
    { type: "space", layout: "0,0,12,1", offset: "0,0.4,0,0", alignment: "center", centration: "text", headline: "Quem está assistindo?" },
    ...v.map((p, i) => ({
      type: "default", layout: `${x0 + i * 2},2,2,2`, image: avatar(p), imageFiller: "fit", color: "transparent",
      title: p.nome, alignment: "center", action: go(base({ a: "perfil", t, pf: p.id })), ...(p.id === (cred.pf || "p0") ? { focus: true } : {}),
    })),
  ];
  if (v.length < 5) itens.push({ type: "default", layout: `${x0 + v.length * 2},2,2,2`, color: VID.n, icon: "add", iconSize: "large", title: "Adicionar", alignment: "center",
    action: inputAction(`${SELF()}?${q(base({ a: "perfilnovo", t }))}&v={INPUT}`, "Novo perfil", "Digite o nome e confirme") });
  if (d) itens.push({ type: "default", layout: "4,4,4,1", color: VID.n, title: "{ico:people}  Trocar de usuário", titleFooter: "Contas salvas nesta TV: entre com um toque", action: go({ a: "contas", d, cu: cred.u }) });
  itens.push({ type: "default", layout: "4,5,4,1", color: VID.n, title: "{ico:settings}  Gerenciar perfis", titleFooter: "Nomes, infantil e controle parental", action: go(base({ a: "perfisger", t })) });
  return { type: "pages", transparent: 2, ready: { action: "quiet" }, background: FUNDO_CFG || im("bg-tv.jpg"), pages: [{ items: itens }] };
}
async function telaGerenciar(cred: Cred, t: string, d: string | null) {
  const [v, cfg] = await Promise.all([listaPerfis(cred.u), contaCfg(cred.u)]);
  const base = (o: Record<string, string>) => (d ? { ...o, d } : o);
  const itens: any[] = v.map((p) => ({
    title: p.nome, titleFooter: p.infantil ? "Perfil infantil" : "Perfil normal", image: avatar(p), imageWidth: 1, imageFiller: "fit", color: VID.n,
    action: go(base({ a: "perfiledit", t, id: p.id })),
  }));
  itens.push(
    { title: `{ico:lock}  Controle parental: ${cfg.parental ? "Ligado" : "Desligado"}`, titleFooter: cfg.parental ? "Categorias adultas pedem senha" : "Categorias adultas abrem direto", color: VID.voltar,
      action: pedirSenha(base({ t, op: "parental" }), cfg.parental ? "Desligar o controle parental" : "Ligar o controle parental") },
    { title: "{ico:vpn-key}  Trocar a senha", titleFooter: "Senha padrão: 0000", color: VID.voltar, action: pedirSenha(base({ t, op: "senha1" }), "Senha atual") },
  );
  return lista("Gerenciar perfis", itens, "0,0,6,1", {}, `${v.length} perfil${v.length > 1 ? "s" : ""}`);
}
async function telaPerfilEdit(cred: Cred, t: string, d: string | null, id: string) {
  const p = (await listaPerfis(cred.u)).find((x) => x.id === id);
  if (!p) return aviso("Perfil", "Perfil não encontrado.");
  const base = (o: Record<string, string>) => (d ? { ...o, d } : o);
  const itens: any[] = [
    { title: "{ico:edit}  Mudar o nome", titleFooter: p.nome, color: VID.n, action: inputAction(`${SELF()}?${q(base({ a: "perfilnome", t, id }))}&v={INPUT}`, "Nome do perfil", "Digite o novo nome") },
    { title: "{ico:palette}  Trocar a cor", titleFooter: "Muda a cor do avatar", color: VID.n, action: go(base({ a: "perfilcor", t, id })) },
    // tirar o perfil do modo infantil pede a senha
    { title: `{ico:child-care}  Infantil: ${p.infantil ? "Sim" : "Não"}`, titleFooter: p.infantil ? "Esconde categorias adultas" : "Perfil sem restrição extra", color: VID.n,
      action: p.infantil ? pedirSenha(base({ t, op: "infantil", id }), "Tirar do modo infantil") : go(base({ a: "perfilinf", t, id, v: "1" })) },
  ];
  if (id !== "p0") itens.push({ title: "{ico:delete}  Excluir perfil", titleFooter: "Apaga também os favoritos e o histórico dele", color: VID.voltar, action: go(base({ a: "perfildel", t, id })) });
  return lista(`Perfil: ${p.nome}`, itens, "0,0,6,1");
}

// ---------- Guia de programação completo de um canal ----------
async function telaGuia(cred: Cred, t: string, s: string, nome: string, voltar: string) {
  let progs: { titulo: string; desc: string; ini: number; fim: number }[] = [];
  try {
    const j = await api(cred, `&action=get_short_epg&stream_id=${encodeURIComponent(s)}&limit=60`);
    progs = ((Array.isArray(j?.epg_listings) ? j.epg_listings : []) as any[])
      .map((x) => ({ titulo: txtMsx(b64txt(x.title)), desc: txtMsx(b64txt(x.description)), ini: Number(x.start_timestamp) * 1000, fim: Number(x.stop_timestamp) * 1000 }))
      .filter((x) => x.titulo && x.fim > Date.now() - 60_000)
      .sort((a, b) => a.ini - b.ini);
  } catch (e) { if (e instanceof RelayNeed) throw e; }
  const dia = (ms: number) => new Date(ms).toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", timeZone: "America/Fortaleza" });
  const hoje = dia(Date.now());
  const itens: any[] = [{ title: "‹   CANAIS", titleFooter: `Voltar para a lista`, color: VID.voltar, action: voltar }];
  progs.forEach((x) => {
    const agora = x.ini <= Date.now() && x.fim > Date.now();
    const d = dia(x.ini);
    itens.push({
      title: `${agora ? "{col:msx-yellow}AGORA{col:msx-white}  " : ""}${fmtHora(x.ini)} – ${fmtHora(x.fim)}${d !== hoje ? `  (${d})` : ""}   ${x.titulo}`,
      titleFooter: x.desc ? (x.desc.length > 110 ? x.desc.slice(0, 107) + "…" : x.desc) : " ", truncation: "title|titleFooter",
      color: agora ? VID.ouro : VID.n, action: "[]", ...(agora ? { focus: true } : {}),
    });
  });
  if (!progs.length) itens.push({ title: "Sem programação disponível para este canal", action: "[]" });
  return { type: "list", transparent: 2, headline: `Guia · ${nome}`, extension: progs.length ? `${progs.length} programas` : "", template: { type: "default", layout: "0,0,8,1", color: COR.vidro }, items: itens };
}

// ---------- Filmes e séries: cartões, detalhes, episódios e Continuar assistindo ----------
// favoritado: coração vermelho no canto superior direito (no lugar da nota)
const seloFav = (fav: boolean, n?: string) => (fav ? { tag: "♥", tagColor: "msx-red" } : { tag: n, tagColor: COR.destaque });
const cartaoFilme = (x: any, t: string, favs?: Set<string>) => {
  const nome = limparNome(String(x.name));
  return {
    title: x.stream_icon ? undefined : nome, image: x.stream_icon || cartao("vod", nome, "Filme", "movie", true), imageFiller: "cover", color: COR.vidro, wrapperColor: COR.vidro,
    ...seloFav(!!favs?.has(String(x.stream_id)), nota(x.rating)), action: go({ a: "filme", t, s: x.stream_id }),
  };
};
const cartaoSerie = (x: any, t: string, favs?: Set<string>) => {
  const nome = limparNome(String(x.name));
  return {
    title: x.cover ? undefined : nome, image: x.cover || cartao("series", nome, "Série", "series", true), imageFiller: "cover", color: COR.vidro, wrapperColor: COR.vidro,
    ...seloFav(!!favs?.has(String(x.series_id ?? x.stream_id)), nota(x.rating)), action: go({ a: "serie", t, s: x.series_id ?? x.stream_id }),
  };
};
// troca a tela de detalhes por ela mesma atualizada (favoritar), sem criar entrada no "voltar"
const rpDet = (o: Record<string, string | number>) => RC()?.cap && RC()?.relay
  ? `replace:content:det:request:interaction:${q({ ...o, rl: 1 })}@${PLUGIN}`
  : `replace:content:det:${SELF()}?${q(o)}`;
// distribui os botões na faixa de 9 colunas à direita da capa (o primeiro é maior)
function arrumarBotoes(bs: any[], y: number) {
  const resto = bs.length > 1 ? Math.floor(6 / (bs.length - 1)) : 0;
  let x = 3;
  bs.forEach((b, i) => { const w = i === 0 ? (bs.length > 1 ? 3 : 4) : Math.max(2, resto); b.layout = `${x},${y},${w},1`; x += w; });
  return bs;
}
// ordem das listas de filmes/séries: padrão do provedor → recentes → nota → A–Z
// ---------- API em JSON para a interface própria (msx/app): mesma sessão e o mesmo relay das telas do MSX ----------
const _appCache = new Map<string, { em: number; v: unknown }>();
const _homeCache = new Map<string, { em: number; v: any }>();
async function listaApp(cred: Cred, acao: string, minutos = 10): Promise<any[]> {
  const k = `${cred.u}|${acao}`, c = _appCache.get(k);
  if (c && Date.now() - c.em < minutos * 60_000) return c.v as any[];
  const d = await api(cred, `&action=${acao}`);
  const v = Array.isArray(d) ? d : [];
  if (_appCache.size > 80) _appCache.clear();
  _appCache.set(k, { em: Date.now(), v });
  return v;
}
// várias buscas ao provedor de uma vez: no relay, junta todos os pedidos numa só ida à TV
async function juntos<T>(ps: Promise<T>[]): Promise<(T | null)[]> {
  const r = await Promise.allSettled(ps);
  if (r.some((x) => x.status === "rejected" && x.reason instanceof RelayNeed)) throw new RelayNeed();
  return r.map((x) => (x.status === "fulfilled" ? x.value : null));
}
const txtApp = (v: unknown, max = 600) => { const t = String(v ?? "").replace(/\s+/g, " ").trim(); return t.length > max ? t.slice(0, max - 1) + "…" : t; };
const duracaoApp = (inf: any) => inf?.duration_secs ? Number(inf.duration_secs) : /^\d+$/.test(String(inf?.duration ?? "").trim()) ? Number(inf.duration) * 60 : /^\d+:\d+/.test(String(inf?.duration ?? "")) ? String(inf.duration).split(":").map(Number).reduce((a: number, b: number) => a * 60 + b, 0) : 0;
const itemVod = (x: any) => ({ id: String(x.stream_id), nome: limparNome(String(x.name ?? "")), img: String(x.stream_icon || ""), r: nota(x.rating) ?? "", x: String(x.container_extension || "mp4") });
const itemSerie = (x: any) => ({ id: String(x.series_id), nome: limparNome(String(x.name ?? "")), img: String(x.cover || ""), r: nota(x.rating) ?? "" });
// ---------- login da interface própria (sem sessão): QR code, código do celular, usuário e senha, contas salvas ----------
async function entrarApp(u: string, p: string, d: string | null) {
  if (!u || !p) return { ok: false, erro: "Informe usuário e senha." };
  const x = await infoUsuario(u);
  if (x.bloq) return { ok: false, erro: "Acesso bloqueado. Fale com o suporte." };
  const au = await autenticar(u, p, x.b);
  const cx = RC()!;
  if (!au.ok && cx.need.size && cx.cap) throw new RelayNeed();
  if (!au.ok) return { ok: false, erro: au.erroProv ? "Provedor indisponível. Tente de novo." : "Usuário ou senha incorretos." };
  await registrarAcesso(u, d, "login", "tv", (await tvDoAparelho(d))?.mac ?? null);
  await salvarVence(u, au.info);
  if (au.dnsId) await fixarDnsDoUsuario(u, au.dnsId);
  const tk = await criarToken(u, p);
  await salvarSessao(d, tk); await lembrarConta(d, u, p);
  return { ok: true, t: tk };
}
async function apiLogin(url: URL, d: string | null) {
  const P = url.searchParams, op = P.get("op") ?? "";
  if (!d) return { ok: false, erro: "aparelho" };
  if (op === "codigo") {
    if (P.get("r")) await fetch(`${REST_COD()}?aparelho=eq.${encodeURIComponent(d)}`, { method: "DELETE", headers: cab() }).catch(() => {});
    const [codigo, tv, contas] = await Promise.all([codigoDoAparelho(d), tvDoAparelho(d), contasDe(d)]);
    return { ok: true, codigo, link: codigo ? `${PAGINA_CELULAR}?c=${codigo}` : PAGINA_CELULAR, mac: tv?.mac ?? "", contas };
  }
  if (op === "ver") { // já entrou (pelo celular ou cadastro do painel)?
    const tv = await tvDoAparelho(d);
    if (tv?.bloqueado) return { ok: false, erro: "Esta TV está bloqueada. Fale com o suporte." };
    const tk = await lerSessao(d), cr = await lerToken(tk);
    if (tk && cr && !cr.bloq && (!tv?.usuario || cr.u === tv.usuario)) {
      if (cr.pv) { const rv = await resolverPv(cr, d, tk); return rv ? { ok: true, t: rv.t } : { ok: false, erro: "Usuário ou senha incorretos." }; }
      await registrarAcesso(cr.u, d, "sessao");
      return { ok: true, t: tk };
    }
    if (tv?.usuario && tv.senha_enc) { const senha = await senhaDaTv(tv.senha_enc); if (senha) return await entrarApp(tv.usuario, senha, d); }
    return { ok: false };
  }
  if (op === "entrar") return await entrarApp((P.get("u") ?? "").trim(), P.get("p") ?? "", d);
  if (op === "conta0") { const u = (P.get("u") ?? "").trim(); const p = await senhaSalva(d, u); return p ? await entrarApp(u, p, d) : { ok: false, erro: "Senha salva não encontrada." }; }
  return { ok: false };
}
// ---------- TMDB (imagens, sinopse e elenco em português quando o provedor não tem) ----------
const _tmdb = new Map<string, { em: number; v: any }>();
const TMDB_IMG = "https://image.tmdb.org/t/p/";
async function tmdbGet(caminho: string): Promise<any> {
  const key = (Deno.env.get("TMDB_KEY") ?? Deno.env.get("TMDB_API_KEY") ?? "").trim();
  if (!key) return null;
  const c = _tmdb.get(caminho);
  if (c && Date.now() - c.em < 24 * 3600_000) return c.v;
  const v4 = key.length > 40;
  const url = `https://api.themoviedb.org/3${caminho}${caminho.includes("?") ? "&" : "?"}${v4 ? "" : "api_key=" + encodeURIComponent(key)}`;
  try {
    const r = await fetch(url, { headers: v4 ? { authorization: `Bearer ${key}`, accept: "application/json" } : { accept: "application/json" }, signal: AbortSignal.timeout(4500) });
    const v = r.ok ? await r.json() : null;
    if (_tmdb.size > 2000) _tmdb.clear();
    _tmdb.set(caminho, { em: Date.now(), v });
    return v;
  } catch { return null; }
}
// "Duna: Parte 2 (2024) [L] 4K" -> "Duna: Parte 2"
const nomeLimpo = (n: string) => String(n ?? "").replace(/\[[^\]]*\]|\([^)]*\)/g, " ").replace(/\b(4k|uhd|fhd|hd|sd|leg|legendado|dub|dublado|nacional|h265|hevc|cam|ts)\b/gi, " ").replace(/\s*[-|:]\s*$/, "").replace(/\s+/g, " ").trim();
type Extra = { fundo?: string; poster?: string; sin?: string; gen?: string; elenco?: string; nota?: string; ano?: string; trailer?: string };
async function tmdbExtra(tipo: "movie" | "tv", nome: string, ano: string, tmdbId?: unknown): Promise<Extra | null> {
  let id = String(tmdbId ?? "").replace(/\D/g, "");
  if (!id) {
    const q = nomeLimpo(nome); if (!q) return null;
    const busca = await tmdbGet(`/search/${tipo}?language=pt-BR&query=${encodeURIComponent(q)}${/^\d{4}$/.test(ano) ? (tipo === "movie" ? "&year=" : "&first_air_date_year=") + ano : ""}`);
    id = String(busca?.results?.[0]?.id ?? "");
    if (!id && /^\d{4}$/.test(ano)) { const b2 = await tmdbGet(`/search/${tipo}?language=pt-BR&query=${encodeURIComponent(q)}`); id = String(b2?.results?.[0]?.id ?? ""); }
    if (!id) return null;
  }
  const d = await tmdbGet(`/${tipo}/${id}?language=pt-BR&append_to_response=credits,videos`);
  if (!d) return null;
  const trailer = ((d.videos?.results ?? []) as any[]).find((v) => v.site === "YouTube" && v.type === "Trailer")?.key ?? "";
  return {
    fundo: d.backdrop_path ? TMDB_IMG + "w1280" + d.backdrop_path : "", poster: d.poster_path ? TMDB_IMG + "w500" + d.poster_path : "",
    sin: txtApp(d.overview, 900), gen: ((d.genres ?? []) as any[]).map((g) => g.name).slice(0, 3).join(", "),
    elenco: ((d.credits?.cast ?? []) as any[]).slice(0, 6).map((c) => c.name).join(", "), nota: d.vote_average ? Number(d.vote_average).toFixed(1) : "",
    ano: String(d.release_date || d.first_air_date || "").slice(0, 4), trailer,
  };
}
// canais da lista do provedor que passam um jogo (mesma regra da tela de jogo do MSX)
async function canaisDoJogo(cred: Cred, j: Jogo) {
  let cat: Catalogo | null = null;
  try { cat = await catalogoAoVivo(cred); } catch (e) { if (e instanceof RelayNeed) throw e; }
  const chaves = j.canaisLista.map(chaveDoCanal).filter((k) => k.length);
  const cands: { c: CanalProv; nota: number; evento: boolean }[] = [];
  for (const c of cat?.canais ?? []) {
    const evento = !!cat?.evento && c.cat === cat.evento.id;
    const p1 = pontosTime(c, j.casa.nome), p2 = pontosTime(c, j.fora.nome);
    const porCanal = chaves.some((k) => contem(c.tokens, k));
    const nomeaTimes = evento ? p1 + p2 > 0 : p1 > 0 && p2 > 0;
    if (!nomeaTimes && !porCanal) continue;
    cands.push({ c, evento, nota: (nomeaTimes ? (p1 + p2) * 10 : 0) + (porCanal ? 6 : 0) + (evento ? 4 : 0) + c.qual });
  }
  cands.sort((a, b) => b.nota - a.nota);
  const vistos = new Set<string>(), out: { id: string; nome: string; cat: string }[] = [];
  for (const x of cands) { if (vistos.has(x.c.base)) continue; vistos.add(x.c.base); out.push({ id: x.c.id, nome: x.c.nome, cat: cat?.cats.get(x.c.cat) ?? "" }); if (out.length >= 5) break; }
  return { canais: out, evento: cat?.evento ?? null };
}
async function apiApp(cred: Cred, url: URL) {
  const P = url.searchParams, op = P.get("op") ?? "", k = P.get("k") ?? "live", c = P.get("c") ?? "", s = P.get("s") ?? "";
  const ACT: Record<string, [string, string]> = { live: ["get_live_categories", "get_live_streams"], vod: ["get_vod_categories", "get_vod_streams"], series: ["get_series_categories", "get_series"] };
  const A = ACT[k] ?? ACT.live;
  const eu = quem(cred);
  if (op === "cfg") { // modelo dos endereços: a TV monta o link do vídeo sem perguntar ao servidor a cada canal
    const b = cred.b ?? BASE_PROV, uu = encodeURIComponent(cred.u), pp = encodeURIComponent(cred.p);
    const [perfis, vence] = await Promise.all([listaPerfis(cred.u).catch(() => [] as Perfil[]), venceDe(cred.u)]);
    const d0 = P.get("d") ?? "";
    return { ok: true, usuario: cred.u, pf: cred.pf || "p0", perfis: perfis.map((x) => ({ id: x.id, nome: x.nome, cor: x.cor, inf: x.infantil, av: avatar(x) })), vence, contato: CONTATO,
      tpl: { live: `${b}/live/${uu}/${pp}/`, vod: `${b}/movie/${uu}/${pp}/`, series: `${b}/series/${uu}/${pp}/` }, contas: d0 ? await contasDe(d0) : [] };
  }
  if (op === "perfil") { // troca de perfil: novo token (histórico e favoritos são por perfil)
    const pf = P.get("pf") ?? "p0";
    if (!(await listaPerfis(cred.u)).some((x) => x.id === pf)) return { ok: false, erro: "perfil" };
    const novo = await criarToken(cred.u, cred.p, cred.v, false, pf, !!cred.r);
    const dev = idOk(P.get("d"));
    if (dev) await salvarSessao(dev, novo);
    return { ok: true, t: novo };
  }
  if (op === "conta") { // entrar com um usuário salvo nesta TV
    const dev = idOk(P.get("d")), u = (P.get("u") ?? "").trim();
    const p = await senhaSalva(dev, u);
    if (!dev || !u || !p) return { ok: false, erro: "Senha salva não encontrada. Entre de novo pela tela de login." };
    const x = await infoUsuario(u);
    if (x.bloq) return { ok: false, erro: "Acesso bloqueado. Fale com o suporte." };
    const au = await autenticar(u, p, x.b);
    const cx = RC()!;
    if (!au.ok && cx.need.size && cx.cap) throw new RelayNeed();
    if (!au.ok) return { ok: false, erro: au.erroProv ? "Provedor indisponível. Tente de novo." : "Usuário ou senha incorretos." };
    await registrarAcesso(u, dev, "login", "tv", (await tvDoAparelho(dev))?.mac ?? null);
    await salvarVence(u, au.info);
    if (au.dnsId) await fixarDnsDoUsuario(u, au.dnsId);
    const tk = await criarToken(u, p);
    await salvarSessao(dev, tk); await lembrarConta(dev, u, p);
    return { ok: true, t: tk };
  }
  if (op === "tema") { const dev = idOk(P.get("d")); if (dev) await salvarTemaAparelho(dev, (P.get("v") ?? "").slice(0, 20)); return { ok: true }; }
  if (op === "sair") { await apagarSessao(idOk(P.get("d"))); return { ok: true }; }
  if (op === "esquecer") { await esquecerConta(idOk(P.get("d")), (P.get("u") ?? "").trim()); return { ok: true }; }
  if (op === "jogos") {
    const js = (await jogosDoDia(5000)) ?? [];
    return { ok: true, jogos: js.map((j) => ({ liga: j.liga, quando: j.quando, estado: j.estado, status: j.status, canal: j.transmissao, casa: { n: j.casa.nome, s: j.casa.sigla, g: j.casa.gols, l: j.casa.logo, c: j.casa.cor }, fora: { n: j.fora.nome, s: j.fora.sigla, g: j.fora.gols, l: j.fora.logo, c: j.fora.cor } })) };
  }
  if (op === "jogo") {
    const js = (await jogosDoDia(5000)) ?? [];
    const j = js.find((x) => x.casa.nome === (P.get("n1") ?? "") && x.fora.nome === (P.get("n2") ?? ""));
    if (!j) return { ok: false, erro: "Jogo não encontrado" };
    return { ok: true, ...(await canaisDoJogo(cred, j)) };
  }
  if (op === "home") {
    const hc = _homeCache.get(eu);
    if (hc && Date.now() - hc.em < 20 * 60_000 && !P.get("novo")) {
      const hist2 = await historicoDe(eu, ["filme", "ep", "live"], 60);
      return { ...hc.v, continuar: hist2.filter((h) => h.tipo !== "live" && emAndamento(h)).slice(0, 15).map((h) => ({ tp: h.tipo, id: h.item_id, nome: h.nome, img: h.icone, pos: h.pos, dur: h.dur, extra: h.extra })), canais: hist2.filter((h) => h.tipo === "live").slice(0, 15).map((h) => ({ id: h.item_id, nome: h.nome, img: h.icone })) };
    }
    const [l, hist, perfis, vence] = await Promise.all([juntos([listaApp(cred, "get_vod_streams"), listaApp(cred, "get_series")]), historicoDe(eu, ["filme", "ep", "live"], 60), perfisDe(cred.u).catch(() => [] as Perfil[]), venceDe(cred.u)]);
    const vods = (l[0] ?? []) as any[], series = (l[1] ?? []) as any[];
    const regra = await regraAdulto(cred);
    const fv = regra.protege ? await filtroAdulto(cred, "vod") : null, fs = regra.protege ? await filtroAdulto(cred, "series") : null;
    const recV = vods.filter((x) => !fv || !fv(String(x.category_id), "vod")).sort((a, b) => Number(b.added || 0) - Number(a.added || 0)).slice(0, 30);
    const recS = series.filter((x) => !fs || !fs(String(x.category_id), "series")).sort((a, b) => Number(b.last_modified || 0) - Number(a.last_modified || 0)).slice(0, 30);
    const candidatos = recV.filter((x) => x.stream_icon).slice(0, 6);
    const infos = await juntos(candidatos.map((x) => api(cred, `&action=get_vod_info&vod_id=${encodeURIComponent(String(x.stream_id))}`)));
    const extras = await Promise.all(candidatos.map((x, i) => { const inf = (infos[i] as any)?.info ?? {}; return tmdbExtra("movie", String(x.name ?? ""), String(inf.releasedate || inf.release_date || "").slice(0, 4), inf.tmdb_id || inf.tmdb).catch(() => null); }));
    const destaques = candidatos.map((x, i) => {
      const inf = (infos[i] as any)?.info ?? {}, ex = extras[i] ?? {};
      const fundo = ex.fundo || imgOk(inf.backdrop_path) || imgOk(inf.cover_big) || imgOk(inf.movie_image) || String(x.stream_icon);
      return { ...itemVod(x), fundo, ano: String(inf.releasedate || inf.release_date || "").slice(0, 4) || ex.ano || "", gen: txtApp(inf.genre, 60) || ex.gen || "", sin: txtApp(inf.plot || inf.description, 320) || txtApp(ex.sin, 320), dur: duracaoApp(inf), r: nota(inf.rating) ?? ex.nota ?? "" };
    }).filter((d) => d.fundo);
    const perfil = perfis.find((x) => x.id === (cred.pf || "p0")) ?? null;
    const saida = {
      ok: true, usuario: cred.u, perfil: perfil?.nome ?? "", vence,
      destaques, filmes: recV.map(itemVod), series: recS.map(itemSerie),
      continuar: hist.filter((h) => h.tipo !== "live" && emAndamento(h)).slice(0, 15).map((h) => ({ tp: h.tipo, id: h.item_id, nome: h.nome, img: h.icone, pos: h.pos, dur: h.dur, extra: h.extra })),
      canais: hist.filter((h) => h.tipo === "live").slice(0, 15).map((h) => ({ id: h.item_id, nome: h.nome, img: h.icone })),
    };
    if (_homeCache.size > 200) _homeCache.clear();
    _homeCache.set(eu, { em: Date.now(), v: saida });
    return saida;
  }
  if (op === "cats") {
    const [r, regra] = await Promise.all([api(cred, `&action=${A[0]}`), regraAdulto(cred)]);
    const lst = ((Array.isArray(r) ? r : []) as any[]).filter((x) => !(regra.protege && ehAdulto(String(x.category_name))));
    return { ok: true, cats: lst.map((x) => ({ id: String(x.category_id), nome: limparNome(String(x.category_name)) })) };
  }
  if (op === "itens") {
    const regra = await regraAdulto(cred);
    let lst: any[];
    if (c === "fav") lst = k === "live" ? await favoritosDe(eu) : (await favoritosVod(eu, k === "vod" ? "v" : "s")).map((f) => ({ stream_id: f.stream_id, series_id: f.stream_id, name: f.name, stream_icon: f.stream_icon, cover: f.stream_icon }));
    else if (!c) lst = await listaApp(cred, A[1]);
    else lst = ((await api(cred, `&action=${A[1]}&category_id=${encodeURIComponent(c)}`)) ?? []) as any[];
    if (!Array.isArray(lst)) lst = [];
    if (!c && regra.protege) { const f = await filtroAdulto(cred, k); if (f) lst = lst.filter((x) => !f(String(x.category_id), k)); }
    const o = P.get("o") ?? "";
    if (k !== "live" && o) {
      const ck = `${cred.u}|ord|${k}|${c}|${o}|${lst.length}`, oc = _appCache.get(ck);
      if (oc) lst = oc.v as any[];
      else {
        if (o === "rec") lst = [...lst].sort((a, b) => Number(b.added || b.last_modified || 0) - Number(a.added || a.last_modified || 0));
        else if (o === "nota") lst = [...lst].sort((a, b) => Number(b.rating || 0) - Number(a.rating || 0));
        else if (o === "az") lst = [...lst].sort((a, b) => String(a.name).localeCompare(String(b.name)));
        _appCache.set(ck, { em: Date.now(), v: lst });
      }
    }
    if (!c) anotarContagem(cred.u, k as any, lst.length);
    const mapa: (x: any, i: number) => unknown = k === "live" ? (x: any, i: number) => ({ id: String(x.stream_id ?? ""), n: x.num ?? i + 1, nome: limparNome(String(x.name ?? "")), img: String(x.stream_icon || ""), c: String(x.category_id ?? "") })
      : k === "vod" ? (x: any) => itemVod(x) : (x: any) => itemSerie(x);
    const ini = Math.max(0, parseInt(P.get("ini") ?? "0", 10) || 0), lim = Math.min(8000, parseInt(P.get("lim") ?? "0", 10) || (k === "live" ? 8000 : 6000));
    return { ok: true, total: lst.length, ini, itens: lst.slice(ini, ini + lim).map((x, i) => mapa(x, ini + i)) };
  }
  if (op === "info" && k === "vod") {
    const [info, hist, favs] = await Promise.all([api(cred, `&action=get_vod_info&vod_id=${encodeURIComponent(s)}`), historicoDe(eu, ["filme"], 80), favoritosVod(eu, "v")]);
    const inf = info?.info ?? {}, md = info?.movie_data ?? {};
    const h = hist.find((x) => x.item_id === s);
    const nomeF = limparNome(String(inf.name || md.name || "Filme")), anoF = String(inf.releasedate || inf.release_date || "").slice(0, 4);
    const ex: Extra = (await tmdbExtra("movie", String(inf.name || md.name || ""), anoF, inf.tmdb_id || inf.tmdb).catch(() => null)) ?? {};
    return {
      ok: true, id: s, nome: nomeF, img: imgOk(inf.cover_big) || imgOk(inf.movie_image) || ex.poster || "", fundo: ex.fundo || imgOk(inf.backdrop_path) || imgOk(inf.cover_big) || imgOk(inf.movie_image),
      ano: anoF || ex.ano || "", dur: duracaoApp(inf), r: nota(inf.rating) ?? ex.nota ?? "", gen: txtApp(inf.genre, 80) || ex.gen || "", sin: txtApp(inf.plot || inf.description, 900) || ex.sin || "",
      dir: txtApp(inf.director, 100), elenco: txtApp(inf.cast || inf.actors, 200) || ex.elenco || "", x: String(md.container_extension || "mp4"), trailer: youtubeId(inf.youtube_trailer) || ex.trailer || "",
      pos: h && emAndamento(h) ? h.pos : 0, fav: favs.some((f) => f.stream_id === s),
    };
  }
  if (op === "info" && k === "series") {
    const [info, hist, favs] = await Promise.all([api(cred, `&action=get_series_info&series_id=${encodeURIComponent(s)}`), historicoDe(eu, ["ep"], 120), favoritosVod(eu, "s")]);
    const inf = info?.info ?? {}, eps = (info?.episodes ?? {}) as Record<string, any[]>;
    const temps = Object.keys(eps).filter((n) => Array.isArray(eps[n]) && eps[n].length).sort((a, b) => Number(a) - Number(b)).map((n) => ({
      n, eps: eps[n].map((e) => {
        const h = hist.find((x) => x.item_id === String(e.id));
        return { id: String(e.id), ep: Number(e.episode_num) || 0, nome: txtApp(e.title, 90), x: String(e.container_extension || "mp4"), img: imgOk(e.info?.movie_image), dur: duracaoApp(e.info), sin: txtApp(e.info?.plot, 260), pos: h ? h.pos : 0, visto: !!h && !emAndamento(h) && h.pos > 0 };
      }),
    }));
    const ult = hist.find((x) => String(x.extra?.serie) === s);
    const anoS = String(inf.releaseDate || inf.release_date || "").slice(0, 4);
    const ex: Extra = (await tmdbExtra("tv", String(inf.name || ""), anoS, inf.tmdb_id || inf.tmdb).catch(() => null)) ?? {};
    return {
      ok: true, id: s, nome: limparNome(String(inf.name || "Série")), img: imgOk(inf.cover) || ex.poster || "", fundo: ex.fundo || imgOk(inf.backdrop_path) || imgOk(inf.cover),
      ano: anoS || ex.ano || "", r: nota(inf.rating) ?? ex.nota ?? "", gen: txtApp(inf.genre, 80) || ex.gen || "", sin: txtApp(inf.plot, 900) || ex.sin || "", elenco: txtApp(inf.cast, 200) || ex.elenco || "",
      trailer: youtubeId(inf.youtube_trailer) || ex.trailer || "", fav: favs.some((f) => f.stream_id === s), temps,
      ultimo: ult ? { temp: String(ult.extra?.temp ?? ""), ep: String(ult.extra?.ep ?? ""), id: ult.item_id, pos: ult.pos, dur: ult.dur, andamento: emAndamento(ult) } : null,
    };
  }
  if (op === "url") {
    if (!s) return { ok: false };
    return { ok: true, fontes: k === "live" ? [urlFluxo("live", cred, s, "m3u8"), urlFluxo("live", cred, s, "ts")] : [urlFluxo(k === "vod" ? "movie" : "series", cred, s, (P.get("x") || "mp4").replace(/[^a-z0-9]/gi, ""))] };
  }
  if (op === "epg") {
    const v = s ? await epgDe(cred, s) : [];
    return { ok: true, epg: v.slice(0, 4).map((p) => ({ t: p.titulo, i: p.ini, f: p.fim })) };
  }
  if (op === "fav") {
    const id = k === "live" ? s : `${k === "vod" ? "v" : "s"}:${s}`;
    return { ok: true, fav: await alternarFavorito(eu, id, P.get("n") ?? "", P.get("i") ?? "") };
  }
  if (op === "visto") {
    const tp = P.get("tp") ?? "";
    if (!["live", "filme", "ep"].includes(tp) || !s) return { ok: false };
    let extra: unknown = {};
    try { extra = JSON.parse(P.get("extra") ?? "{}"); } catch { /* sem extra */ }
    const num = (n: string) => Math.max(0, Math.min(1e6, parseInt(P.get(n) ?? "0", 10) || 0));
    await gravarVisto(eu, tp, s.slice(0, 40), limparNome(P.get("n") ?? "").slice(0, 120), (P.get("i") ?? "").slice(0, 400), extra, tp === "live" ? 0 : num("pos"), tp === "live" ? 0 : num("dur"));
    return { ok: true };
  }
  if (op === "catalogo") { // nomes de tudo, compacto: a pesquisa roda na própria TV, sem esperar o servidor a cada letra
    const tp = (k === "vod" || k === "series" || k === "live" ? k : "vod") as ItemBusca["k"];
    const v = await catalogoBusca(cred, tp);
    const regra = await regraAdulto(cred);
    const f = regra.protege ? await filtroAdulto(cred, tp) : null;
    return { ok: true, k: tp, itens: v.filter((x) => !f || !f(x.cat, tp)).map((x) => [x.id, x.nome, x.icon, x.ext]) };
  }
  if (op === "busca") {
    const q = (P.get("q") ?? "").slice(0, 40);
    if (q.trim().length < 2) return { ok: true, itens: [] };
    const r = await resultadosBusca(cred, k === "tudo" ? "" : k, q);
    return { ok: true, total: r.length, itens: r.slice(0, 80).map((x) => ({ k: x.k, id: x.id, nome: x.nome, img: x.icon, x: x.ext })) };
  }
  return { ok: false, erro: "op" };
}
const APP_TESTE = "https://mktdigital91.github.io/msx/msx/app/teste.html";
const APP_NOVO = "https://mktdigital91.github.io/msx/msx/app/index.html";
const ORDENS: Record<string, string> = { "": "Padrão", rec: "Recentes", nota: "Nota", az: "A–Z" };
const PROX_ORDEM: Record<string, string> = { "": "rec", rec: "nota", nota: "az", az: "" };
function ordenar(lst: any[], o: string) {
  const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
  const c = [...lst];
  if (o === "rec") c.sort((a, b) => num(b.added ?? b.last_modified) - num(a.added ?? a.last_modified));
  else if (o === "nota") c.sort((a, b) => num(b.rating_5based ?? b.rating) - num(a.rating_5based ?? a.rating) || num(b.rating) - num(a.rating));
  else if (o === "az") c.sort((a, b) => limparNome(String(a.name)).localeCompare(limparNome(String(b.name)), "pt-BR"));
  return c;
}
// tocar um episódio (lista da temporada, detalhes da série, Continuar assistindo)
// visual do player para filmes e episódios: barra de progresso na cor do tema e painel com capa e nome
const visualPlayer = (nome: string, sub: string, capa: string) => ({
  "progress:color": COR.destaque, "control:type": "extended",
  "info:headline": nome, "info:text": sub || " ", ...(capa ? { "info:image": capa } : {}),
});
function epAcao(cred: Cred, t: string, serie: string, sn: string, temp: string, e: any, capa = "", emLista = true) {
  const rot = `${sn} T${temp}E${e.episode_num}`;
  return {
    action: tocar("series", cred, e.id, e.container_extension || "mp4", "o episódio", { t, tp: "ep", nome: rot, icone: String(e.info?.movie_image || capa || ""), extra: { serie, sn, temp: String(temp), ep: String(e.episode_num) } }),
    playerLabel: rot,
    // na lista da temporada, ao terminar um episódio o MSX passa para o próximo item (o próximo episódio)
    properties: { "trigger:back": "quiet", ...visualPlayer(rot, String(e.title ?? ""), String(e.info?.movie_image || capa || "")), ...(emLista ? { "trigger:end": "player:next" } : {}), ...retomar("ep", e.id, quem(cred)) },
  };
}
const youtubeId = (v: unknown) => {
  const t = String(v ?? "").trim();
  const m = t.match(/(?:v=|youtu\.be\/|embed\/)([\w-]{6,20})/) ?? t.match(/^([\w-]{6,20})$/);
  return m ? m[1] : "";
};
const imgOk = (v: unknown) => { const t = String(Array.isArray(v) ? v[0] ?? "" : v ?? "").trim(); return /^https?:\/\//.test(t) ? t : ""; };
// fundo da tela de detalhes: a imagem do filme escurecida, ou o fundo padrão
const fundoDetalhe = (img: string, padrao: string) => img
  ? [{ type: "space", layout: "0,0,12,6", offset: "-1,-1,2,2", image: img, imageFiller: "cover", enable: false }, { type: "space", layout: "0,0,12,6", offset: "-1,-1,2,2", color: "rgba(6,7,18,0.78)", enable: false }]
  : [camadaFundo(padrao)];
const botao = (layout: string, icone: string, titulo: string, rodape: string, acao: string, extra: Record<string, unknown> = {}) =>
  ({ type: "default", layout, title: `{ico:${icone}}  ${titulo}`, titleFooter: rodape, color: VID.n, action: acao, ...extra });

async function telaFilme(cred: Cred, t: string, s: string) {
  const [info, hist] = await Promise.all([api(cred, `&action=get_vod_info&vod_id=${encodeURIComponent(s)}`), historicoDe(quem(cred), ["filme"], 80)]);
  const inf = info?.info ?? {}, md = info?.movie_data ?? {};
  const nome = limparNome(String(inf.name || md.name || "Filme"));
  const capa = imgOk(inf.cover_big) || imgOk(inf.movie_image) || cartao("vod", nome, "Filme", "movie", true);
  const ano = String(inf.releasedate || inf.release_date || "").slice(0, 4);
  const dur = inf.duration_secs ? fmtTempo(Number(inf.duration_secs)) : /^\d+$/.test(String(inf.duration ?? "").trim()) ? fmtTempo(Number(inf.duration) * 60) : txtMsx(inf.duration);
  const n = nota(inf.rating);
  const meta = [ano, dur, n ? `★ ${n}` : "", txtMsx(inf.genre).slice(0, 50)].filter(Boolean).join("   ·   ");
  const sinopse = txtMsx(inf.plot || inf.description) || "Sem sinopse.";
  const creditos = [inf.director ? `Direção: ${txtMsx(inf.director).slice(0, 80)}` : "", (inf.cast || inf.actors) ? `Elenco: ${txtMsx(inf.cast || inf.actors).slice(0, 140)}` : ""].filter(Boolean).join("{br}");
  const h = hist.find((x) => x.item_id === String(s));
  const andamento = !!h && emAndamento(h);
  const play = tocar("movie", cred, s, String(md.container_extension || "mp4"), "o filme", { t, tp: "filme", nome, icone: capa });
  const props = { "trigger:back": "quiet", ...visualPlayer(nome, meta, capa), ...retomar("filme", s, quem(cred)) };
  const yt = youtubeId(inf.youtube_trailer);
  const botoes: any[] = [
    botao("3,4,3,1", "play-arrow", andamento ? "Continuar" : "Assistir", andamento ? `de ${fmtTempo(h!.pos)}` : " ", play, { playerLabel: nome, properties: props, color: VID.ouro, focus: true }),
  ];
  // "Do início": guarda a posição, mas não retoma
  if (andamento) botoes.push(botao("6,4,3,1", "replay", "Do início", "Começar de novo", play, { playerLabel: nome, properties: { ...props, "resume:position": "none" } }));
  const ehFav = (await favoritosVod(quem(cred), "v")).some((f) => f.stream_id === String(s));
  botoes.push(botao("0,0,1,1", ehFav ? "favorite" : "favorite-border", ehFav ? "Favorito" : "Favoritar", ehFav ? "Tirar dos favoritos" : "Guardar nos favoritos", rpDet({ a: "favvod", t, tp: "v", s, n: nome, i: capa }), ehFav ? { title: `{col:msx-red}{ico:favorite}{col:msx-white}  Favorito` } : {}));
  if (yt) botoes.push(botao("0,0,1,1", "movie", "Trailer", "YouTube", `video:plugin:http://msx.benzac.de/plugins/youtube.html?id=${yt}`, { playerLabel: `Trailer · ${nome}` }));
  arrumarBotoes(botoes, 4);
  return {
    type: "pages", flag: "det", transparent: 2, ready: { action: "quiet" }, background: FUNDO_CFG || im("bg-filmes.jpg"),
    pages: [{ items: [
      ...fundoDetalhe(imgOk(inf.backdrop_path), "bg-filmes.jpg"),
      { type: "space", layout: "0,0,3,5", offset: "0.1,0.1,-0.2,-0.2", image: capa, imageFiller: "fit" },
      { type: "space", layout: "3,0,9,1", headline: nome, text: `{col:msx-white-soft}${meta}` },
      { type: "space", layout: "3,1,9,2", text: sinopse.length > 520 ? sinopse.slice(0, 517) + "…" : sinopse },
      ...(creditos ? [{ type: "space", layout: "3,3,9,1", text: `{col:msx-white-soft}${creditos}` }] : []),
      ...botoes,
    ] }],
  };
}

async function telaSerie(cred: Cred, t: string, s: string) {
  const [info, hist] = await Promise.all([api(cred, `&action=get_series_info&series_id=${encodeURIComponent(s)}`), historicoDe(quem(cred), ["ep"], 80)]);
  const inf = info?.info ?? {};
  const nome = limparNome(String(inf.name || "Série"));
  const capa = imgOk(inf.cover) || cartao("series", nome, "Série", "series", true);
  const eps = (info?.episodes ?? {}) as Record<string, any[]>;
  const numeros = Object.keys(eps).filter((n) => Array.isArray(eps[n]) && eps[n].length).sort((x, y) => Number(x) - Number(y));
  const n = nota(inf.rating);
  const meta = [String(inf.releaseDate || inf.release_date || "").slice(0, 4), `${numeros.length} temporada${numeros.length === 1 ? "" : "s"}`, n ? `★ ${n}` : "", txtMsx(inf.genre).slice(0, 50)].filter(Boolean).join("   ·   ");
  const sinopse = txtMsx(inf.plot) || "Sem sinopse.";
  const elenco = inf.cast ? `{br}{col:msx-white-soft}Elenco: ${txtMsx(inf.cast).slice(0, 120)}` : "";
  // de onde continuar: último episódio desta série no histórico (ou o seguinte, se já terminou)
  const achar = (temp: string, ep: string) => (eps[temp] ?? []).find((e) => String(e.episode_num) === ep);
  const ultimo = hist.find((x) => String(x.extra?.serie) === String(s));
  let alvo: { temp: string; e: any; rotulo: string; rodape: string } | null = null;
  if (ultimo) {
    const tp = String(ultimo.extra?.temp ?? ""), ep = String(ultimo.extra?.ep ?? "");
    const e = achar(tp, ep);
    if (e && emAndamento(ultimo)) alvo = { temp: tp, e, rotulo: `Continuar T${tp}E${ep}`, rodape: `de ${fmtTempo(ultimo.pos)}` };
    else if (e) {
      const lst = eps[tp] ?? [], i = lst.indexOf(e);
      const prox = i >= 0 && i + 1 < lst.length ? { temp: tp, e: lst[i + 1] } : (() => { const k = numeros[numeros.indexOf(tp) + 1]; return k ? { temp: k, e: eps[k][0] } : null; })();
      if (prox) alvo = { ...prox, rotulo: `Próximo: T${prox.temp}E${prox.e.episode_num}`, rodape: txtMsx(prox.e.title).slice(0, 30) || "Próximo episódio" };
    }
  }
  if (!alvo && numeros.length) alvo = { temp: numeros[0], e: eps[numeros[0]][0], rotulo: `Assistir T${numeros[0]}E${eps[numeros[0]][0].episode_num}`, rodape: "Do começo" };
  const yt = youtubeId(inf.youtube_trailer);
  const botoes: any[] = [];
  if (alvo) botoes.push(botao("3,3,5,1", "play-arrow", alvo.rotulo, alvo.rodape, "", { ...epAcao(cred, t, s, nome, alvo.temp, alvo.e, capa, false), color: VID.ouro, focus: true }));
  const ehFav = (await favoritosVod(quem(cred), "s")).some((f) => f.stream_id === String(s));
  botoes.push(botao("0,0,1,1", ehFav ? "favorite" : "favorite-border", ehFav ? "Favorita" : "Favoritar", ehFav ? "Tirar dos favoritos" : "Guardar nos favoritos", rpDet({ a: "favvod", t, tp: "s", s, n: nome, i: capa }), ehFav ? { title: `{col:msx-red}{ico:favorite}{col:msx-white}  Favorita` } : {}));
  if (yt) botoes.push(botao("0,0,1,1", "movie", "Trailer", "YouTube", `video:plugin:http://msx.benzac.de/plugins/youtube.html?id=${yt}`, { playerLabel: `Trailer · ${nome}` }));
  arrumarBotoes(botoes, 3);
  // temporadas: até 18 botões (2 linhas de 9); com mais, o último abre a lista completa
  const muitas = numeros.length > 18;
  const visiveis = muitas ? numeros.slice(0, 17) : numeros;
  const temps: any[] = visiveis.map((k, i) => ({
    type: "default", layout: `${3 + (i % 9)},${4 + Math.floor(i / 9)},1,1`, color: VID.n, alignment: "center", centration: "title",
    title: `T${k}`, titleFooter: `${eps[k].length} ep.`, action: go({ a: "serie", t, s, n: k }), ...(!alvo && i === 0 ? { focus: true } : {}),
  }));
  if (muitas) temps.push({ type: "default", layout: "11,5,1,1", color: VID.voltar, alignment: "center", centration: "title", title: "Todas", action: go({ a: "serie", t, s, n: "*" }) });
  return {
    type: "pages", flag: "det", transparent: 2, ready: { action: "quiet" }, background: FUNDO_CFG || im("bg-series.jpg"),
    pages: [{ items: [
      ...fundoDetalhe(imgOk(inf.backdrop_path), "bg-series.jpg"),
      { type: "space", layout: "0,0,3,5", offset: "0.1,0.1,-0.2,-0.2", image: capa, imageFiller: "fit" },
      { type: "space", layout: "3,0,9,1", headline: nome, text: `{col:msx-white-soft}${meta}` },
      { type: "space", layout: "3,1,9,2", text: (sinopse.length > 420 ? sinopse.slice(0, 417) + "…" : sinopse) + elenco },
      ...botoes,
      ...(temps.length ? [] : [{ type: "space", layout: "3,4,9,1", text: "{col:msx-white-soft}Nenhum episódio disponível." }]),
      ...temps,
    ] }],
  };
}

// item de "Continuar assistindo" (filme ou episódio): toca direto, de onde parou
function itemContinuar(h: Hist, cred: Cred, t: string) {
  const pct = h.dur ? Math.round((h.pos / h.dur) * 100) : 0;
  const rodape = `${pct ? pct + "% · " : ""}parou em ${fmtTempo(h.pos)}`;
  const img = h.icone || cartao(h.tipo === "ep" ? "series" : "vod", h.nome, h.tipo === "ep" ? "Série" : "Filme", h.tipo === "ep" ? "series" : "movie", true);
  const ext = String(h.extra?.ext || "mp4");
  if (h.tipo === "ep") {
    return {
      title: h.nome, titleFooter: rodape, image: img, imageFiller: "cover", color: COR.vidro, truncation: "title",
      ...epAcao(cred, t, String(h.extra?.serie ?? ""), String(h.extra?.sn ?? h.nome), String(h.extra?.temp ?? ""), { id: h.item_id, episode_num: h.extra?.ep ?? "", container_extension: ext, info: { movie_image: h.icone } }, h.icone, false),
    };
  }
  return {
    title: h.nome, titleFooter: rodape, image: img, imageFiller: "cover", color: COR.vidro, truncation: "title", playerLabel: h.nome,
    action: tocar("movie", cred, h.item_id, ext, "o filme", { t, tp: "filme", nome: h.nome, icone: h.icone }),
    properties: { "trigger:back": "quiet", ...visualPlayer(h.nome, "", h.icone), ...retomar("filme", h.item_id, quem(cred)) },
  };
}

// ---------- Pesquisa inteligente: teclado próprio na tela, resultados aparecem a cada letra ----------
// O teclado do MSX só devolve o texto ao confirmar; aqui cada tecla é um botão que recarrega a tela
// (replace:content, sem encher o histórico) com o texto novo e os resultados já filtrados.
type ItemBusca = { k: "live" | "vod" | "series"; id: string; nome: string; n: string; icon: string; ext: string; cat: string };
const cacheBusca = new Map<string, { em: number; v: ItemBusca[] }>();
const normBusca = (t: string) => semAcento(String(t ?? "")).replace(/[^a-z0-9]+/g, " ").trim();
const ACOES_BUSCA = { live: "get_live_streams", vod: "get_vod_streams", series: "get_series" } as const;
// quantidade de canais/filmes/séries por usuário (aparece nos cartões da tela inicial)
const _contagem = new Map<string, { t: number; v: Record<string, number> }>();
function anotarContagem(u: string, k: string, n: number) {
  const c = _contagem.get(u) ?? { t: Date.now(), v: {} };
  if (c.v[k] === n && Date.now() - c.t < 3600_000) return;
  c.v[k] = n; c.t = Date.now(); _contagem.set(u, c);
  // guarda no banco (somando ao que outra instância já gravou)
  (async () => {
    try {
      const r = await fetch(`${SB()}/rest/v1/usuarios_app?usuario=eq.${encodeURIComponent(u)}&select=contagem&limit=1`, { headers: sbh(), signal: AbortSignal.timeout(4000) });
      const j = await r.json(); const antes = (Array.isArray(j) && j[0]?.contagem) || {};
      Object.assign(c.v, { ...antes, ...c.v, [k]: n });
      await fetch(`${SB()}/rest/v1/usuarios_app?usuario=eq.${encodeURIComponent(u)}`, { method: "PATCH", headers: sbh(), body: JSON.stringify({ contagem: { ...c.v, em: Date.now() } }), signal: AbortSignal.timeout(4000) });
    } catch { /* sem contagem */ }
  })();
}
async function contagemDe(u: string): Promise<{ t: number; v: Record<string, number> } | null> {
  const m = _contagem.get(u);
  if (m && m.v.live && m.v.vod && m.v.series) return m;
  try {
    const r = await fetch(`${SB()}/rest/v1/usuarios_app?usuario=eq.${encodeURIComponent(u)}&select=contagem&limit=1`, { headers: sbh(), signal: AbortSignal.timeout(4000) });
    const j = await r.json(); const c = Array.isArray(j) ? j[0]?.contagem : null;
    if (c && typeof c === "object") { const o = { t: Number(c.em) || 0, v: { ...c, ...(m?.v ?? {}) } }; _contagem.set(u, o); return o; }
  } catch { /* sem contagem */ }
  return m ?? null;
}
const fmtQtd = (n?: number) => (n ? n.toLocaleString("pt-BR") : undefined);
async function catalogoBusca(cred: Cred, k: ItemBusca["k"]): Promise<ItemBusca[]> {
  const chaveC = `${cred.u}|${k}`;
  const c = cacheBusca.get(chaveC);
  if (c && Date.now() - c.em < 10 * 60 * 1000) { anotarContagem(cred.u, k, c.v.length); return c.v; } // guardado: as próximas letras não buscam de novo
  const dados = await api(cred, `&action=${ACOES_BUSCA[k]}`);
  const v: ItemBusca[] = ((Array.isArray(dados) ? dados : []) as any[]).map((x) => {
    const nome = limparNome(String(x.name ?? ""));
    return {
      k, nome, n: normBusca(nome),
      id: String(k === "series" ? x.series_id : x.stream_id),
      icon: String((k === "series" ? x.cover : x.stream_icon) ?? ""),
      ext: String(x.container_extension ?? ""), cat: String(x.category_id ?? ""),
    };
  }).filter((x) => x.n && x.id && x.id !== "undefined");
  anotarContagem(cred.u, k, v.length);
  if (cacheBusca.size > 60) cacheBusca.clear();
  cacheBusca.set(chaveC, { em: Date.now(), v });
  return v;
}
// todas as palavras digitadas precisam aparecer no nome; começo do nome vale mais, depois começo de palavra
function filtrarBusca(lst: ItemBusca[], qn: string): ItemBusca[] {
  const pal = qn.split(" ").filter(Boolean);
  if (!pal.length) return [];
  const out: { x: ItemBusca; p: number }[] = [];
  for (const x of lst) {
    if (!pal.every((w) => x.n.includes(w))) continue;
    const p = x.n.startsWith(qn) ? 0 : (" " + x.n).includes(" " + pal[0]) ? 1 : 2;
    out.push({ x, p });
  }
  out.sort((a, b) => a.p - b.p || a.x.nome.length - b.x.nome.length || a.x.nome.localeCompare(b.x.nome));
  return out.map((o) => o.x);
}
async function resultadosBusca(cred: Cred, k: string, texto: string) {
  const tipos: ItemBusca["k"][] = k === "live" || k === "vod" || k === "series" ? [k] : ["live", "vod", "series"];
  const listas = await Promise.all(tipos.map((tp) => catalogoBusca(cred, tp)));
  return filtrarBusca(listas.flat(), normBusca(texto));
}
// Pesquisa feita na própria TV (msx/mira.html): o servidor manda o catálogo compacto uma vez
// e o modelo de um canal; o teclado, o texto e o filtro ficam na TV (sem esperar o servidor a cada letra).
async function buscaDados(cred: Cred, t: string, k: string, escondeAdulto: (cat: string, k: string) => boolean) {
  const tipos: ItemBusca["k"][] = k === "live" || k === "vod" || k === "series" ? [k] : ["live", "vod", "series"];
  const listas = await Promise.all(tipos.map((tp) => catalogoBusca(cred, tp)));
  const itens = listas.flat().filter((x) => !escondeAdulto(x.cat, x.k)).map((x) => [x.k === "live" ? "l" : x.k === "vod" ? "v" : "s", x.id, x.nome, x.icon, x.cat, x.n]);
  let live: unknown = null;
  if (tipos.includes("live")) {
    const m = canalItem({ name: "__NOME__", stream_id: "__ID__", stream_icon: "__ICONE__", category_id: "__CAT__" }, cred, t, "__CAT__", false) as any;
    const cr = cred as Cred;
    live = {
      player: PLAYER,
      fontes: [urlFluxo("live", cr, "__ID__", "ts"), urlFluxo("live", cr, "__ID__", "m3u8")].join("\n"),
      registro: `${SELF()}?${q({ a: "visto", t, tp: "live", s: "__ID__", n: "__NOME__", i: "__ICONE__", x: JSON.stringify({ ext: "ts", c: "__CAT__" }) })}`,
      properties: JSON.stringify(m.properties),
    };
  }
  return { ok: true, itens, live, tema: { img: IMG + (TEMAS[TEMA]?.pasta ?? ""), n: VID.n, ouro: VID.ouro, voltar: VID.voltar, vidro: COR.vidro } };
}
function itemBusca(x: ItemBusca, cred: Cred, t: string) {
  if (x.k === "live") {
    return { ...canalItem({ name: x.nome, stream_id: x.id, stream_icon: x.icon || undefined }, cred, t, x.cat, false), enumerate: false, titleFooter: "TV ao vivo" };
  }
  if (x.k === "vod") {
    return { title: x.nome, titleFooter: "Filme", truncation: "title", color: VID.n, icon: "movie", iconSize: "small", action: go({ a: "filme", t, s: x.id }) };
  }
  return { title: x.nome, titleFooter: "Série", truncation: "title", color: VID.n, icon: "video-library", iconSize: "small", action: go({ a: "serie", t, s: x.id }) };
}
const abrirBusca = (t: string, k: string) => `content:request:interaction:busca/abrir/${k || "-"}/${TEMA}/${t}@${PLUGIN}`;
const NOME_SECAO: Record<string, string> = { live: "TV ao vivo", vod: "Filmes", series: "Séries" };
// troca a tela de pesquisa por outra (cada letra), sem criar uma entrada nova no "voltar"
const rp = (o: Record<string, string | number>) => RC()?.cap && RC()?.relay
  ? `replace:content:busca:request:interaction:${q({ ...o, rl: 1 })}@${PLUGIN}`
  : `replace:content:busca:${SELF()}?${q(o)}`;
async function telaBusca(cred: Cred, t: string, k: string, texto: string, foco: string, modo: string) {
  const base = (qq: string, f: string, m = modo) => ({ a: "busca", t, ...(k ? { k } : {}), q: qq, f, ...(m === "n" ? { m } : {}) });
  const secao = NOME_SECAO[k] ?? "tudo";
  const letras = modo === "n" ? "1234567890".split("") : "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
  const teclas: any[] = letras.map((L) => ({ id: "k" + L, title: L, acao: rp(base((texto + L.toLowerCase()).slice(0, 30), "k" + L)) }));
  while (teclas.length < 26) teclas.push(null); // números: completa a grade
  teclas.push(
    { id: "kmodo", title: modo === "n" ? "ABC" : "123", acao: rp(base(texto, "kmodo", modo === "n" ? "" : "n")) },
    { id: "kesp", title: "␣", footer: "Espaço", acao: rp(base(texto && !texto.endsWith(" ") ? (texto + " ").slice(0, 30) : texto, "kesp")) },
    { id: "kapg", title: "⌫", footer: "Apagar", acao: rp(base(texto.slice(0, -1), "kapg")) },
    { id: "klimpar", title: "✕", footer: "Limpar", acao: rp(base("", "klimpar")) },
  );
  const focoValido = teclas.some((x) => x && x.id === foco) ? foco : "kA";
  const itensTeclado = teclas.map((x, i) => x && ({
    id: x.id, type: "default", layout: `${i % 6},${1 + Math.floor(i / 6)},1,1`, color: VID.n,
    title: x.title, titleFooter: x.footer, alignment: "center", centration: "title", action: x.acao,
    focus: x.id === focoValido ? true : undefined,
  })).filter(Boolean);

  let achados: ItemBusca[] = [];
  let erro = "";
  if (normBusca(texto)) {
    try { achados = await resultadosBusca(cred, k, texto); }
    catch (e) { if (e instanceof RelayNeed) throw e; erro = "Não foi possível consultar a lista agora"; }
  }
  const VAGAS = 10; // 2 colunas x 5 linhas à direita
  const mostrar = achados.length > VAGAS ? achados.slice(0, VAGAS - 1) : achados;
  const res: any[] = mostrar.map((x, i) => ({ ...itemBusca(x, cred, t), type: "default", layout: `${6 + (i % 2) * 3},${1 + Math.floor(i / 2)},3,1`, focus: undefined }));
  if (achados.length > VAGAS) {
    res.push({ type: "default", layout: "9,5,3,1", color: VID.ouro, title: `Ver todos (${achados.length})`, titleFooter: "Lista completa", alignment: "center", action: go({ a: "buscatodos", t, ...(k ? { k } : {}), q: texto }) });
  }
  const aviso = erro || (!normBusca(texto) ? "Digite com o teclado ao lado; os resultados aparecem aqui." : achados.length ? "" : "Nada encontrado com esse nome.");
  return {
    type: "pages", flag: "busca", transparent: 2, ready: { action: "quiet" }, background: FUNDO_CFG || im(FUNDO[k] ?? "bg-tv.jpg"),
    pages: [{ items: [
      camadaFundo(FUNDO[k] ?? "bg-tv.jpg"),
      { type: "space", layout: "0,0,6,1", headline: `{col:msx-white}${texto ? xmlMsx(texto.toUpperCase()) : "{col:msx-white-soft}Pesquisar"}{col:msx-yellow}_`, text: `{col:msx-white-soft}Pesquisar em ${secao}` },
      { type: "space", layout: "6,0,6,1", alignment: "right", text: achados.length ? `{col:msx-white-soft}${achados.length} resultado${achados.length > 1 ? "s" : ""}` : "" },
      ...itensTeclado,
      ...(aviso ? [{ type: "space", layout: "6,1,6,2", offset: "0.3,0,-0.3,0", text: `{col:msx-white-soft}${aviso}` }] : []),
      ...res,
    ] }],
  };
}
// o MSX interpreta {…} no texto: tira as chaves do que foi digitado
const xmlMsx = (t: string) => t.replace(/[{}]/g, "");

// ---------- "Jogos de hoje" animado com as logos dos times de hoje (ligas principais) ----------
const LIGAS_TOP = /brasileir|serie a do brasil|champions|libertadores|sul.?americana|sudamericana|conmebol|copa do brasil|espanhol|la ?liga|ingl|premier|amistos/;
const _jgif = new Map<string, { em: number; v: Uint8Array }>();
let _fonte: Uint8Array | null = null;
async function jogosGif(): Promise<Uint8Array | null> {
  const chaveG = `${diaLocal()}|${TEMA}|${Math.floor(Date.now() / 1800_000)}`;
  const c = _jgif.get(chaveG); if (c) return c.v;
  const ORDEM = [/brasileir|serie a do brasil/, /copa do brasil/, /libertadores/, /sul.?americana|sudamericana|conmebol/, /champions/, /ingl|premier/, /espanhol|la ?liga/, /amistos/];
  const prio = (l: string) => { const n = semAcento(l); const i = ORDEM.findIndex((r) => r.test(n)); return i < 0 ? 99 : i; };
  const vistos = new Set<string>();
  const jogos = ((await jogosDoDia(5000)) ?? [])
    .filter((j) => LIGAS_TOP.test(semAcento(j.liga)) && j.casa.logo && j.fora.logo)
    .sort((a, b) => prio(a.liga) - prio(b.liga) || ({ in: 0, pre: 1, post: 2 } as any)[a.estado] - ({ in: 0, pre: 1, post: 2 } as any)[b.estado] || a.quando - b.quando)
    .filter((j) => { const k = semAcento(j.casa.nome + "|" + j.fora.nome); if (vistos.has(k)) return false; vistos.add(k); return true; })
    .slice(0, 12);
  if (jogos.length < 2) return null;
  if (!_fonte) _fonte = new Uint8Array(await (await fetch(IMG + "fontes/DejaVuSans-Bold.ttf")).arrayBuffer());
  const logo = async (u: string) => { try { const im = await Img.decode(new Uint8Array(await (await fetch(u, { signal: AbortSignal.timeout(4000) })).arrayBuffer())); return im.contain(110, 110); } catch { return null; } };
  const W = 640, H = 360;
  const onix = TEMA === "onix";
  // cartão igual aos blocos do lado (Guia / Continuar): degradê do tema, cantos arredondados e borda dourada
  const c1 = onix ? [28, 26, 30] : [42, 33, 96], c2 = onix ? [14, 13, 16] : [18, 20, 51], ouro = onix ? [214, 178, 94] : [245, 180, 0];
  const R = 26, M = 6;
  const fundo = new Img(W, H).fill((x: number, y: number) => {
    const fx = x - 1, fy = y - 1; // a biblioteca conta a partir de 1
    const dx = Math.max(M + R - fx, 0, fx - (W - M - R)), dy = Math.max(M + R - fy, 0, fy - (H - M - R));
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d > R) return Img.rgbaToColor(0, 0, 0, 0);
    if (d > R - 2.5 || (dx === 0 && dy === 0 && (fx < M + 2.5 || fx > W - M - 2.5 || fy < M + 2.5 || fy > H - M - 2.5))) return Img.rgbaToColor(ouro[0], ouro[1], ouro[2], onix ? 200 : 110);
    const t = Math.min(1, (fx / W + fy / H) / 2);
    return Img.rgbaToColor(Math.round(c1[0] + (c2[0] - c1[0]) * t), Math.round(c1[1] + (c2[1] - c1[1]) * t), Math.round(c1[2] + (c2[2] - c1[2]) * t), 255);
  });
  const destaque = onix ? 0xD6B25EFF : 0xF5B400FF;
  const frames: Frame[] = [];
  for (const j of jogos) {
    const [l1, l2] = await Promise.all([logo(j.casa.logo), logo(j.fora.logo)]);
    if (!l1 || !l2) continue;
    const f = fundo.clone();
    f.composite(l1, 140 - l1.width / 2, 46 + (110 - l1.height) / 2);
    f.composite(l2, W - 140 - l2.width / 2, 46 + (110 - l2.height) / 2);
    const temPlacar = j.estado !== "pre" && j.casa.gols !== "" && j.fora.gols !== "";
    const vs = Img.renderText(_fonte!, temPlacar ? 46 : 40, temPlacar ? `${j.casa.gols}  x  ${j.fora.gols}` : "x", temPlacar ? 0xFFFFFFFF : destaque);
    f.composite(vs, W / 2 - vs.width / 2, temPlacar ? 74 : 80);
    const nome = (t: string) => Img.renderText(_fonte!, 22, t.length > 14 ? t.slice(0, 13) + "…" : t, 0xFFFFFFFF);
    const n1 = nome(j.casa.nome), n2 = nome(j.fora.nome);
    f.composite(n1, Math.max(24, 140 - n1.width / 2), 160); f.composite(n2, Math.min(W - 24 - n2.width, W - 140 - n2.width / 2), 160);
    const liga = Img.renderText(_fonte!, 16, (j.liga + (j.status ? "  ·  " + j.status : "")).toUpperCase().slice(0, 48), destaque);
    f.composite(liga, W / 2 - liga.width / 2, 20);
    frames.push(Frame.from(f, 2200));
  }
  if (frames.length < 2) return null;
  const v = await new GIF(frames, -1).encode(70);
  if (_jgif.size > 4) _jgif.clear();
  _jgif.set(chaveG, { em: Date.now(), v });
  return v;
}

// bloco da tela inicial (Guia de Programação / Continuar assistindo): cartão desenhado no tema
function blocoSvg(g: URLSearchParams) {
  const W = 640, H = 360, onix = g.get("th") === "onix";
  const tit = limparNome(g.get("t") ?? "").slice(0, 30), l1 = limparNome(g.get("a1") ?? "").slice(0, 34), l2 = String(g.get("a2") ?? "").replace(/[<>&"]/g, "").slice(0, 40);
  const pct = Math.max(0, Math.min(100, Number(g.get("p")) || 0)), ic = ICONES[g.get("i") ?? "play"] ?? ICONES.play, comCapa = g.get("c") === "1";
  const c1 = onix ? "#1C1A1E" : "#2A2160", c2 = onix ? "#0E0D10" : "#121433", ouro = onix ? "#D6B25E" : "#F5B400";
  const xt = 40, larg = comCapa ? W - 340 : W - 80;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient></defs>`
    + `<rect x="6" y="6" width="${W - 12}" height="${H - 12}" rx="26" fill="url(#g)" stroke="${ouro}" stroke-opacity="${onix ? ".75" : ".35"}" stroke-width="2"/>`
    + (comCapa ? "" : `<g transform="translate(${W - 230} 70) scale(8)" fill="${ouro}" fill-opacity=".12"><path d="${ic}"/></g>`)
    + `<rect x="${xt}" y="40" width="64" height="64" rx="18" fill="${ouro}" fill-opacity=".16" stroke="${ouro}" stroke-opacity=".8" stroke-width="2"/><g transform="translate(${xt + 14} 54) scale(1.5)" fill="${ouro}"><path d="${ic}"/></g>`
    + `<rect x="${xt}" y="${H - 136}" width="40" height="5" rx="2.5" fill="${ouro}"/>`
    + `<text x="${xt}" y="${H - 96}" font-size="31" font-weight="800" fill="#fff" font-family="Arial, Helvetica, sans-serif">${xml(tit)}</text>`
    + (l1 ? `<text x="${xt}" y="${H - 64}" font-size="20" font-weight="700" fill="#fff" fill-opacity=".9" font-family="Arial, Helvetica, sans-serif">${xml(l1)}</text>` : "")
    + (l2 ? `<text x="${xt}" y="${l1 ? H - 38 : H - 64}" font-size="18" font-weight="600" fill="#fff" fill-opacity=".62" font-family="Arial, Helvetica, sans-serif">${xml(l2)}</text>` : "")
    + (pct ? `<rect x="${xt}" y="${H - 26}" width="${larg}" height="5" rx="2.5" fill="#fff" fill-opacity=".18"/><rect x="${xt}" y="${H - 26}" width="${Math.round(larg * pct / 100)}" height="5" rx="2.5" fill="${ouro}"/>` : "")
    + `</svg>`;
}
// capas do Continuar assistindo trocando a cada 7 s, com fade (GIF montado aqui)
const _capas = new Map<string, { em: number; v: Uint8Array }>();
async function capasGif(t: string, th: string): Promise<Uint8Array | null> {
  const ch = `${t.slice(-24)}|${th}`; const c = _capas.get(ch);
  if (c && Date.now() - c.em < 10 * 60_000) return c.v;
  const cred = await lerToken(t); if (!cred) return null;
  // cada capa leva o próprio progresso (barra + "45% · 32 min") logo abaixo, para trocar junto
  const vistos = new Set<string>();
  const itens = (await historicoDe(quem(cred), ["filme", "ep"], 40)).filter((h) => emAndamento(h) && h.icone && !vistos.has(h.icone) && vistos.add(h.icone)).slice(0, 5);
  if (itens.length < 2) return null;
  if (!_fonte) _fonte = new Uint8Array(await (await fetch(IMG + "fontes/DejaVuSans-Bold.ttf")).arrayBuffer());
  const W = 220, HC = 226, H = HC + 56, fundo = th === "onix" ? Img.rgbaToColor(17, 16, 19, 255) : Img.rgbaToColor(24, 24, 64, 255);
  const ouro = th === "onix" ? Img.rgbaToColor(214, 178, 94, 255) : Img.rgbaToColor(245, 180, 0, 255);
  const trilho = Img.rgbaToColor(90, 90, 100, 255);
  const quadros: Img[] = [];
  for (const h of itens) {
    try {
      const im = await Img.decode(new Uint8Array(await (await fetch(h.icone, { signal: AbortSignal.timeout(5000) })).arrayBuffer()));
      const f = new Img(W, H).fill(fundo); const p = (im as Img).contain(W, HC);
      f.composite(p, (W - p.width) / 2, (HC - p.height) / 2);
      const pct = h.dur ? Math.min(100, Math.round((h.pos / h.dur) * 100)) : 0;
      const bx = 20, bw = W - 40, by = HC + 12;
      f.drawBox(bx, by, bw, 6, trilho);
      if (pct) f.drawBox(bx, by, Math.max(4, Math.round(bw * pct / 100)), 6, ouro);
      const tx = Img.renderText(_fonte!, 17, `${pct ? pct + "% · " : ""}${fmtTempo(h.pos)}`, 0xFFFFFFFF);
      f.composite(tx, (W - tx.width) / 2, by + 16);
      quadros.push(f);
    } catch { /* capa que não abriu fica de fora */ }
  }
  if (quadros.length < 2) return null;
  const frames: Frame[] = [];
  quadros.forEach((q, i) => {
    frames.push(Frame.from(q, 7000));
    const prox = quadros[(i + 1) % quadros.length];
    for (let k = 1; k <= 3; k++) { // fade: a capa atual some enquanto a próxima aparece
      const a = k / 4, m = q.clone();
      m.composite(prox.clone().opacity(a), 0, 0);
      frames.push(Frame.from(m, 110));
    }
  });
  const v = await new GIF(frames, -1).encode(30);
  if (_capas.size > 50) _capas.clear();
  _capas.set(ch, { em: Date.now(), v });
  return v;
}
// ---------- tema Moderno: peças desenhadas pelo servidor (SVG) ----------
const mt = (o: Record<string, string | number>) => `${SELF()}?${q({ a: "mt", ...o })}`;
function moderno(g: URLSearchParams) {
  const k = g.get("k") ?? "tile";
  const ic = ICONES[g.get("i") ?? "play"] ?? ICONES.play;
  const titulo = xml(limparNome(g.get("t") ?? "").slice(0, 40)), sub = xml(limparNome(g.get("s") ?? "").slice(0, 44));
  const F = 'font-family="Arial, Helvetica, sans-serif"';
  if (k === "bg") { // fundo escuro com formas geométricas em azul
    let sd = 7;
    const r = () => { sd = (sd * 1664525 + 1013904223) >>> 0; return sd / 4294967296; };
    const cores = ["#0F2A6B", "#0B1E55", "#1D4ED8", "#0A1740", "#1E3A8A"];
    let poli = "", pts = "";
    for (let n = 0; n < 30; n++) {
      const cx = r() * 1920, cy = r() * 1080, t = 160 + r() * 380, a = r() * 6.28;
      const p = [0, 1, 2].map((m) => `${(cx + Math.cos(a + m * 2.1 + r() * 0.8) * t).toFixed(0)},${(cy + Math.sin(a + m * 2.1 + r() * 0.8) * t * 0.8).toFixed(0)}`).join(" ");
      poli += `<polygon points="${p}" fill="${cores[n % cores.length]}" fill-opacity="${(0.07 + r() * 0.22).toFixed(2)}"/>`;
    }
    for (let n = 0; n < 16; n++) pts += `<circle cx="${(r() * 1920).toFixed(0)}" cy="${(r() * 1080).toFixed(0)}" r="${(2 + r() * 4).toFixed(1)}" fill="#3B82F6" fill-opacity="${(0.25 + r() * 0.4).toFixed(2)}"/>`;
    return `<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080" viewBox="0 0 1920 1080"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#050A1A"/><stop offset="1" stop-color="#0A1636"/></linearGradient><radialGradient id="r" cx=".5" cy=".5" r=".6"><stop offset="0" stop-color="#1D4ED8" stop-opacity=".22"/><stop offset="1" stop-color="#1D4ED8" stop-opacity="0"/></radialGradient></defs><rect width="1920" height="1080" fill="url(#g)"/><rect width="1920" height="1080" fill="url(#r)"/>${poli}${pts}</svg>`;
  }
  if (k === "btn") { // botão redondo só com ícone
    return `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160" viewBox="0 0 160 160"><rect x="6" y="6" width="148" height="148" rx="38" fill="#0B1534" fill-opacity=".92" stroke="#3B82F6" stroke-opacity=".35" stroke-width="3"/><g transform="translate(42 42) scale(3.2)" fill="#DCE8FF"><path d="${ic}"/></g></svg>`;
  }
  if (k === "pill") { // atalho horizontal: ícone + título + legenda
    return `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="180" viewBox="0 0 640 180"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#12204A"/><stop offset="1" stop-color="#0A1230"/></linearGradient></defs><rect x="4" y="4" width="632" height="172" rx="40" fill="url(#g)" stroke="#3B82F6" stroke-opacity=".3" stroke-width="3"/><g transform="translate(40 52) scale(3.2)" fill="#60A5FA"><path d="${ic}"/></g><text x="150" y="${sub ? 84 : 104}" font-size="40" font-weight="700" fill="#fff" ${F}>${titulo}</text>${sub ? `<text x="150" y="128" font-size="26" fill="#8FA6D9" ${F}>${sub}</text>` : ""}</svg>`;
  }
  // tile: caixa grande do menu principal
  return `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480" viewBox="0 0 640 480"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#14245A"/><stop offset="1" stop-color="#090F2A"/></linearGradient><clipPath id="c"><rect x="4" y="4" width="632" height="472" rx="44"/></clipPath></defs><rect x="4" y="4" width="632" height="472" rx="44" fill="url(#g)"/><g clip-path="url(#c)"><g transform="translate(330 190) scale(13)" fill="#3B82F6" fill-opacity=".10"><path d="${ic}"/></g></g><rect x="4" y="4" width="632" height="472" rx="44" fill="none" stroke="#3B82F6" stroke-opacity=".38" stroke-width="3"/><g transform="translate(236 92) scale(7)" fill="#DCE8FF"><path d="${ic}"/></g><text x="320" y="352" font-size="54" font-weight="800" fill="#fff" text-anchor="middle" ${F}>${titulo}</text>${sub ? `<text x="320" y="406" font-size="30" fill="#8FA6D9" text-anchor="middle" ${F}>${sub}</text>` : ""}</svg>`;
}
const blocoImg = (o: Record<string, string | number>) => `${SELF()}?${q({ a: "bloco", th: TEMA, ...o })}`;
// canais principais para o Guia de Programação (um por rede, na melhor qualidade)
const REDES = [/^globo (sp|rj)|^globo\b/, /^sbt/, /^record/, /^band\b|bandeirantes/, /globonews/, /^sportv\b/, /^espn\b/, /premiere/, /^tnt\b/, /cnn brasil/, /discovery channel|^discovery\b/, /^hbo\b/];
async function telaGuiaHome(cred: Cred, t: string, pg: number) {
  // todos os canais que têm guia (epg_channel_id preenchido pelo provedor), sem adultos quando protegido
  const [dados, semAdulto] = await Promise.all([api(cred, "&action=get_live_streams"), filtroAdulto(cred, "live")]);
  const todos = ((Array.isArray(dados) ? dados : []) as any[]).filter((x) => String(x.epg_channel_id ?? "").trim() && !semAdulto(String(x.category_id), "live"));
  const fatia = todos.slice(pg * POR_PAGINA, (pg + 1) * POR_PAGINA);
  const ep = await epgVarios(cred, fatia.map((x) => String(x.stream_id)), 2500);
  const favs = new Set((await favoritosDe(quem(cred))).map((f) => f.stream_id));
  if (!todos.length) return aviso("Guia de Programação", "Nenhum canal da sua lista tem programação disponível.");
  return paginar("Guia de Programação", todos, pg, (x) => canalItem(x, cred, t, String(x.category_id ?? ""), false, "", "", 0, ep.get(String(x.stream_id)), favs),
    (n) => go({ a: "guiahome", t, pg: n }), "0,0,6,1", "live", `${todos.length} canais com programação`, { title: "‹   INÍCIO", titleFooter: "Voltar" });
}

const jogoAcao = (j: Jogo, t: string) => go({ a: "jogo", t, n1: j.casa.nome, n2: j.fora.nome });

async function telaJogos(t: string) {
  const jogos = await jogosDoDia(5000);
  if (jogos === null) return aviso("Jogos de hoje", "Placar indisponível agora. Tente de novo em instantes.");
  if (!jogos.length) return aviso("Jogos de hoje", "Nenhuma partida programada para hoje.");
  const vivos = jogos.filter((j) => j.estado === "in").length;
  // lista com rolagem para baixo; cada cartão é um PNG já com as logos dos times
  return lista("Jogos de hoje", jogos.map((j) => ({ image: jogoPngUrl(j), imageFiller: "fit", color: "transparent", action: jogoAcao(j, t) })),
    "0,0,3,2", {}, `${jogos.length} partidas${vivos ? ` · ${vivos} ao vivo` : ""}`, "live");
}

// ---------- ligar o jogo aos canais da lista do provedor ----------
type CanalProv = { id: string; nome: string; cat: string; tokens: string[]; compacto: string; base: string; qual: number };
type Catalogo = { em: number; canais: CanalProv[]; cats: Map<string, string>; evento: { id: string; nome: string } | null };
const cacheCatalogo = new Map<string, Catalogo>();
const tokensDe = (t: string) => semAcento(String(t ?? "")).match(/[a-z0-9+]+/g) ?? [];
const RUIDO_QUALIDADE = new Set(["fhd", "hd", "sd", "4k", "uhd", "alt", "h265", "hevc", "fullhd", "raw", "backup"]);
const qualidadeDe = (tk: string[]) => (tk.some((x) => ["fhd", "uhd", "4k", "fullhd"].includes(x)) ? 3 : tk.includes("hd") ? 2 : tk.includes("sd") ? 1 : 2) - (tk.includes("alt") ? 1 : 0);

async function catalogoAoVivo(cred: { u: string; p: string }): Promise<Catalogo> {
  const c = cacheCatalogo.get(cred.u);
  if (c && Date.now() - c.em < 10 * 60 * 1000) return c;
  const [cats, streams] = await Promise.all([api(cred, "&action=get_live_categories"), api(cred, "&action=get_live_streams")]);
  const mapa = new Map<string, string>();
  let evento: Catalogo["evento"] = null;
  for (const x of (Array.isArray(cats) ? cats : []) as any[]) {
    const nome = limparNome(String(x.category_name));
    mapa.set(String(x.category_id), nome);
    const n = semAcento(nome);
    if (!evento && /evento/.test(n) && /destaque/.test(n)) evento = { id: String(x.category_id), nome };
  }
  if (!evento) for (const [id, nome] of mapa) if (/evento/.test(semAcento(nome))) { evento = { id, nome }; break; }
  const canais: CanalProv[] = ((Array.isArray(streams) ? streams : []) as any[]).map((x) => {
    const nome = limparNome(String(x.name));
    const tokens = tokensDe(nome);
    return { id: String(x.stream_id), nome, cat: String(x.category_id), tokens, compacto: tokens.join(""), base: tokens.filter((k) => !RUIDO_QUALIDADE.has(k)).join(" "), qual: qualidadeDe(tokens) };
  });
  const novo = { em: Date.now(), canais, cats: mapa, evento };
  if (cacheCatalogo.size > 20) cacheCatalogo.clear();
  cacheCatalogo.set(cred.u, novo);
  return novo;
}

// "PPV ONEFOOTBALL" -> onefootball · "YOUTUBE (CANAL GOL BR)" -> canal gol br · "DISNEY+" -> disney+
function chaveDoCanal(nome: string): string[] {
  const sem = nome.replace(/^ppv\s+/i, "").trim();
  const dentro = sem.match(/\(([^)]+)\)/);
  return tokensDe(dentro ? dentro[1] : sem);
}
const contem = (tokens: string[], chave: string[]) => {
  if (!chave.length) return false;
  const a = " " + tokens.join(" ") + " ", b = " " + chave.join(" ") + " ";
  if (a.includes(b)) return true;
  const ck = chave.join(""), ct = tokens.join("");
  return ck.length >= 6 && ct.includes(ck);
};
const PALAVRAS_FRACAS = new Set(["club", "clube", "futebol", "sport", "sporting", "team", "city", "united", "real", "atletico", "athletic"]);
function pontosTime(c: CanalProv, nome: string) {
  const tk = tokensDe(nome);
  if (tk.length && c.compacto.includes(tk.join(""))) return 3;
  const fortes = tk.filter((w) => w.length >= 4 && !PALAVRAS_FRACAS.has(w) && !/^sub\d*$/.test(w));
  const achou = fortes.filter((w) => c.compacto.includes(w)).length;
  return Math.min(2, achou);
}

async function telaJogo(cred: { u: string; p: string }, t: string, n1: string, n2: string) {
  const jogos = await jogosDoDia(5000);
  const j = (jogos ?? []).find((x) => x.casa.nome === n1 && x.fora.nome === n2);
  if (!j) return aviso("Jogo", "Não encontramos mais este jogo na programação de hoje.");
  const linhaVidro = (i: number, o: Record<string, unknown>) => ({ type: "default", layout: `4,${1 + i},8,1`, color: VID.n, ...o });
  const topo = [
    camadaFundo("bg-tv.jpg"),
    { type: "space", layout: "0,0,12,1", headline: `${j.casa.nome} x ${j.fora.nome}`, text: `{col:msx-white-soft}${j.liga} · ${j.status}` },
    { type: "default", layout: "0,1,4,3", image: jogoImg(j), imageFiller: "fit", color: "transparent", action: "[]" },
  ];
  let cat: Catalogo | null = null;
  try { cat = await catalogoAoVivo(cred); } catch { /* sem catálogo: mostra só o aviso */ }
  const abrirEventos = cat?.evento ? [{ ...linhaVidro(0, {}), title: "Eventos em Destaque", titleFooter: "Ver todos os canais de jogos do dia", action: go({ a: "itens", k: "live", t, c: cat.evento.id, cn: cat.evento.nome }) }] : [];

  // candidatos: canais cujo nome cita os times (principalmente na categoria de eventos) ou que são os canais informados pela API
  const chaves = j.canaisLista.map(chaveDoCanal).filter((k) => k.length);
  const cands: { c: CanalProv; nota: number; evento: boolean }[] = [];
  for (const c of cat?.canais ?? []) {
    const evento = !!cat?.evento && c.cat === cat.evento.id;
    const p1 = pontosTime(c, j.casa.nome), p2 = pontosTime(c, j.fora.nome);
    const times = p1 + p2;
    const porCanal = chaves.some((k) => contem(c.tokens, k));
    const nomeaTimes = evento ? times > 0 : p1 > 0 && p2 > 0;
    if (!nomeaTimes && !porCanal) continue;
    cands.push({ c, evento, nota: (nomeaTimes ? times * 10 : 0) + (porCanal ? 6 : 0) + (evento ? 4 : 0) + c.qual });
  }
  cands.sort((a, b) => b.nota - a.nota);
  const vistos = new Set<string>(), escolhidos: typeof cands = [];
  for (const x of cands) { if (vistos.has(x.c.base)) continue; vistos.add(x.c.base); escolhidos.push(x); if (escolhidos.length >= 4) break; }

  const assistir = escolhidos.map((x, i) => {
    const nomeCat = cat?.cats.get(x.c.cat) ?? "TV ao vivo";
    const item = canalItem({ name: x.c.nome, stream_id: x.c.id, stream_icon: undefined }, cred, t, x.c.cat, false, "", nomeCat, 0, undefined);
    return {
      ...item, ...linhaVidro(i, {}), enumerate: false, focus: i === 0 ? true : undefined,
      imageWidth: undefined, wrapperColor: undefined, icon: undefined, iconSize: undefined,
      title: "Assistir · " + (x.c.nome.length > 40 ? x.c.nome.slice(0, 39) + "…" : x.c.nome), titleFooter: (x.evento ? "Evento em destaque · " : "") + nomeCat, truncation: "title|titleFooter",
      color: i === 0 ? VID.ouro : VID.n,
    };
  });
  if (assistir.length) {
    const extra = abrirEventos.map((e) => ({ ...e, layout: `4,${1 + assistir.length},8,1` }));
    return { type: "pages", transparent: 2, ready: { action: "quiet" }, background: FUNDO_CFG || im("bg-tv.jpg"), pages: [{ items: [...topo, ...assistir, ...extra] }] };
  }
  const onde = j.canaisLista.length ? `Este jogo passa em ${j.canaisLista.join(" · ")}` : "A programação não informou onde passa";
  const aviso1 = { ...linhaVidro(0, {}), title: "Canal não encontrado para este jogo", titleFooter: cat ? onde : "Não foi possível consultar seus canais agora", action: "[]", truncation: "title|titleFooter" };
  const opcoes = [
    ...abrirEventos.map((e) => ({ ...e, layout: "4,2,8,1", focus: true })),
    { ...linhaVidro(abrirEventos.length ? 2 : 1, {}), focus: !abrirEventos.length, title: "TV ao vivo", titleFooter: "Procurar o canal nas categorias", action: go({ a: "cats", k: "live", t }) },
  ];
  return { type: "pages", transparent: 2, ready: { action: "quiet" }, background: FUNDO_CFG || im("bg-tv.jpg"), pages: [{ items: [...topo, aviso1, ...opcoes] }] };
}

// Telemetria de reprodução enviada pelo player da TV (msx/player.html). Guarda o evento e já indica a causa provável.
const _tel = new Map<string, { owner: string | null; dns: string | null; t: number }>();
function causaDoEvento(tipo: string, ct: number | null, pv: number | null, dp: number | null, tt: number | null): string | null {
  if (tipo !== "travada" && tipo !== "erro" && tipo !== "reconexao") return null;
  if (ct === null || ct < 0 || ct > 1500) return "internet"; // nem o nosso servidor respondeu direito: rede/Wi-Fi da TV
  if (pv !== null && (pv < 0 || pv > 2000)) return "provedor"; // rede ok, provedor lento ou sem resposta
  if (dp !== null && tt && tt > 200 && dp / tt > 0.05) return "tv"; // muitos quadros perdidos: decodificador da TV
  return "canal"; // tudo respondeu bem: a origem desse canal falhou
}
async function telemetria(g: URLSearchParams) {
  try {
    const usuario = (g.get("usr") ?? "").slice(0, 80);
    const tipo = g.get("e") ?? "";
    if (!usuario || !["travada", "erro", "reconexao", "inicio", "amostra"].includes(tipo)) return;
    const n = (k: string) => { const v = g.get(k); if (v === null || v === "") return null; const x = Math.round(Number(v)); return Number.isFinite(x) ? x : null; };
    let inf = _tel.get(usuario);
    if (!inf || Date.now() - inf.t > 10 * 60 * 1000) {
      let owner: string | null = null, dns: string | null = null;
      try {
        const r = await fetch(`${SB()}/rest/v1/usuarios_app?usuario=eq.${encodeURIComponent(usuario)}&select=owner_id,dns_id&limit=1`, { headers: sbh(), signal: AbortSignal.timeout(4000) });
        const j = await r.json();
        if (Array.isArray(j) && j[0]) { owner = j[0].owner_id ?? null; dns = j[0].dns_id ?? null; }
      } catch { /* segue sem dono */ }
      inf = { owner, dns, t: Date.now() };
      _tel.set(usuario, inf);
    }
    const ct = n("ct"), pv = n("pv"), dp = n("dp"), tt = n("tt");
    const linha = {
      usuario, owner_id: inf.owner, dns_id: inf.dns, host: (g.get("h") ?? "").slice(0, 120) || null, canal: (g.get("c") ?? "").slice(0, 80) || null,
      aparelho: (g.get("ap") ?? "").slice(0, 80) || null, tipo, dur_ms: n("dur"), ctrl_ms: ct, prov_ms: pv, perdidos: dp, total: tt,
      causa: causaDoEvento(tipo, ct, pv, dp, tt), detalhe: (g.get("d") ?? "").slice(0, 200) || null,
    };
    await fetch(`${SB()}/rest/v1/play_eventos`, { method: "POST", headers: { ...sbh(), prefer: "return=minimal" }, body: JSON.stringify(linha), signal: AbortSignal.timeout(4000) });
  } catch { /* telemetria nunca derruba o app */ }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  const u0 = new URL(req.url);
  const ctx: Rel = { cap: u0.searchParams.get("rl") === "1", rel: new Map(), need: new Set(), relay: false };
  return await ALS.run(ctx, async () => {
  try {
    _ctx = { ip: (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim(), ua: req.headers.get("user-agent") ?? "" };
    const a0 = u0.searchParams.get("a");
    if (req.method === "GET" && a0 === "ping") return new Response(u0.searchParams.get("x") === "tmdb" ? JSON.stringify({ tmdb: !!(Deno.env.get("TMDB_KEY") ?? Deno.env.get("TMDB_API_KEY")), ok: !!(await tmdbGet("/configuration")) }) : "{}", { headers: { ...CORS, "cache-control": "no-store" } });
    if (req.method === "GET" && a0 === "tel") { await telemetria(u0.searchParams); return new Response("{}", { headers: { ...CORS, "cache-control": "no-store" } }); }
    await carregarConfig();
    {
      let dev = idOk(u0.searchParams.get("d"));
      const tk = u0.searchParams.get("t");
      if (!dev && tk) {
        if (!_apToken.has(tk)) { if (_apToken.size > 500) _apToken.clear(); _apToken.set(tk, await aparelhoDoToken(tk)); }
        dev = _apToken.get(tk) ?? null;
      }
      usarTema((await temaDoAparelho(dev)) || (u0.searchParams.get("th") ?? "") || TEMA_PAINEL);
    }
    const mv = u0.pathname.match(/\/v\/(live|movie|series)\/([\w-]+)\/([^/]+)\.(\w+)$/);
    if (mv) {
      const cred = await lerToken(mv[2]);
      if (!cred || cred.bloq) return new Response("Sessão expirada", { status: 403 });
      return new Response(null, { status: 302, headers: { location: urlFluxo(mv[1], cred, decodeURIComponent(mv[3]), mv[4]), "cache-control": "no-store", "access-control-allow-origin": "*" } });
    }
    if (req.method === "GET" && u0.searchParams.get("a") === "img") {
      const g = u0.searchParams;
      const svg = cartaoSvg(g.get("k") ?? "live", g.get("t") ?? "", g.get("s") ?? "", g.get("i") ?? "play", g.get("f") === "p");
      return new Response(svg, { headers: { "access-control-allow-origin": "*", "content-type": "image/svg+xml; charset=utf-8", "cache-control": "public, max-age=86400" } });
    }
    if (req.method === "GET" && u0.searchParams.get("a") === "capas") {
      let gif: Uint8Array | null = null;
      try { gif = await capasGif(u0.searchParams.get("t") ?? "", u0.searchParams.get("th") ?? ""); } catch (e) { console.error("capas", e); }
      if (!gif) return new Response(null, { status: 404 });
      return new Response(gif, { headers: { "access-control-allow-origin": "*", "content-type": "image/gif", "cache-control": "private, max-age=600" } });
    }
    if (req.method === "GET" && u0.searchParams.get("a") === "jgp") {
      try {
        const png = await jogoPng(u0.searchParams);
        return new Response(png, { headers: { "access-control-allow-origin": "*", "content-type": "image/png", "cache-control": "public, max-age=120" } });
      } catch (e) {
        console.error("jgp", e);
        if (u0.searchParams.get("dbg") === "1") return new Response(String((e as Error)?.stack ?? e), { status: 500 });
        const g = new URLSearchParams(u0.searchParams); g.set("a", "jg");
        return new Response(null, { status: 302, headers: { location: `${SELF()}?${g}` } });
      }
    }
    if (req.method === "GET" && u0.searchParams.get("a") === "mt") {
      return new Response(moderno(u0.searchParams), { headers: { "access-control-allow-origin": "*", "content-type": "image/svg+xml; charset=utf-8", "cache-control": "public, max-age=3600" } });
    }
    if (req.method === "GET" && u0.searchParams.get("a") === "bloco") {
      return new Response(blocoSvg(u0.searchParams), { headers: { "access-control-allow-origin": "*", "content-type": "image/svg+xml; charset=utf-8", "cache-control": "public, max-age=3600" } });
    }
    if (req.method === "GET" && u0.searchParams.get("a") === "jgif") { // sem jogos das ligas principais (ou erro): GIF fixo dos times
      let gif: Uint8Array | null = null;
      try { gif = await jogosGif(); } catch (e) {
        console.error("jgif", e);
        if (u0.searchParams.get("dbg") === "1") return new Response(String((e as Error)?.stack ?? e), { status: 500 });
        gif = null;
      }
      if (!gif && u0.searchParams.get("dbg") === "1") return new Response("sem quadros", { status: 500 });
      if (!gif) return new Response(null, { status: 302, headers: { location: IMG + "jogos.gif", "cache-control": "public, max-age=600" } });
      return new Response(gif, { headers: { "access-control-allow-origin": "*", "content-type": "image/gif", "cache-control": "public, max-age=1800" } });
    }
    if (req.method === "GET" && u0.searchParams.get("a") === "av") {
      const g = u0.searchParams;
      return new Response(avatarSvg(g.get("n") ?? "", Number(g.get("c")) || 0, g.get("k") === "1"), { headers: { "access-control-allow-origin": "*", "content-type": "image/svg+xml; charset=utf-8", "cache-control": "public, max-age=86400" } });
    }
    if (req.method === "GET" && (u0.searchParams.get("a") === "jg" || u0.searchParams.get("a") === "jr")) {
      const g = u0.searchParams;
      const svg = g.get("a") === "jg" ? await jogoSvg(g) : resumoSvg(Number(g.get("n")) || 0, Number(g.get("vv")) || 0, g.get("x") === "1");
      return new Response(svg, { headers: { "access-control-allow-origin": "*", "content-type": "image/svg+xml; charset=utf-8", "cache-control": "public, max-age=60" } });
    }
    if (req.method === "POST") {
      const b = await req.json().catch(() => ({}));
      if (ctx.cap) { // a TV devolve o que buscou no provedor: { rel: { url: texto | null } }
        for (const [k, v] of Object.entries((b as any)?.rel ?? {})) ctx.rel.set(k, typeof v === "string" ? v : null);
        return new Response(JSON.stringify(await tratar(u0)), { headers: CORS });
      }
      return new Response(JSON.stringify(await parear(b)), { headers: CORS });
    }
    const corpo = await tratar(u0);
    return new Response(JSON.stringify(corpo), { headers: CORS });
  } catch (e) {
    if (e instanceof RelayNeed) return new Response(JSON.stringify({ __relay: [...ctx.need] }), { headers: CORS });
    return new Response(JSON.stringify(aviso("Erro", "Algo falhou: " + String((e as Error).message ?? e))), { headers: CORS });
  }
  });
});
