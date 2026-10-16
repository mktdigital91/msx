// Mira (MVP de uso próprio): ponte entre o Media Station X (TV) e o provedor Xtream.
// A TV não consegue ler o provedor direto; esta função lê e devolve telas prontas para o MSX.
// O endereço (DNS) do provedor fica AQUI, no Supabase, e não no GitHub público.
// Usuário/senha vêm da TV, viram um token criptografado (30 dias) e não são guardados.

const PROVEDOR = { host: "horizonmult.site", protocolo: "http" };
const POR_PAGINA = 60;
const VALIDADE_MS = 30 * 24 * 3600 * 1000;
const INPUT = "http://msx.benzac.de/interaction/input.html";

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, x-client-info, apikey, content-type",
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
};

const IMG = "https://mktdigital91.github.io/msx/msx/img/";
const COR = { tv: "rgba(124,92,255,0.40)", vod: "rgba(244,63,142,0.38)", series: "rgba(34,211,238,0.32)", vidro: "rgba(255,255,255,0.08)", destaque: "#7C5CFF" };

const BASE_PROV = `${PROVEDOR.protocolo}://${PROVEDOR.host}`;

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
async function criarToken(u: string, p: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const dados = new TextEncoder().encode(JSON.stringify({ u, p, e: Date.now() + VALIDADE_MS }));
  const c = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await chave(), dados));
  const t = new Uint8Array(iv.length + c.length);
  t.set(iv); t.set(c, iv.length);
  return b64(t);
}
async function lerToken(t: string | null): Promise<{ u: string; p: string } | null> {
  if (!t) return null;
  try {
    const raw = unb64(t);
    const d = await crypto.subtle.decrypt({ name: "AES-GCM", iv: raw.slice(0, 12) }, await chave(), raw.slice(12));
    const o = JSON.parse(new TextDecoder().decode(d));
    return o.e > Date.now() ? { u: o.u, p: o.p } : null;
  } catch {
    return null;
  }
}

// ---------- provedor ----------
async function api(cred: { u: string; p: string }, extra = "") {
  const url = `${BASE_PROV}/player_api.php?username=${encodeURIComponent(cred.u)}&password=${encodeURIComponent(cred.p)}${extra}`;
  const r = await fetch(url, { signal: AbortSignal.timeout(20000), headers: { "user-agent": "Mozilla/5.0" } });
  if (!r.ok) throw new Error("provedor respondeu " + r.status);
  const txt = await r.text();
  try { return JSON.parse(txt); } catch { return null; } // provedor devolve vazio/HTML com login inválido
}
const urlFluxo = (tipo: string, c: { u: string; p: string }, id: string | number, ext?: string) =>
  `${BASE_PROV}/${tipo}/${encodeURIComponent(c.u)}/${encodeURIComponent(c.p)}/${id}${ext ? "." + ext : ""}`;

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

// ---------- pareamento pelo celular (código de 6 letras/números, vale 10 min) ----------
const REST_COD = () => `${Deno.env.get("SUPABASE_URL")}/rest/v1/pareamentos`;
const VALIDADE_COD_MS = 10 * 60 * 1000;
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
const PLUGIN = "https://mktdigital91.github.io/msx/msx/mira.html";
const PAGINA_CELULAR = "https://mktdigital91.github.io/msx/entrar/";

