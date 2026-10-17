// Gold Play (MVP de uso próprio): ponte entre o Media Station X (TV) e o provedor Xtream.
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
const LOGO = IMG + "logo-goldplay.png";
const COR = { tv: "rgba(124,92,255,0.40)", vod: "rgba(244,63,142,0.38)", series: "rgba(34,211,238,0.32)", vidro: "rgba(14,16,36,0.55)", destaque: "#7C5CFF" };

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
// ---------- favoritos (por usuário do provedor) ----------
const REST_FAV = () => `${Deno.env.get("SUPABASE_URL")}/rest/v1/favoritos`;
type Fav = { stream_id: string; name: string; stream_icon?: string };
async function favoritosDe(u: string): Promise<Fav[]> {
  try {
    const r = await fetch(`${REST_FAV()}?usuario=eq.${encodeURIComponent(u)}&select=stream_id,nome,icone&order=criado.desc&limit=400`, { headers: cab(), signal: AbortSignal.timeout(6000) });
    const j = await r.json();
    return Array.isArray(j) ? j.map((x: any) => ({ stream_id: String(x.stream_id), name: String(x.nome), stream_icon: x.icone || undefined })) : [];
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
  const pal = PALETAS[k] ?? PALETAS.live;
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
const cartao = (k: string, t: string, s = "", i = "play", retrato = false) => `${Deno.env.get("SUPABASE_URL")}/functions/v1/mira?${new URLSearchParams({ a: "img", k, t: limparNome(t).slice(0, 70), s, i, ...(retrato ? { f: "p" } : {}) }).toString()}`;

// botões de vidro retos: só cor do MSX (sem imagem), mais leve e sem cantos aparecendo atrás
const VID = { n: "rgba(10,12,28,0.62)", ouro: "rgba(245,180,0,0.32)", voltar: "rgba(6,7,14,0.88)" };

const SELF = () => `${Deno.env.get("SUPABASE_URL")}/functions/v1/mira`;
const q = (o: Record<string, string | number>) =>
  Object.entries(o).map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join("&");
const go = (o: Record<string, string | number>) => `content:${SELF()}?${q(o)}`;
// endereço do vídeo passando pelo servidor: a TV (e qualquer mensagem de erro) não vê o DNS nem usuário/senha do provedor
const fluxo = (tipo: string, t: string, id: string | number, ext: string) => `${SELF()}/v/${tipo}/${t}/${encodeURIComponent(String(id))}.${ext.replace(/[^a-z0-9]/gi, "")}`;
// toca pelo player próprio (msx/player.html): erro em português e sem mostrar nenhum link; canais tentam .ts e depois .m3u8
const PLAYER = "https://mktdigital91.github.io/msx/msx/player.html";
// o player recebe o endereço direto do provedor (codificado, nunca exibido): sem passar pelo servidor, abre mais rápido
const tocar = (tipo: string, cred: { u: string; p: string }, id: string | number, ext: string, oque: string) => {
  const fontes = [urlFluxo(tipo, cred, id, ext), ...(tipo === "live" ? [urlFluxo(tipo, cred, id, "m3u8")] : [])].join("\n");
  return `video:plugin:${PLAYER}?${q({ f: b64(new TextEncoder().encode(fontes)), m: oque })}`;
};

function inputAction(servico: string, titulo: string, dica: string) {
  // {INPUT} fica sem codificar: o plugin do MSX o substitui pelo que foi digitado
  return `content:request:interaction:${servico}|default|pt|${titulo}|||${dica}|@${INPUT}`;
}

const FUNDO: Record<string, string> = { live: "bg-tv.jpg", vod: "bg-filmes.jpg", series: "bg-series.jpg" };
// O MSX ignora o "background" da raiz nessas telas; então o fundo vira um item de tela cheia atrás dos blocos.
const camadaFundo = (img: string) => ({ type: "space", layout: "0,0,12,6", offset: "-1,-1,2,2", image: IMG + img, imageFiller: "cover", enable: false });
// Monta uma lista como páginas (grade 12x6) para poder ter o fundo em cada página.
function lista(headline: string, items: unknown[], layout = "0,0,4,1", extra: Record<string, unknown> = {}, extensao?: string, kind = "") {
  const [, , w, h] = layout.split(",").map(Number);
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
  return { type: "pages", headline, extension: extensao, transparent: 2, ready: { action: "quiet" }, background: IMG + (FUNDO[kind] ?? "bg-tv.jpg"), pages };
}
function aviso(titulo: string, msg: string, voltar?: unknown[]) {
  return lista(titulo, [{ title: msg, action: "none" }, ...(voltar ?? [])], "0,0,12,1");
}
// Tela única de login: à esquerda o QR code / código para entrar pelo celular, à direita usuário e senha na TV.
function telaLogin(codigo: string | null, d: string | null, msg?: string, u = "", p = "", auto = false) {
  const link = codigo ? `${PAGINA_CELULAR}?c=${codigo}` : PAGINA_CELULAR;
  const qr = `https://api.qrserver.com/v1/create-qr-code/?size=500x500&margin=2&data=${encodeURIComponent(link)}`;
  const base = (o: Record<string, string>) => (d ? { ...o, d } : o);
  const eu = u ? { u } : {};
  const ep = p ? { p } : {};
  const pronto = !!(u && p);
  return {
    type: "pages", transparent: 2, ready: { action: "quiet" }, background: IMG + "bg-tv.jpg",
    pages: [{ items: [
      camadaFundo("bg-tv.jpg"),
      { type: "space", layout: "0,0,9,1", headline: "Entrar no Gold Play", text: msg ?? "Escaneie o QR code com o celular ou digite seu usuário e senha aqui na TV." },
      { type: "space", layout: "10,0,2,1", image: LOGO, imageFiller: "fit" },
      // ---- lado esquerdo: pelo celular ----
      { id: "qr", type: "default", layout: "0,1,3,3", color: "#FFFFFF", image: qr, imageFiller: "fit", action: "none" },
      { type: "default", layout: "3,1,3,2", color: COR.destaque, titleHeader: "PELO CELULAR  ·  CÓDIGO", title: codigo ? codigo.split("").join(" ") : "indisponível", titleFooter: "Vale 10 min. A TV entra sozinha.", action: "none" },
      { type: "default", layout: "3,3,3,1", color: COR.vidro, title: "Novo código", titleFooter: "Gerar outro QR code", action: go(d ? { a: "inicio", d, r: Date.now() } : { a: "inicio" }) },
      { type: "default", layout: "0,4,6,1", color: COR.vidro, titleHeader: "OU ACESSE NO NAVEGADOR DO CELULAR", title: PAGINA_CELULAR.replace("https://", "").replace(/\/$/, ""), action: "none" },
      // ---- divisória ----
      { type: "space", layout: "6,2,1,2", title: "ou", alignment: "center", centration: "title" },
      // ---- lado direito: usuário e senha na TV ----
      {
        id: "usuario", type: "default", layout: "7,1,5,1", color: COR.vidro,
        titleHeader: "USUÁRIO", title: u || "Toque para digitar", focus: !u && !p,
        action: inputAction(`${SELF()}?${q(base({ a: "in", f: "u", ...ep }))}&v={INPUT}`, "Usuário", "Digite o usuário e confirme"),
      },
      {
        id: "senha", type: "default", layout: "7,2,5,1", color: COR.vidro,
        titleHeader: "SENHA", title: p ? "••••••••" : "Toque para digitar",
        focus: !!u && !p, execute: auto && !!u && !p,
        action: inputAction(`${SELF()}?${q(base({ a: "in", f: "p", ...eu }))}&v={INPUT}`, "Senha", "Digite a senha e confirme"),
      },
      {
        id: "entrar", type: "default", layout: "7,3,5,1", color: COR.destaque,
        title: "Entrar", titleFooter: pronto ? "Tudo pronto" : "Preencha usuário e senha",
        focus: pronto, execute: auto && pronto,
        action: pronto ? go(base({ a: "login", u, p })) : "warn:Preencha o usuário e a senha",
      },
    ] }],
  };
}
const telaCelular = (codigo: string | null, d: string | null, msg?: string) => telaLogin(codigo, d, msg);
async function telaEntrar(msg?: string, d?: string | null, u = "", p = "", auto = false) {
  return telaLogin(await codigoDoAparelho(d ?? null), d ?? null, msg, u, p, auto);
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
) {
  const ini = pg * POR_PAGINA;
  const itens = todos.slice(ini, ini + POR_PAGINA).map(montar) as any[];
  if (itens.length) itens[0] = { ...itens[0], focus: true }; // foco no 1º item, não no botão de categorias
  const total = Math.ceil(todos.length / POR_PAGINA);
  if (ini + POR_PAGINA < todos.length) itens.push({ title: "Próxima página", titleFooter: `${pg + 2} de ${total}`, color: VID.n, action: proxima(pg + 1) });
  if (pg > 0) itens.unshift({ title: "Página anterior", titleFooter: `${pg} de ${total}`, color: VID.n, action: proxima(pg - 1) });
  if (!todos.length) itens.push({ title: "Nada encontrado", action: "none" });
  // botão fixo no topo para voltar às categorias (volta para a tela anterior, sem recarregar)
  itens.unshift({ title: "‹   CATEGORIAS", titleFooter: "Voltar às categorias", color: VID.voltar, action: "back" });
  return lista(titulo, itens, layout, {}, ext ?? `${todos.length} itens`, kind);
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
    const j = await api(cred, `&action=get_short_epg&stream_id=${encodeURIComponent(id)}&limit=3`);
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
function canalItem(x: any, cred: { u: string; p: string }, t: string, c: string, painel = false, atual = "", cn = "", n = 0, epg?: Prog[], favs?: Set<string>) {
  const nome = limparNome(String(x.name));
  const guia = textoEpg(epg);
  const logo = x.stream_icon || undefined;
  const lista = `panel:${SELF()}?${q({ a: "painel", t, c, cn, s: x.stream_id })}`;
  const ativo = painel && String(x.stream_id) === atual;
  const visual = painel
    ? { color: ativo ? VID.ouro : VID.n }
    : { image: logo, imageWidth: 1, imageFiller: "fit", wrapperColor: "rgba(255,255,255,0.06)", icon: logo ? undefined : "live-tv", iconSize: "small", color: VID.n };
  return {
    title: (ativo ? "▶  " : "") + (favs?.has(String(x.stream_id)) ? CORACAO : "") + nome, titleFooter: guia.linha || "TV Ao Vivo", truncation: "title|titleFooter",
    ...visual,
    focus: ativo ? true : undefined, enumerate: true,
    playerLabel: nome,
    action: tocar("live", cred, x.stream_id, "ts", "o canal"),
    properties: {
      "control:type": "extended",
      "control:transparent": true,
      "control:action": lista,
      "info:headline": nome,
      "info:text": guia.player || "TV Ao Vivo",
      "button:content:icon": "list",
      "button:content:action": lista,
      "button:content:focus": true,
      "trigger:ready": "player:button:content:focus",
      "trigger:start": "player:button:content:focus",
      "trigger:back": "quiet",
      "control:retune": "retain",
      "button:forward:icon": "apps",
      "button:forward:action": `panel:${SELF()}?${q({ a: "pcats", t, s: x.stream_id })}`,
      "button:rewind:display": false,
      "button:speed:display": false,
    },
  };
}
const b64txt = (v: unknown) => { try { return new TextDecoder().decode(Uint8Array.from(atob(String(v ?? "")), (ch) => ch.charCodeAt(0))); } catch { return String(v ?? ""); } };
const hora = (v: unknown) => { const m = String(v ?? "").match(/(\d{2}):(\d{2})/); return m ? `${m[1]}:${m[2]}` : ""; };

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

  if (a === "home") return await home(t, cred.u, d ?? (await aparelhoDoToken(t)));
  if (a === "jogos") return await telaJogos(t);
  if (a === "jogo") return await telaJogo(cred, t, url.searchParams.get("n1") ?? "", url.searchParams.get("n2") ?? "");

  const TIPOS = {
    live: { nome: "TV ao vivo", cats: "get_live_categories", itens: "get_live_streams", cor: COR.tv, solido: "#5B3FD9", icone: "live-tv" },
    vod: { nome: "Filmes", cats: "get_vod_categories", itens: "get_vod_streams", cor: COR.vod, solido: "#C02670", icone: "movie" },
    series: { nome: "Séries", cats: "get_series_categories", itens: "get_series", cor: COR.series, solido: "#0B8F9C", icone: "video-library" },
  } as const;
  const tipoQ = url.searchParams.get("k") as keyof typeof TIPOS;
  const T = TIPOS[tipoQ];

  if (a === "cats") {
    if (!T) return aviso("Gold Play", "Seção desconhecida");
    const cats = await api(cred, `&action=${T.cats}`);
    const lst = Array.isArray(cats) ? cats : [];
    // visual transparente (o vídeo/fundo aparece por trás), como o usuário preferiu
    const linha = (nome: string, ic: string, cid: string, sub: string) => ({ title: nome, titleFooter: sub, color: VID.n, action: go({ a: "itens", k: tipoQ, t, c: cid, cn: cid ? nome : "" }) });
    const itens: any[] = [
      { ...linha("Todos", "apps", "", `Todo o catálogo de ${T.nome.toLowerCase()}`), focus: true },
      ...(tipoQ === "live" ? [{ ...linha("FAVORITOS", "star", "fav", "Seus canais favoritos"), title: CORACAO + "FAVORITOS" }] : []),
      ...lst.map((x: any) => { const nome = limparNome(String(x.category_name)); return linha(nome, iconeDoNome(nome, "play"), x.category_id, T.nome); }),
    ];
    return lista(T.nome, itens, "0,0,6,1", {}, `${lst.length} categorias`, tipoQ);
  }

  if (a === "itens") {
    if (!T) return aviso("Gold Play", "Seção desconhecida");
    const dados = c === "fav" && tipoQ === "live" ? await favoritosDe(cred.u) : await api(cred, `&action=${T.itens}${c && c !== "fav" ? "&category_id=" + encodeURIComponent(c) : ""}`);
    const todos = Array.isArray(dados) ? dados : [];
    const prox = (n: number) => go({ a: "itens", k: tipoQ, t, c, cn: url.searchParams.get("cn") ?? "", pg: n });
    if (tipoQ === "live") {
      const ep = await epgVarios(cred, todos.slice(pg * POR_PAGINA, (pg + 1) * POR_PAGINA).map((x: any) => String(x.stream_id)));
      const favs = new Set((await favoritosDe(cred.u)).map((f) => f.stream_id));
      return paginar("Canais", todos, pg, (x) => canalItem(x, cred, t, c, false, "", url.searchParams.get("cn") ?? "", 0, ep.get(String(x.stream_id)), favs), prox, "0,0,4,1", tipoQ);
    }
    if (tipoQ === "vod") {
      return paginar("Filmes", todos, pg, (x) => {
        const nome = limparNome(String(x.name));
        return {
          title: nome, image: x.stream_icon || cartao("vod", nome, "Filme", "movie", true), imageFiller: "cover", color: COR.vidro,
          tag: nota(x.rating), tagColor: COR.destaque,
          action: tocar("movie", cred, x.stream_id, x.container_extension || "mp4", "o filme"), playerLabel: nome,
          properties: { "trigger:back": "quiet" },
        };
      }, prox, "0,0,2,3", tipoQ);
    }
    return paginar("Séries", todos, pg, (x) => {
      const nome = limparNome(String(x.name));
      return {
        title: nome, image: x.cover || cartao("series", nome, "Série", "series", true), imageFiller: "cover", color: COR.vidro,
        tag: nota(x.rating), tagColor: COR.destaque,
        action: go({ a: "serie", t, s: x.series_id }),
      };
    }, prox, "0,0,2,3", tipoQ);
  }

  if (a === "painel" || a === "fav") {
    const s = url.searchParams.get("s") ?? "";
    const cn = url.searchParams.get("cn") ?? "";
    let avisoFav = "";
    if (a === "fav") {
      const agoraFav = await alternarFavorito(cred.u, s, url.searchParams.get("n") ?? "Canal", url.searchParams.get("i") ?? "");
      avisoFav = agoraFav ? "adicionado aos favoritos" : "removido dos favoritos";
    }
    const dados = c === "fav" ? await favoritosDe(cred.u) : await api(cred, `&action=get_live_streams${c ? "&category_id=" + encodeURIComponent(c) : ""}`);
    const todos = (Array.isArray(dados) ? dados : []).slice(0, 400);
    const idx = todos.findIndex((x: any) => String(x.stream_id) === s);
    const perto = idx >= 0 ? todos.slice(Math.max(0, idx - 4), idx + 20) : todos.slice(0, 24);
    const ids = [s, ...perto.map((x: any) => String(x.stream_id)).filter((i: string) => i !== s)];
    const ep = await epgVarios(cred, ids, 1200);
    const navegar = {
      title: "Categorias", key: "red", display: false,
      color: VID.voltar,
      action: `panel:${SELF()}?${q({ a: "pcats", t, s })}`,
    };
    const favs = new Set((await favoritosDe(cred.u)).map((f) => f.stream_id));
    const nParam = url.searchParams.get("n") ?? "", iParam = url.searchParams.get("i") ?? "";
    const atualCanal: any = todos.find((x: any) => String(x.stream_id) === s) ?? (a === "fav" && nParam ? { name: nParam, stream_id: s, stream_icon: iParam } : undefined);
    const alternar = atualCanal ? `panel:${SELF()}?${q({ a: "fav", t, c, cn, s, n: limparNome(String(atualCanal.name)), i: String(atualCanal.stream_icon ?? "") })}` : "none";
    const inicioItem = {
      title: "Início", key: "blue", display: false,
      color: VID.voltar,
      action: `[quiet|${go({ a: "home", t })}]`,
    };
    const canais = todos.map((x: any, i: number) => ({ x, i })).filter((o: any) => o.i !== idx)
      .map((o: any) => ({ ...canalItem(o.x, cred, t, c, true, s, cn, o.i + 1, ep.get(String(o.x.stream_id)), favs), focus: undefined }));
    const fixo = atualCanal ? [{ ...canalItem(atualCanal, cred, t, c, true, s, cn, idx + 1, ep.get(s), favs), action: "back", focus: true, ...(avisoFav ? { titleFooter: "Canal " + avisoFav } : {}) }] : [];
    return {
      type: "list", headline: "Canais  {col:msx-red}•{col:msx-white-soft}Categorias  {col:msx-green}•{col:msx-white-soft}Favoritar  {col:msx-blue}•{col:msx-white-soft}Início ",
      template: { type: "default", layout: "0,0,8,1", color: COR.vidro },
      items: [{ ...navegar, focus: !atualCanal ? true : undefined }, inicioItem, ...(atualCanal ? [{ title: "Favoritar", key: "green", display: false, color: VID.voltar, action: alternar }] : []), ...fixo, ...canais],
    };
  }

  // categorias de canais dentro do painel do player
  if (a === "pcats") {
    const s = url.searchParams.get("s") ?? "";
    const cats = await api(cred, "&action=get_live_categories");
    const lst = Array.isArray(cats) ? cats : [];
    const item = (nome: string, cid: string, titulo = nome) => ({
      title: titulo, titleFooter: "TV ao vivo", truncation: "title",
      color: VID.n,
      action: `panel:${SELF()}?${q({ a: "painel", t, c: cid, cn: cid ? nome : "", s })}`,
    });
    return {
      type: "list", headline: "Categorias", extension: `${lst.length}`,
      template: { type: "default", layout: "0,0,8,1", color: COR.vidro },
      items: [item("Todos os canais", ""), { ...item("FAVORITOS", "fav", CORACAO + "FAVORITOS"), titleFooter: "Seus canais favoritos" }, ...lst.map((x: any) => item(limparNome(String(x.category_name)), String(x.category_id)))],
    };
  }

  if (a === "serie") {
    const s = url.searchParams.get("s") ?? "";
    const temp = url.searchParams.get("n");
    const info = await api(cred, `&action=get_series_info&series_id=${encodeURIComponent(s)}`);
    const nome = String(info?.info?.name ?? "Série");
    const eps = info?.episodes ?? {};
    const numeros = Object.keys(eps).sort((x, y) => Number(x) - Number(y));
    if (temp === null) {
      return lista(limparNome(nome), numeros.map((n) => ({
        title: `Temporada ${n}`, titleFooter: `${eps[n].length} episódios`, color: VID.n,
        action: go({ a: "serie", t, s, n }),
      })), "0,0,6,1", {}, `${numeros.length} temporadas`, "series");
    }
    const lst = (eps[temp] ?? []) as any[];
    return lista(`${nome}`, lst.map((e) => ({
      titleHeader: `Episódio ${e.episode_num}`, title: String(e.title ?? ""), titleFooter: e.info?.duration ? String(e.info.duration) : "",
      image: e.info?.movie_image || undefined, imageFiller: "cover", icon: e.info?.movie_image ? undefined : "play-arrow", color: COR.vidro,
      action: tocar("series", cred, e.id, e.container_extension || "mp4", "o episódio"),
      playerLabel: `${nome} T${temp}E${e.episode_num}`,
      properties: { "trigger:back": "quiet" },
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
async function jogoSvg(g: URLSearchParams) {
  const W = 600, H = 380;
  const k = g.get("k") ?? "pre";
  const st = limparNome(g.get("s") ?? "").slice(0, 18);
  const liga = limparNome(g.get("l") ?? "").slice(0, 24).toUpperCase();
  const canais = (g.get("c") ?? "").replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, 80);
  const logoH: string | null = null, logoF: string | null = null; // logos embutidas não aparecem na TV: sempre a bolinha com a sigla
  const linha = (y: number, p: string, logo: string | null) => {
    const [nome = "", sigla = "", cor = "475569", gols = "", v = ""] = (g.get(p) ?? "").split("|");
    const apaga = k === "post" && v !== "1";
    const n = limparNome(nome); const longo = n.length > 14; const nm = n.length > 23 ? n.slice(0, 22) + "…" : n;
    const c = /^[0-9a-f]{6}$/i.test(cor) ? cor : "475569";
    const escudo = logo
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
const timeTxt = (t: Time) => [t.nome, t.sigla, t.cor, t.gols, t.venceu ? "1" : ""].join("|");
const jogoImg = (j: Jogo) => `${SELF()}?${q({
  a: "jg", k: j.estado, s: j.status, l: j.liga, h: timeTxt(j.casa), f: timeTxt(j.fora), c: j.transmissao,
})}`;

// cartão de abertura da faixa de jogos
function resumoSvg(total: number, vivos: number, falhou: boolean) {
  const W = 600, H = 380;
  const sub = falhou ? "Placar indisponível agora" : total ? `${total} partida${total > 1 ? "s" : ""}${vivos ? ` · ${vivos} ao vivo` : ""}` : "Nenhuma partida hoje";
  const bola = "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 3.3l1.35-.95c1.82.56 3.37 1.76 4.38 3.34l-.39 1.34-1.35.46L13 6.7V5.3zm-3.35-.95L11 5.3v1.4L7.01 9.49l-1.35-.47-.39-1.34c1.01-1.57 2.56-2.77 4.38-3.33zM7.08 17.11l-1.14.1C4.73 15.81 4 13.99 4 12c0-.12.01-.23.02-.35l1-.73 1.38.48 1.46 4.34-.78 1.37zm7.42 2.48c-.79.26-1.63.41-2.5.41s-1.71-.15-2.5-.41l-.69-1.49.64-1.1h5.11l.64 1.11-.7 1.48zM14.27 15H9.73l-1.35-4.02L12 8.44l3.63 2.54L14.27 15zm3.79 2.21l-1.14-.1-.79-1.37 1.46-4.34 1.39-.47 1 .73c.01.11.02.22.02.34 0 1.99-.73 3.81-1.94 5.21z";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><defs>`
    + `<linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#F5B400"/><stop offset=".6" stop-color="#FF7A00"/><stop offset="1" stop-color="#E11D48"/></linearGradient>`
    + `<linearGradient id="sh" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".2"/><stop offset=".5" stop-color="#fff" stop-opacity="0"/></linearGradient>`
    + `<clipPath id="c"><rect x="8" y="8" width="${W - 16}" height="${H - 16}" rx="0"/></clipPath></defs>`
    + `<g clip-path="url(#c)"><rect width="${W}" height="${H}" fill="url(#g)"/><rect width="${W}" height="${H}" fill="url(#sh)"/>`
    + `<g transform="translate(400 170) scale(10)" fill="#fff" fill-opacity=".13"><path d="${bola}"/></g>`
    + `<rect x="40" y="40" width="84" height="84" rx="24" fill="#fff" fill-opacity=".22"/><g transform="translate(58 58) scale(2)" fill="#fff"><path d="${bola}"/></g>`
    + `<text x="40" y="226" font-size="46" font-weight="800" fill="#fff" font-family="Arial, Helvetica, sans-serif">Jogos de hoje</text>`
    + `<text x="42" y="272" font-size="28" font-weight="600" fill="#fff" fill-opacity=".88" font-family="Arial, Helvetica, sans-serif">${xml(sub)}</text>`
    + (total && !falhou ? `<text x="42" y="330" font-size="24" font-weight="700" fill="#fff" fill-opacity=".95" font-family="Arial, Helvetica, sans-serif">Ver todos  ›</text>` : "")
    + `</g><rect x="9" y="9" width="${W - 18}" height="${H - 18}" rx="0" fill="none" stroke="#fff" stroke-opacity=".35" stroke-width="2"/></svg>`;
}
const resumoImg = (total: number, vivos: number, falhou: boolean) => `${SELF()}?${q({ a: "jr", n: total, vv: vivos, x: falhou ? 1 : 0 })}`;

async function home(t: string, quem: string, d: string | null = null) {
  const [usuario, venc] = quem.split(" · ");
  const jogos = await jogosDoDia();
  const lst = jogos ?? [];
  const vivos = lst.filter((j) => j.estado === "in").length;
  const todos = go({ a: "jogos", t });
  const card = (layout: string, img: string, acao: string, extra: Record<string, unknown> = {}) =>
    ({ type: "default", layout, image: IMG + img, imageFiller: "fit", color: "transparent", action: acao, ...extra });
  const destaques = lst.slice(0, 3).map((j, i) => ({
    type: "default", layout: `${3 + i * 3},4,3,2`, image: jogoImg(j), imageFiller: "fit", color: "transparent", action: jogoAcao(j, t),
  }));
  return {
    type: "pages", transparent: 2, ready: { action: "quiet" }, background: IMG + "bg-tv.jpg",
    pages: [{ items: [
      camadaFundo("bg-tv.jpg"),
      { type: "space", layout: "0,0,2,1", image: LOGO, imageFiller: "fit" },
      { type: "space", layout: "2,0,6,1", headline: `Olá, ${usuario}`, text: venc ? `{col:msx-white-soft}Plano ativo · ${venc}` : "{col:msx-white-soft}Bom te ver por aqui" },
      card("10,0,2,1", "btn-sair.png", d ? `content:request:interaction:sair@${PLUGIN}` : go({ a: "inicio" })),
      card("0,1,4,3", "card-tv.png", go({ a: "cats", k: "live", t }), { id: "tv", focus: true }),
      card("4,1,4,3", "card-filmes.png", go({ a: "cats", k: "vod", t })),
      card("8,1,4,3", "card-series.png", go({ a: "cats", k: "series", t })),
      { type: "default", layout: "0,4,3,2", image: resumoImg(lst.length, vivos, jogos === null), imageFiller: "fit", color: "transparent", action: lst.length ? todos : "none" },
      ...destaques,
    ] }],
  };
}

const jogoAcao = (j: Jogo, t: string) => go({ a: "jogo", t, n1: j.casa.nome, n2: j.fora.nome });

async function telaJogos(t: string) {
  const jogos = await jogosDoDia(5000);
  if (jogos === null) return aviso("Jogos de hoje", "Placar indisponível agora. Tente de novo em instantes.");
  if (!jogos.length) return aviso("Jogos de hoje", "Nenhuma partida programada para hoje.");
  const vivos = jogos.filter((j) => j.estado === "in").length;
  return lista("Jogos de hoje", jogos.map((j) => ({ image: jogoImg(j), imageFiller: "fit", color: "transparent", action: jogoAcao(j, t) })),
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
    { type: "default", layout: "0,1,4,3", image: jogoImg(j), imageFiller: "fit", color: "transparent", action: "none" },
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
    return { type: "pages", transparent: 2, ready: { action: "quiet" }, background: IMG + "bg-tv.jpg", pages: [{ items: [...topo, ...assistir, ...extra] }] };
  }
  const onde = j.canaisLista.length ? `Este jogo passa em ${j.canaisLista.join(" · ")}` : "A programação não informou onde passa";
  const aviso1 = { ...linhaVidro(0, {}), title: "Canal não encontrado para este jogo", titleFooter: cat ? onde : "Não foi possível consultar seus canais agora", action: "none", truncation: "title|titleFooter" };
  const opcoes = [
    ...abrirEventos.map((e) => ({ ...e, layout: "4,2,8,1", focus: true })),
    { ...linhaVidro(abrirEventos.length ? 2 : 1, {}), focus: !abrirEventos.length, title: "TV ao vivo", titleFooter: "Procurar o canal nas categorias", action: go({ a: "cats", k: "live", t }) },
  ];
  return { type: "pages", transparent: 2, ready: { action: "quiet" }, background: IMG + "bg-tv.jpg", pages: [{ items: [...topo, aviso1, ...opcoes] }] };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  try {
    const u0 = new URL(req.url);
    const mv = u0.pathname.match(/\/v\/(live|movie|series)\/([\w-]+)\/([^/]+)\.(\w+)$/);
    if (mv) {
      const cred = await lerToken(mv[2]);
      if (!cred) return new Response("Sessão expirada", { status: 403 });
      return new Response(null, { status: 302, headers: { location: urlFluxo(mv[1], cred, decodeURIComponent(mv[3]), mv[4]), "cache-control": "no-store", "access-control-allow-origin": "*" } });
    }
    if (req.method === "GET" && u0.searchParams.get("a") === "img") {
      const g = u0.searchParams;
      const svg = cartaoSvg(g.get("k") ?? "live", g.get("t") ?? "", g.get("s") ?? "", g.get("i") ?? "play", g.get("f") === "p");
      return new Response(svg, { headers: { "access-control-allow-origin": "*", "content-type": "image/svg+xml; charset=utf-8", "cache-control": "public, max-age=86400" } });
    }
    if (req.method === "GET" && (u0.searchParams.get("a") === "jg" || u0.searchParams.get("a") === "jr")) {
      const g = u0.searchParams;
      const svg = g.get("a") === "jg" ? await jogoSvg(g) : resumoSvg(Number(g.get("n")) || 0, Number(g.get("vv")) || 0, g.get("x") === "1");
      return new Response(svg, { headers: { "access-control-allow-origin": "*", "content-type": "image/svg+xml; charset=utf-8", "cache-control": "public, max-age=60" } });
    }
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
