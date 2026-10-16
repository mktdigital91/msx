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

const SELF = () => `${Deno.env.get("SUPABASE_URL")}/functions/v1/mira`;
const q = (o: Record<string, string | number>) =>
  Object.entries(o).map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join("&");
const go = (o: Record<string, string | number>) => `content:${SELF()}?${q(o)}`;

function inputAction(servico: string, titulo: string, dica: string) {
  // {INPUT} fica sem codificar: o plugin do MSX o substitui pelo que foi digitado
  return `content:request:interaction:${servico}|default|pt|${titulo}|||${dica}|@${INPUT}`;
}

function lista(headline: string, items: unknown[], layout = "0,0,4,1", extra: Record<string, unknown> = {}) {
  return { type: "list", headline, template: { type: "separate", layout, color: "msx-glass", ...extra }, items };
}
function aviso(titulo: string, msg: string, voltar?: unknown[]) {
  return lista(titulo, [{ title: msg, action: "none" }, ...(voltar ?? [])], "0,0,12,1");
}
function telaEntrar(msg?: string, d?: string | null) {
  return lista("Mira", [
    ...(msg ? [{ title: msg, action: "none", color: "msx-red" }] : []),
    {
      title: "Entrar",
      titleFooter: "Digite usuário e depois senha",
      icon: "login",
      action: inputAction(`${SELF()}?${q(d ? { a: "senha", d } : { a: "senha" })}&u={INPUT}`, "Usuário", "Digite o usuário e confirme"),
    },
  ], "0,0,6,2");
}

async function paginar(
  titulo: string,
  todos: any[],
  pg: number,
  montar: (x: any) => unknown,
  proxima: (n: number) => string,
  layout: string,
) {
  const ini = pg * POR_PAGINA;
  const itens = todos.slice(ini, ini + POR_PAGINA).map(montar) as unknown[];
  if (ini + POR_PAGINA < todos.length) itens.push({ title: `Próxima página (${pg + 2})`, icon: "navigate-next", action: proxima(pg + 1) });
  if (pg > 0) itens.unshift({ title: "Página anterior", icon: "navigate-before", action: proxima(pg - 1) });
  if (!todos.length) itens.push({ title: "Nada encontrado", action: "none" });
  return lista(`${titulo} (${todos.length})`, itens, layout);
}

