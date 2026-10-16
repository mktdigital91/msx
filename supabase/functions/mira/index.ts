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

// fundo de bloco largo: degradê translúcido + ícone grande e suave à direita (o nome vem por cima, em texto do MSX)
function faixaSvg(k: string, semente: string, icone: string, ativo = false) {
  let h = 0; for (const ch of semente) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const pal = PALETAS[k] ?? PALETAS.live;
  const [c1, c2] = pal[h % pal.length];
  const ic = ICONES[icone] ?? ICONES.play;
  const W = 960, H = 160;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><defs><clipPath id="c"><rect width="${W}" height="${H}" rx="22"/></clipPath><linearGradient id="g" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${c1}" stop-opacity="${ativo ? 1 : 0.92}"/><stop offset=".55" stop-color="${c2}" stop-opacity="${ativo ? 0.85 : 0.55}"/><stop offset="1" stop-color="${c2}" stop-opacity="${ativo ? 0.5 : 0.18}"/></linearGradient><linearGradient id="l" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".18"/><stop offset=".5" stop-color="#fff" stop-opacity="0"/></linearGradient></defs><g clip-path="url(#c)"><rect width="${W}" height="${H}" fill="#0B0B1A" fill-opacity=".55"/><rect width="${W}" height="${H}" fill="url(#g)"/><rect width="${W}" height="${H}" fill="url(#l)"/><circle cx="${W - 120}" cy="-50" r="150" fill="#fff" fill-opacity=".08"/><g transform="translate(${W - 200} 8) scale(6)" fill="#fff" fill-opacity=".16"><path d="${ic}"/></g></g><rect x="1.5" y="1.5" width="${W - 3}" height="${H - 3}" rx="21" fill="none" stroke="#fff" stroke-opacity="${ativo ? 0.7 : 0.22}" stroke-width="${ativo ? 5 : 3}"/></svg>`;
}
const faixa = (k: string, semente: string, icone: string, ativo = false) => `${Deno.env.get("SUPABASE_URL")}/functions/v1/mira?${new URLSearchParams({ a: "bg", k, n: semente.slice(0, 40), i: icone, ...(ativo ? { x: "1" } : {}) }).toString()}`;

const SELF = () => `${Deno.env.get("SUPABASE_URL")}/functions/v1/mira`;
const q = (o: Record<string, string | number>) =>
  Object.entries(o).map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join("&");
const go = (o: Record<string, string | number>) => `content:${SELF()}?${q(o)}`;

function inputAction(servico: string, titulo: string, dica: string) {
  // {INPUT} fica sem codificar: o plugin do MSX o substitui pelo que foi digitado
  return `content:request:interaction:${servico}|default|pt|${titulo}|||${dica}|@${INPUT}`;
}