// Chamado pela página do celular: confere o código, valida usuário e senha e liga a sessão à TV.
async function parear(corpo: { c?: string; u?: string; p?: string }) {
  const codigo = String(corpo.c ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const u = String(corpo.u ?? "").trim();
  const p = String(corpo.p ?? "");
  if (codigo.length !== 6) return { ok: false, erro: "codigo" };
  if (!u || !p) return { ok: false, erro: "campos" };
  const aparelho = await aparelhoDoCodigo(codigo);
  if (!aparelho) return { ok: false, erro: "codigo" };
  let info;
  try { info = await api({ u, p }); } catch { return { ok: false, erro: "provedor" }; }
  if (!info?.user_info || Number(info.user_info.auth) !== 1) return { ok: false, erro: "credenciais" };
  await salvarSessao(aparelho, await criarToken(u, p));
  await apagarCodigo(codigo);
  return { ok: true, usuario: u };
}

const SELF = () => `${Deno.env.get("SUPABASE_URL")}/functions/v1/mira`;
const q = (o: Record<string, string | number>) =>
  Object.entries(o).map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join("&");
const go = (o: Record<string, string | number>) => `content:${SELF()}?${q(o)}`;

function inputAction(servico: string, titulo: string, dica: string) {
  // {INPUT} fica sem codificar: o plugin do MSX o substitui pelo que foi digitado
  return `content:request:interaction:${servico}|default|pt|${titulo}|||${dica}|@${INPUT}`;
}

function lista(headline: string, items: unknown[], layout = "0,0,4,1", extra: Record<string, unknown> = {}, extensao?: string) {
  return { type: "list", headline, extension: extensao, background: IMG + "fundo.jpg", template: { type: "separate", layout, color: COR.vidro, ...extra }, items };
}
function aviso(titulo: string, msg: string, voltar?: unknown[]) {
  return lista(titulo, [{ title: msg, action: "none" }, ...(voltar ?? [])], "0,0,12,1");
}
function telaCelular(codigo: string | null, d: string | null, msg?: string) {
  const link = codigo ? `${PAGINA_CELULAR}?c=${codigo}` : PAGINA_CELULAR;
  const qr = `https://api.qrserver.com/v1/create-qr-code/?size=500x500&margin=2&data=${encodeURIComponent(link)}`;
  return {
    type: "pages", background: IMG + "fundo.jpg",
    pages: [{ items: [
      { type: "space", layout: "0,0,12,1", headline: "Entre pelo celular", text: msg ?? "Aponte a câmera para o QR code e digite seu usuário e senha no celular." },
      { id: "qr", type: "default", layout: "0,1,4,4", color: "#FFFFFF", image: qr, imageFiller: "fit", action: "none", focus: true },
      { type: "default", layout: "4,1,8,1", color: COR.vidro, titleHeader: "OU ACESSE NO NAVEGADOR", title: PAGINA_CELULAR.replace("https://", ""), action: "none" },
      { type: "default", layout: "4,2,8,2", color: COR.destaque, titleHeader: "CÓDIGO DA SUA TV", title: codigo ? codigo.split("").join(" ") : "indisponível", titleFooter: "Vale por 10 minutos. A TV entra sozinha.", action: "none" },
      { type: "default", layout: "4,4,4,1", color: COR.vidro, icon: "refresh", iconSize: "small", title: "Novo código", action: go(d ? { a: "inicio", d, r: Date.now() } : { a: "inicio" }) },
      { type: "default", layout: "8,4,4,1", color: COR.vidro, icon: "keyboard", iconSize: "small", title: "Digitar na TV", action: go(d ? { a: "form", d } : { a: "form" }) },
    ] }],
  };
}

function telaEntrar(msg?: string, d?: string | null, u = "", p = "", auto = false) {
  const base = (o: Record<string, string>) => (d ? { ...o, d } : o);
  const eu = u ? { u } : {};
  const ep = p ? { p } : {};
  const pronto = !!(u && p);
  const campoUsuario = {
    id: "usuario", type: "default", layout: "6,2,5,1", color: COR.vidro,
    titleHeader: "USUÁRIO", title: u || "Toque para digitar",
    focus: !u,
    action: inputAction(`${SELF()}?${q(base({ a: "in", f: "u", ...ep }))}&v={INPUT}`, "Usuário", "Digite o usuário e confirme"),
  };
  const campoSenha = {
    id: "senha", type: "default", layout: "6,3,5,1", color: COR.vidro,
    titleHeader: "SENHA", title: p ? "••••••••" : "Toque para digitar",
    focus: !!u && !p, execute: auto && !!u && !p,
    action: inputAction(`${SELF()}?${q(base({ a: "in", f: "p", ...eu }))}&v={INPUT}`, "Senha", "Digite a senha e confirme"),
  };
  const botao = {
    id: "entrar", type: "default", layout: "6,4,5,1", color: COR.destaque,
    icon: "login", iconSize: "small", title: "Entrar", titleFooter: pronto ? "" : "Preencha usuário e senha",
    focus: pronto, execute: auto && pronto,
    action: pronto ? go(base({ a: "login", u, p })) : "warn:Preencha o usuário e a senha",
  };
  return {
    type: "pages", background: IMG + "login.jpg",
    pages: [{ items: [
      { type: "space", layout: "6,1,5,1", headline: "Entrar", text: msg ?? "Use o usuário e a senha da sua lista" },
      campoUsuario, campoSenha, botao,
    ] }],
  };
}

async function paginar(
  titulo: string,
  todos: any[],
  pg: number,
  montar: (x: any) => unknown,
  proxima: (n: number) => string,
  layout: string,
  cor: string,
  ext?: string,
) {
  const ini = pg * POR_PAGINA;
  const itens = todos.slice(ini, ini + POR_PAGINA).map(montar) as unknown[];
  if (ini + POR_PAGINA < todos.length) itens.push({ title: `Próxima página`, titleFooter: `${pg + 2} de ${Math.ceil(todos.length / POR_PAGINA)}`, icon: "navigate-next", color: cor, action: proxima(pg + 1) });
  if (pg > 0) itens.unshift({ title: "Página anterior", titleFooter: `${pg} de ${Math.ceil(todos.length / POR_PAGINA)}`, icon: "navigate-before", color: cor, action: proxima(pg - 1) });
  if (!todos.length) itens.push({ title: "Nada encontrado", action: "none" });
  return lista(titulo, itens, layout, {}, ext ?? `${todos.length} itens`);
}
const nota = (v: unknown) => { const n = Number(v); return n > 0 ? n.toFixed(1) : undefined; };

async function tratar(url: URL) {
  const a = url.searchParams.get("a") ?? "inicio";
  const pg = Math.max(0, parseInt(url.searchParams.get("pg") ?? "0", 10) || 0);

  const d = idOk(url.searchParams.get("d"));

  if (a === "inicio") {
    const tk = await lerSessao(d);
    const cr = await lerToken(tk);
    if (tk && cr) return await home(tk, cr.u, d);
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

  if (a === "login") {
    const u = (url.searchParams.get("u") ?? "").trim();
    const p = url.searchParams.get("p") ?? "";
    if (!u || !p) return telaEntrar("Informe usuário e senha", d, u, "");
    let info;
    try { info = await api({ u, p }); } catch (e) { return telaEntrar("Provedor: " + String((e as Error).message ?? e).slice(0, 80), d, u, ""); }
    if (!info?.user_info || Number(info.user_info.auth) !== 1) return telaEntrar("Usuário ou senha incorretos", d, u, "");
    const exp = info.user_info.exp_date ? new Date(Number(info.user_info.exp_date) * 1000).toLocaleDateString("pt-BR") : "sem data";
    const tk = await criarToken(u, p);
    await salvarSessao(d, tk);
    return await home(tk, `${u} · vence ${exp}`, d);
  }

  const cred = await lerToken(url.searchParams.get("t"));
  if (!cred) return telaEntrar("Sessão expirada, entre de novo", d);
  const t = url.searchParams.get("t")!;
  const c = url.searchParams.get("c") ?? "";

  if (a === "home") return await home(t, cred.u, d);

  const TIPOS = {
    live: { nome: "TV ao vivo", cats: "get_live_categories", itens: "get_live_streams", cor: COR.tv, icone: "live-tv" },
    vod: { nome: "Filmes", cats: "get_vod_categories", itens: "get_vod_streams", cor: COR.vod, icone: "movie" },
    series: { nome: "Séries", cats: "get_series_categories", itens: "get_series", cor: COR.series, icone: "tv" },
  } as const;
  const tipoQ = url.searchParams.get("k") as keyof typeof TIPOS;
  const T = TIPOS[tipoQ];

  if (a === "cats") {
    if (!T) return aviso("Mira", "Seção desconhecida");
    const cats = await api(cred, `&action=${T.cats}`);
    const lst = Array.isArray(cats) ? cats : [];
    const itens = [
      { title: "Todos", titleFooter: "Ver tudo", icon: "apps", color: T.cor, action: go({ a: "itens", k: tipoQ, t, c: "" }) },
      ...lst.map((x: any) => ({ title: String(x.category_name), icon: T.icone, color: COR.vidro, action: go({ a: "itens", k: tipoQ, t, c: x.category_id }) })),
    ];
    return lista(T.nome, itens, "0,0,3,2", { iconSize: "medium" }, `${lst.length} categorias`);
  }

  if (a === "itens") {
    if (!T) return aviso("Mira", "Seção desconhecida");
    const dados = await api(cred, `&action=${T.itens}${c ? "&category_id=" + encodeURIComponent(c) : ""}`);
    const todos = Array.isArray(dados) ? dados : [];
    const prox = (n: number) => go({ a: "itens", k: tipoQ, t, c, pg: n });
    if (tipoQ === "live") {
      return paginar("Canais", todos, pg, (x) => ({
        title: String(x.name), image: x.stream_icon || undefined, imageFiller: "smart",
        icon: x.stream_icon ? undefined : "live-tv", color: COR.vidro,
        action: `video:${urlFluxo("live", cred, x.stream_id, "ts")}`, playerLabel: String(x.name),
      }), prox, "0,0,3,2", T.cor);
    }
    if (tipoQ === "vod") {
      return paginar("Filmes", todos, pg, (x) => ({
        title: String(x.name), image: x.stream_icon || undefined, imageFiller: "cover",
        icon: x.stream_icon ? undefined : "movie", color: COR.vidro,
        tag: nota(x.rating), tagColor: "rgba(0,0,0,0.65)",
        action: `video:${urlFluxo("movie", cred, x.stream_id, x.container_extension || "mp4")}`, playerLabel: String(x.name),
      }), prox, "0,0,2,3", T.cor);
    }
    return paginar("Séries", todos, pg, (x) => ({
      title: String(x.name), image: x.cover || undefined, imageFiller: "cover",
      icon: x.cover ? undefined : "tv", color: COR.vidro,
      tag: nota(x.rating), tagColor: "rgba(0,0,0,0.65)",
      action: go({ a: "serie", t, s: x.series_id }),
    }), prox, "0,0,2,3", T.cor);
  }

  if (a === "serie") {
    const s = url.searchParams.get("s") ?? "";
    const temp = url.searchParams.get("n");
    const info = await api(cred, `&action=get_series_info&series_id=${encodeURIComponent(s)}`);
    const nome = String(info?.info?.name ?? "Série");
    const eps = info?.episodes ?? {};
    const numeros = Object.keys(eps).sort((x, y) => Number(x) - Number(y));
    if (temp === null) {
      return lista(nome, numeros.map((n) => ({
        title: `Temporada ${n}`, titleFooter: `${eps[n].length} episódios`, icon: "tv", color: COR.series,
        action: go({ a: "serie", t, s, n }),
      })), "0,0,3,2", {}, `${numeros.length} temporadas`);
    }
    const lst = (eps[temp] ?? []) as any[];
    return lista(`${nome}`, lst.map((e) => ({
      titleHeader: `Episódio ${e.episode_num}`, title: String(e.title ?? ""), titleFooter: e.info?.duration ? String(e.info.duration) : "",
      image: e.info?.movie_image || undefined, imageFiller: "cover", icon: e.info?.movie_image ? undefined : "play-arrow", color: COR.vidro,
      action: `video:${urlFluxo("series", cred, e.id, e.container_extension || "mp4")}`,
      playerLabel: `${nome} T${temp}E${e.episode_num}`,
    })), "0,0,4,2", {}, `Temporada ${temp}`);
  }

  return aviso("Mira", "Tela não encontrada");
}

async function home(t: string, quem: string, d: string | null = null) {
  const [usuario, venc] = quem.split(" · ");
  return {
    type: "pages", background: IMG + "fundo.jpg",
    pages: [{ items: [
      { type: "space", layout: "0,0,8,1", headline: `Olá, ${usuario}`, text: venc ?? "" },
      { type: "default", layout: "10,0,2,1", color: "rgba(255,255,255,0.10)", icon: "logout", iconSize: "small", title: "Sair", action: d ? `content:request:interaction:sair@${PLUGIN}` : go({ a: "inicio" }) },
      { id: "tv", type: "default", layout: "0,1,4,5", image: IMG + "card-tv.jpg", imageFiller: "cover", title: "TV ao vivo", titleFooter: "Canais por categoria", focus: true, action: go({ a: "cats", k: "live", t }) },
      { type: "default", layout: "4,1,4,5", image: IMG + "card-filmes.jpg", imageFiller: "cover", title: "Filmes", titleFooter: "Catálogo completo", action: go({ a: "cats", k: "vod", t }) },
      { type: "default", layout: "8,1,4,5", image: IMG + "card-series.jpg", imageFiller: "cover", title: "Séries", titleFooter: "Temporadas e episódios", action: go({ a: "cats", k: "series", t }) },
    ] }],
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  try {
    if (req.method === "POST") {
      const b = await req.json().catch(() => ({}));
      return new Response(JSON.stringify(await parear(b)), { headers: CORS });
    }
    const corpo = await tratar(new URL(req.url));
    return new Response(JSON.stringify(corpo), { headers: CORS });
  } catch (e) {
    return new Response(JSON.stringify(aviso("Erro", "Algo falhou: " + String((e as Error).message ?? e))), { headers: CORS });
  }
});