async function tratar(url: URL) {
  const a = url.searchParams.get("a") ?? "inicio";
  const pg = Math.max(0, parseInt(url.searchParams.get("pg") ?? "0", 10) || 0);

  const d = idOk(url.searchParams.get("d"));

  if (a === "inicio") {
    const tk = await lerSessao(d);
    const cr = await lerToken(tk);
    if (tk && cr) return await home(tk, cr.u, d);
    return telaEntrar(undefined, d);
  }

  if (a === "sair") {
    await apagarSessao(d);
    return telaEntrar("Você saiu", d);
  }

  if (a === "senha") {
    const u = (url.searchParams.get("u") ?? "").trim();
    if (!u) return telaEntrar("Usuário vazio", d);
    return lista(`Usuário: ${u}`, [{
      title: "Digitar senha",
      icon: "vpn-key",
      action: inputAction(`${SELF()}?${q(d ? { a: "login", u, d } : { a: "login", u })}&p={INPUT}`, "Senha", "Digite a senha e confirme"),
    }, { title: "Trocar usuário", icon: "undo", action: go(d ? { a: "inicio", d } : { a: "inicio" }) }], "0,0,6,2");
  }

  if (a === "login") {
    const u = (url.searchParams.get("u") ?? "").trim();
    const p = url.searchParams.get("p") ?? "";
    if (!u || !p) return telaEntrar("Informe usuário e senha", d);
    let info;
    try { info = await api({ u, p }); } catch (e) { return telaEntrar("Provedor: " + String((e as Error).message ?? e).slice(0, 80), d); }
    if (!info?.user_info || Number(info.user_info.auth) !== 1) return telaEntrar("Usuário ou senha incorretos", d);
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

  const grupo = (nome: string, tipo: "live" | "vod" | "series") => ({
    cats: `get_${tipo}_categories`,
    itens: tipo === "series" ? "get_series" : `get_${tipo}_streams`,
    nome,
  });

  if (a === "cats") {
    const tipo = url.searchParams.get("k") as "live" | "vod" | "series";
    const g = grupo({ live: "TV ao vivo", vod: "Filmes", series: "Séries" }[tipo] ?? "?", tipo);
    const cats = await api(cred, `&action=${g.cats}`);
    const itens = [
      { title: "Todos", icon: "apps", action: go({ a: "itens", k: tipo, t, c: "" }) },
      ...(Array.isArray(cats) ? cats : []).map((x: any) => ({
        title: String(x.category_name),
        action: go({ a: "itens", k: tipo, t, c: x.category_id }),
      })),
    ];
    return lista(g.nome, itens, "0,0,4,1");
  }

  if (a === "itens") {
    const tipo = url.searchParams.get("k") as "live" | "vod" | "series";
    const g = grupo("", tipo);
    const dados = await api(cred, `&action=${g.itens}${c ? "&category_id=" + encodeURIComponent(c) : ""}`);
    const todos = Array.isArray(dados) ? dados : [];
    const titulo = { live: "Canais", vod: "Filmes", series: "Séries" }[tipo] ?? "?";
    const prox = (n: number) => go({ a: "itens", k: tipo, t, c, pg: n });
    if (tipo === "live") {
      return paginar(titulo, todos, pg, (x) => ({
        title: String(x.name), image: x.stream_icon || undefined,
        action: `video:${urlFluxo("live", cred, x.stream_id, "ts")}`, playerLabel: String(x.name),
      }), prox, "0,0,4,1");
    }
    if (tipo === "vod") {
      return paginar(titulo, todos, pg, (x) => ({
        title: String(x.name), image: x.stream_icon || undefined,
        action: `video:${urlFluxo("movie", cred, x.stream_id, x.container_extension || "mp4")}`, playerLabel: String(x.name),
      }), prox, "0,0,2,3");
    }
    return paginar(titulo, todos, pg, (x) => ({
      title: String(x.name), image: x.cover || undefined,
      action: go({ a: "serie", t, s: x.series_id }),
    }), prox, "0,0,2,3");
  }

  if (a === "serie") {
    const s = url.searchParams.get("s") ?? "";
    const temp = url.searchParams.get("n");
    const info = await api(cred, `&action=get_series_info&series_id=${encodeURIComponent(s)}`);
    const nome = info?.info?.name ?? "Série";
    const eps = info?.episodes ?? {};
    const numeros = Object.keys(eps).sort((x, y) => Number(x) - Number(y));
    if (temp === null) {
      return lista(String(nome), numeros.map((n) => ({
        title: `Temporada ${n}`, titleFooter: `${eps[n].length} episódios`,
        action: go({ a: "serie", t, s, n }),
      })), "0,0,4,1");
    }
    const lst = (eps[temp] ?? []) as any[];
    return lista(`${nome} · Temporada ${temp}`, lst.map((e) => ({
      title: `${e.episode_num}. ${e.title ?? ""}`,
      action: `video:${urlFluxo("series", cred, e.id, e.container_extension || "mp4")}`,
      playerLabel: `${nome} T${temp}E${e.episode_num}`,
    })), "0,0,6,1");
  }

  return aviso("Mira", "Tela não encontrada");
}

async function home(t: string, quem: string, d: string | null = null) {
  return lista(`Mira · ${quem}`, [
    { title: "TV ao vivo", icon: "live-tv", action: go({ a: "cats", k: "live", t }) },
    { title: "Filmes", icon: "movie", action: go({ a: "cats", k: "vod", t }) },
    { title: "Séries", icon: "tv", action: go({ a: "cats", k: "series", t }) },
    { title: "Sair", icon: "logout", action: go(d ? { a: "sair", d } : { a: "inicio" }) },
  ], "0,0,4,2");
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  try {
    const corpo = await tratar(new URL(req.url));
    return new Response(JSON.stringify(corpo), { headers: CORS });
  } catch (e) {
    return new Response(JSON.stringify(aviso("Erro", "Algo falhou: " + String((e as Error).message ?? e))), { headers: CORS });
  }
});