function lista(headline: string, items: unknown[], layout = "0,0,4,1", extra: Record<string, unknown> = {}, extensao?: string) {
  return { type: "list", headline, extension: extensao, background: IMG + "fundo.jpg", template: { type: "default", layout, color: COR.vidro, ...extra }, items };
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
  kind: string,
  ext?: string,
) {
  const ini = pg * POR_PAGINA;
  const itens = todos.slice(ini, ini + POR_PAGINA).map(montar) as unknown[];
  const total = Math.ceil(todos.length / POR_PAGINA);
  if (ini + POR_PAGINA < todos.length) itens.push({ title: "Próxima página", titleFooter: `${pg + 2} de ${total}`, icon: "navigate-next", color: COR.destaque, action: proxima(pg + 1) });
  if (pg > 0) itens.unshift({ title: "Página anterior", titleFooter: `${pg} de ${total}`, icon: "navigate-before", color: COR.destaque, action: proxima(pg - 1) });
  if (!todos.length) itens.push({ title: "Nada encontrado", action: "none" });
  return lista(titulo, itens, layout, {}, ext ?? `${todos.length} itens`);
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
      .filter((p) => p.titulo && p.fim > Date.now())
      .sort((a, b) => a.ini - b.ini);
  } catch { /* sem guia */ }
  cacheEpg.set(id, { em: Date.now(), v });
  return v;
}
// busca a programação de vários canais em paralelo, sem passar do tempo-limite
async function epgVarios(cred: { u: string; p: string }, ids: string[], limiteMs = 3500, paralelo = 16) {
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
function canalItem(x: any, cred: { u: string; p: string }, t: string, c: string, painel = false, atual = "", cn = "", n = 0, epg?: Prog[]) {
  const nome = limparNome(String(x.name));
  const guia = textoEpg(epg);
  const logo = x.stream_icon || undefined;
  const lista = `panel:${SELF()}?${q({ a: "painel", t, c, cn, s: x.stream_id })}`;
  const ativo = painel && String(x.stream_id) === atual;
  const visual = painel
    ? { titleHeader: n ? `CANAL ${n}` : undefined, image: faixa("live", nome, ativo ? "play" : "live", ativo), imageFiller: "cover", color: "transparent" }
    : { image: logo, imageWidth: 1, imageFiller: "fit", wrapperColor: "rgba(255,255,255,0.06)", icon: logo ? undefined : "live-tv", iconSize: "small", color: COR.vidro };
  return {
    title: nome, titleFooter: (ativo ? "▶ " : "") + (guia.linha || (ativo ? "Assistindo agora" : "Ao vivo")), truncation: "title|titleFooter",
    ...visual,
    focus: ativo ? true : undefined, enumerate: true,
    playerLabel: nome,
    action: `video:${urlFluxo("live", cred, x.stream_id, "ts")}`,
    properties: {
      "control:type": "extended",
      "control:action": lista,
      "info:headline": nome,
      "info:text": guia.player || (cn ? `${cn} · sem guia de programação` : "Sem guia de programação"),
      ...(logo ? { "info:image": logo, "info:size": "small" } : {}),
      "button:content:icon": "list",
      "button:content:action": lista,
      "button:content:focus": true,
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

  if (a === "home") return await home(t, cred.u, d);

  const TIPOS = {
    live: { nome: "TV ao vivo", cats: "get_live_categories", itens: "get_live_streams", cor: COR.tv, solido: "#5B3FD9", icone: "live-tv" },
    vod: { nome: "Filmes", cats: "get_vod_categories", itens: "get_vod_streams", cor: COR.vod, solido: "#C02670", icone: "movie" },
    series: { nome: "Séries", cats: "get_series_categories", itens: "get_series", cor: COR.series, solido: "#0B8F9C", icone: "video-library" },
  } as const;
  const tipoQ = url.searchParams.get("k") as keyof typeof TIPOS;
  const T = TIPOS[tipoQ];

  if (a === "cats") {
    if (!T) return aviso("Mira", "Seção desconhecida");
    const cats = await api(cred, `&action=${T.cats}`);
    const lst = Array.isArray(cats) ? cats : [];
    const linha = (nome: string, ic: string, cid: string, sub: string) => ({ title: nome, titleFooter: sub, image: faixa(tipoQ, nome, ic), imageFiller: "cover", color: "transparent", action: go({ a: "itens", k: tipoQ, t, c: cid, cn: cid ? nome : "" }) });
    const itens = [
      { ...linha("Todos", "apps", "", `Todo o catálogo de ${T.nome.toLowerCase()}`), focus: true },
      ...lst.map((x: any) => { const nome = limparNome(String(x.category_name)); return linha(nome, iconeDoNome(nome, "play"), x.category_id, T.nome); }),
    ];
    return lista(T.nome, itens, "0,0,6,1", {}, `${lst.length} categorias`);
  }

  if (a === "itens") {
    if (!T) return aviso("Mira", "Seção desconhecida");
    const dados = await api(cred, `&action=${T.itens}${c ? "&category_id=" + encodeURIComponent(c) : ""}`);
    const todos = Array.isArray(dados) ? dados : [];
    const prox = (n: number) => go({ a: "itens", k: tipoQ, t, c, cn: url.searchParams.get("cn") ?? "", pg: n });
    if (tipoQ === "live") {
      const ep = await epgVarios(cred, todos.slice(pg * POR_PAGINA, (pg + 1) * POR_PAGINA).map((x: any) => String(x.stream_id)));
      return paginar("Canais", todos, pg, (x) => canalItem(x, cred, t, c, false, "", url.searchParams.get("cn") ?? "", 0, ep.get(String(x.stream_id))), prox, "0,0,4,1", tipoQ);
    }
    if (tipoQ === "vod") {
      return paginar("Filmes", todos, pg, (x) => {
        const nome = limparNome(String(x.name));
        return {
          title: nome, image: x.stream_icon || cartao("vod", nome, "Filme", "movie", true), imageFiller: "cover", color: COR.vidro,
          tag: nota(x.rating), tagColor: COR.destaque,
          action: `video:${urlFluxo("movie", cred, x.stream_id, x.container_extension || "mp4")}`, playerLabel: nome,
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

  if (a === "painel") {
    const s = url.searchParams.get("s") ?? "";
    const cn = url.searchParams.get("cn") ?? "";
    const dados = await api(cred, `&action=get_live_streams${c ? "&category_id=" + encodeURIComponent(c) : ""}`);
    const todos = (Array.isArray(dados) ? dados : []).slice(0, 400);
    const idx = todos.findIndex((x: any) => String(x.stream_id) === s);
    const ids = [s, ...todos.slice(0, 120).map((x: any) => String(x.stream_id)).filter((i: string) => i !== s)];
    const ep = await epgVarios(cred, ids);
    const navegar = {
      titleHeader: "NAVEGAR", title: "Trocar categoria", titleFooter: `Atual: ${cn || "Todos os canais"}`,
      image: faixa("nav", "nav", "apps", true), imageFiller: "cover", color: "transparent",
      action: `panel:${SELF()}?${q({ a: "pcats", t, s })}`,
    };
    const canais = todos.map((x: any, i: number) => ({ ...canalItem(x, cred, t, c, true, s, cn, i + 1, ep.get(String(x.stream_id))), focus: undefined }));
    const fixo = idx >= 0 ? [{ ...canalItem(todos[idx], cred, t, c, true, s, cn, idx + 1, ep.get(s)), focus: true }] : [];
    return {
      type: "list", headline: "Canais", extension: cn || `${todos.length}`,
      template: { type: "default", layout: "0,0,8,1", color: COR.vidro },
      items: [...fixo, { ...navegar, focus: idx < 0 ? true : undefined }, ...canais],
    };
  }

  // categorias de canais dentro do painel do player
  if (a === "pcats") {
    const s = url.searchParams.get("s") ?? "";
    const cats = await api(cred, "&action=get_live_categories");
    const lst = Array.isArray(cats) ? cats : [];
    const item = (nome: string, cid: string) => ({
      title: nome, titleFooter: "TV ao vivo", truncation: "title",
      image: faixa("live", nome, iconeDoNome(nome, "live")), imageFiller: "cover", color: "transparent",
      action: `panel:${SELF()}?${q({ a: "painel", t, c: cid, cn: cid ? nome : "", s })}`,
    });
    return {
      type: "list", headline: "Categorias", extension: `${lst.length}`,
      template: { type: "default", layout: "0,0,8,1", color: COR.vidro },
      items: [item("Todos os canais", ""), ...lst.map((x: any) => item(limparNome(String(x.category_name)), String(x.category_id)))],
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
        title: `Temporada ${n}`, titleFooter: `${eps[n].length} episódios`, image: faixa("series", "Temporada " + n, "series"), imageFiller: "cover", color: "transparent",
        action: go({ a: "serie", t, s, n }),
      })), "0,0,6,1", {}, `${numeros.length} temporadas`);
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
    const u0 = new URL(req.url);
    if (req.method === "GET" && u0.searchParams.get("a") === "img") {
      const g = u0.searchParams;
      const svg = cartaoSvg(g.get("k") ?? "live", g.get("t") ?? "", g.get("s") ?? "", g.get("i") ?? "play", g.get("f") === "p");
      return new Response(svg, { headers: { "access-control-allow-origin": "*", "content-type": "image/svg+xml; charset=utf-8", "cache-control": "public, max-age=86400" } });
    }
    if (req.method === "GET" && u0.searchParams.get("a") === "bg") {
      const g = u0.searchParams;
      return new Response(faixaSvg(g.get("k") ?? "live", g.get("n") ?? "", g.get("i") ?? "play", g.get("x") === "1"), { headers: { "access-control-allow-origin": "*", "content-type": "image/svg+xml; charset=utf-8", "cache-control": "public, max-age=86400" } });
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
